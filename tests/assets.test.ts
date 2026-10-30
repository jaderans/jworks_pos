import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/db';
import { ensureDevice } from '../src/db/local';
import { setWriterDevice } from '../src/db/write';
import { sum, toCents } from '../src/lib/money';
import { assetCharges, assetShare, payoffText } from '../src/domain/assets';
import { eventCosts } from '../src/domain/share';
import { feedSpend } from '../src/domain/studioFeed';
import { createEvent } from '../src/services/events';
import { saveSpend } from '../src/services/spend';
import { eventFeed } from '../src/services/studio';
import type { JWEvent, SpendItem } from '../src/db/types';

const P = toCents;
const peso = (n: number) => `₱${(n / 100).toFixed(2)}`;

describe('reusable assets paid off over events', () => {
  const ev = (id: string, startDate: string, createdAt = 0) => ({ id, name: id, startDate, createdAt, deleted: 0 as const });
  const events = [ev('hilway', '2026-10-31'), ev('komiket', '2026-11-14'), ev('expo', '2026-11-28'), ev('fair', '2026-12-12')];
  const fence = { id: 'fence', eventId: 'hilway', type: 'asset', name: 'Pet Fence', qty: 8, unitCost: P(39), status: 'bought', amortizeEvents: 6, createdAt: 1, deleted: 0 } as SpendItem;
  const hooks = { id: 'hooks', eventId: 'hilway', type: 'asset', name: 'Screen Hooks', qty: 1, unitCost: P(91.52), status: 'bought', amortizeEvents: 6, createdAt: 2, deleted: 0 } as SpendItem;
  const grid = { id: 'grid', eventId: 'komiket', type: 'asset', name: 'Grid', qty: 1, unitCost: P(100), status: 'bought', amortizeEvents: 3, createdAt: 3, deleted: 0 } as SpendItem;

  it('equal shares, the last one taking the rounding, add up to the price', () => {
    const total = P(91.52);
    const shares = [1, 2, 3, 4, 5, 6].map((i) => assetShare(total, 6, i));
    expect(shares.slice(0, 5)).toEqual([1525, 1525, 1525, 1525, 1525]);
    expect(shares[5]).toBe(1527);
    expect(sum(shares)).toBe(total);
  });

  it('the event it was bought for and the next ones in date order each pay a share', () => {
    const at = (id: string) => assetCharges(id, events, [fence, hooks, grid]);
    expect(at('hilway').map((c) => [c.item.name, c.index, c.amount, c.carried])).toEqual([
      ['Pet Fence', 1, P(52), false],
      ['Screen Hooks', 1, 1525, false],
    ]);
    const komiket = at('komiket');
    expect(komiket.map((c) => [c.item.name, c.index, c.amount, c.paidOff, c.carried])).toEqual([
      ['Grid', 1, P(33.33), P(33.33), false],
      ['Pet Fence', 2, P(52), P(104), true],
      ['Screen Hooks', 2, 1525, 3050, true],
    ]);
    expect(komiket[1].boughtForName).toBe('hilway');
    // The grid is paid off on its third event.
    const grid3 = at('fair').find((c) => c.item.id === 'grid')!;
    expect(grid3).toMatchObject({ index: 3, amount: P(33.34), paidOff: P(100) });
    expect(payoffText(grid3, peso)).toBe('Event 3 of 3 · paid off');
    expect(payoffText(komiket[1], peso)).toBe('Event 2 of 6 · ₱104.00 of ₱312.00 paid off');
    // An event before it was bought pays nothing toward it.
    expect(assetCharges('hilway', events, [grid])).toEqual([]);
  });

  it('stops once paid off, and an event that was deleted drops out of the run', () => {
    const many = Array.from({ length: 8 }, (_, i) => ev(`e${i}`, `2026-11-${String(i + 1).padStart(2, '0')}`));
    const item = { ...fence, eventId: 'e0', amortizeEvents: 3 };
    expect(many.map((e) => assetCharges(e.id, many, [item]).length)).toEqual([1, 1, 1, 0, 0, 0, 0, 0]);
    const without = many.map((e, i) => (i === 1 ? { ...e, deleted: 1 as const } : e));
    expect(assetCharges('e3', without, [item])[0]).toMatchObject({ index: 3, paidOff: item.qty * item.unitCost });
  });

  it('event costs count this event’s shares, carried ones included', () => {
    const charges = assetCharges('komiket', events, [fence, hooks, grid]);
    expect(eventCosts([grid], 'all', charges).assets).toBe(P(33.33) + P(52) + 1525);
    // Without the run, only the event’s own first share (as before).
    expect(eventCosts([grid], 'all').assets).toBe(P(33.33));
  });
});

describe('itemized costs for Studio', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    setWriterDevice((await ensureDevice()).deviceId);
  });

  it('lines for the booth fee, each used-up item and each asset share, adding up to boothFee + supplies', async () => {
    const hilway = await createEvent({ name: 'Hilway Pop-Up Market', startDate: '2026-10-31', endDate: '2026-10-31' });
    const next = await createEvent({ name: 'Komiket', startDate: '2026-11-14', endDate: '2026-11-15' });
    await saveSpend({ eventId: hilway.id, type: 'booth_fee', name: 'Booth fee', qty: 1, unitCost: P(3000), status: 'bought' });
    await saveSpend({ eventId: hilway.id, type: 'consumable', name: 'Tarp', qty: 1, unitCost: P(450), status: 'bought' });
    await saveSpend({ eventId: hilway.id, type: 'consumable', name: 'Snacks', qty: 1, unitCost: P(200), status: 'to_buy' });
    await saveSpend({ eventId: hilway.id, type: 'asset', name: 'Pet Fence', qty: 8, unitCost: P(39), status: 'bought', amortizeEvents: 6 });
    await saveSpend({ eventId: next.id, type: 'booth_fee', name: 'Booth fee', qty: 1, unitCost: P(1500), status: 'bought' });

    const first = await eventFeed(hilway.id);
    expect(first?.type === 'event' && first.spend?.map((l) => [l.type, l.name, l.amount])).toEqual([
      ['booth_fee', 'Booth fee', P(3000)],
      ['consumable', 'Tarp', P(450)],
      ['asset', 'Pet Fence', P(52)],
    ]);
    const second = await eventFeed(next.id);
    if (second?.type !== 'event') throw new Error('no feed');
    expect(second.spend?.find((l) => l.type === 'asset')).toMatchObject({ name: 'Pet Fence', amount: P(52), index: 2, of: 6, paidOff: P(104), total: P(312), boughtFor: 'Hilway Pop-Up Market' });
    for (const f of [first, second]) {
      if (f?.type !== 'event') continue;
      expect(sum((f.spend ?? []).map((l) => l.amount))).toBe(f.boothFee + f.supplies);
    }
    expect(feedSpend({ spend: [], assetCharges: [] })).toEqual([]);
  });
});

export type { JWEvent };
