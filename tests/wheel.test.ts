import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { alive, db } from '../src/db/db';
import { ensureDevice } from '../src/db/local';
import { setWriterDevice } from '../src/db/write';
import { toCents } from '../src/lib/money';
import { priceCart } from '../src/domain/cart';
import { onHandByProduct } from '../src/domain/stock';
import { eventMetrics } from '../src/domain/summary';
import { landingTurn, pickPrize, tryAgainChance, wheelProblem, wheelQualifies, wheelRuleText, wheelSlices, winsToday, type WheelConfig, type WheelPrize } from '../src/domain/wheel';
import { createProduct } from '../src/services/catalog';
import { createEvent, updateEvent } from '../src/services/events';
import { completeSale, openSession } from '../src/services/sales';
import { adjustStock } from '../src/services/production';
import { spinWheel } from '../src/services/wheel';
import type { Sale } from '../src/db/types';

const P = toCents;
const couple: WheelPrize = { id: 'couple', label: 'Free Couple Pack', kind: 'item', productId: 'p-couple', voucher: null, chance: 10, perDay: 5 };
const off20: WheelPrize = { id: 'off20', label: '₱20 off', kind: 'voucher', productId: null, voucher: { kind: 'amount', value: P(20) }, chance: 30, perDay: null };
const cfg = (over: Partial<WheelConfig> = {}): WheelConfig => ({ on: true, minSpend: P(250), minItems: { count: 15, categoryId: 'sticker' }, prizes: [couple, off20], ...over });
const sale = (over: Partial<Sale>): Sale => ({ id: 's', status: 'completed', deleted: 0, total: 0, lines: [], ...over }) as Sale;
const line = (qty: number, categoryId: string | null, free = false) => ({ productId: 'x', name: 'x', categoryId, qty, unitPrice: P(10), gross: P(10) * qty, bundleOff: 0, free: (free ? 1 : 0) as 0 | 1, freeReason: '', designerId: null });

describe('the prize wheel', () => {
  it('spins after ₱250, or after 15 items of the category; never for deposits, prizes or twice', () => {
    expect(wheelQualifies(sale({ total: P(250) }), cfg())).toBe(true);
    expect(wheelQualifies(sale({ total: P(249) }), cfg())).toBe(false);
    expect(wheelQualifies(sale({ total: P(150), lines: [line(15, 'sticker')] }), cfg())).toBe(true);
    expect(wheelQualifies(sale({ total: P(150), lines: [line(14, 'sticker'), line(5, 'pins')] }), cfg())).toBe(false);
    expect(wheelQualifies(sale({ total: P(150), lines: [line(10, 'sticker'), line(5, 'sticker', true)] }), cfg())).toBe(false);
    expect(wheelQualifies(sale({ total: P(300), kind: 'deposit' }), cfg())).toBe(false);
    expect(wheelQualifies(sale({ total: P(300), prizeFor: 'other' }), cfg())).toBe(false);
    expect(wheelQualifies(sale({ total: P(300), wheel: { prizeId: null, label: 'Try again', at: 1 } }), cfg())).toBe(false);
    expect(wheelQualifies(sale({ total: P(300) }), cfg({ on: false }))).toBe(false);
    expect(wheelRuleText(cfg(), [{ id: 'sticker', name: 'Sticker' }])).toBe('Spend ₱250 or buy 15 Sticker items');
  });

  it('each prize owns a band as wide as its chance; a prize at its daily limit is "Try again"', () => {
    expect(pickPrize(cfg(), new Map(), 0.05)?.id).toBe('couple');
    expect(pickPrize(cfg(), new Map(), 0.1)?.id).toBe('off20');
    expect(pickPrize(cfg(), new Map(), 0.39)?.id).toBe('off20');
    expect(pickPrize(cfg(), new Map(), 0.4)).toBeNull();
    // The 5 free Couple Packs are gone today: its band is "Try again", and ₱20 off keeps its 30%.
    expect(pickPrize(cfg(), new Map([['couple', 5]]), 0.05)).toBeNull();
    expect(pickPrize(cfg(), new Map([['couple', 5]]), 0.2)?.id).toBe('off20');
    expect(tryAgainChance(cfg())).toBe(60);
    const today = new Date('2026-11-14T15:00:00').getTime();
    const wins = winsToday([sale({ wheel: { prizeId: 'couple', label: '', at: today } }), sale({ wheel: { prizeId: 'couple', label: '', at: today - 86_400_000 } })], '2026-11-14');
    expect(wins.get('couple')).toBe(1);
  });

  it('draws slices as wide as their chances, and stops inside the slice won', () => {
    const slices = wheelSlices(cfg());
    expect(slices.map((s) => [s.label, s.from, s.to])).toEqual([['Free Couple Pack', 0, 36], ['₱20 off', 36, 144], ['Try again', 144, 360]]);
    for (const [id, r] of [['couple', 0], ['couple', 0.99], ['off20', 0.5], [null, 0.3]] as const) {
      const turn = landingTurn(slices, id, r);
      const atTop = (360 - (turn % 360)) % 360;
      const s = slices.find((x) => x.id === id)!;
      expect(atTop).toBeGreaterThanOrEqual(s.from);
      expect(atTop).toBeLessThanOrEqual(s.to);
      expect(turn).toBeGreaterThan(6 * 360 - 1);
    }
  });

  it('says what’s wrong with a setup', () => {
    expect(wheelProblem(cfg())).toBeNull();
    expect(wheelProblem(cfg({ minSpend: null, minItems: null }))).toMatch(/when the wheel spins/);
    expect(wheelProblem(cfg({ prizes: [{ ...couple, chance: 80 }, off20] }))).toMatch(/add up to 110%/);
    expect(wheelProblem(cfg({ prizes: [{ ...couple, productId: null }] }))).toMatch(/Pick the product/);
  });
});

describe('spinning at the register', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    setWriterDevice((await ensureDevice()).deviceId);
  });

  async function setup(prizes: WheelPrize[]) {
    const device = await ensureDevice();
    const ev = await createEvent({ name: 'Hilway' });
    const pack = await createProduct({ name: 'Couple Pack (live)', price: P(240), trackStock: 1 });
    await adjustStock(pack.id, 10, 'Counted');
    const session = await openSession(ev.id, device, P(2000), null);
    await updateEvent(ev.id, { wheel: { on: true, minSpend: P(250), minItems: null, prizes: prizes.map((p) => (p.kind === 'item' ? { ...p, productId: pack.id } : p)) } });
    const sell = (total: number) =>
      completeSale({
        eventId: ev.id, session, device, cashierId: null, note: '',
        priced: priceCart([{ key: 'k', productId: pack.id, name: 'Couple Pack (live)', categoryId: null, unitPrice: P(total), qty: 1, free: false, freeReason: '', designerId: null }], [], []),
        payments: [{ methodId: 'cash', name: 'Cash', kind: 'cash', amount: P(total), tendered: P(total), ref: '' }],
      });
    return { device, session, pack, sell, ev: async () => (await db.events.get(ev.id))! };
  }

  it('a product prize is a ₱0 sale that takes it out of stock; it spins once, and stops at its daily limit', async () => {
    const { device, session, pack, sell, ev } = await setup([{ ...couple, chance: 100, perDay: 1 }]);
    const first = await sell(300);
    const spin = await spinWheel({ ev: await ev(), saleId: first.id, session, device, by: null });
    expect(spin.label).toBe('Free Couple Pack');
    expect(spin.prizeSale).toMatchObject({ total: 0, prizeFor: first.id, lines: [expect.objectContaining({ productId: pack.id, free: 1, gross: 0 })] });
    expect((await db.sales.get(first.id))?.wheel).toMatchObject({ prizeId: 'couple', label: 'Free Couple Pack' });
    expect(onHandByProduct(alive(await db.stockMoves.toArray())).get(pack.id)).toBe(8);
    await expect(spinWheel({ ev: await ev(), saleId: first.id, session, device, by: null })).rejects.toThrow(/already spun/);

    const second = await sell(300);
    const again = await spinWheel({ ev: await ev(), saleId: second.id, session, device, by: null });
    expect(again.prize).toBeNull();
    expect(again.label).toBe('Try again');
    const m = eventMetrics(alive(await db.sales.toArray()), []);
    expect([m.gross, m.freeItems]).toEqual([P(600), 1]);
  });

  it('a discount prize is a one-time voucher code for this event', async () => {
    const { device, session, sell, ev } = await setup([{ ...off20, chance: 100 }]);
    const s = await sell(260);
    const spin = await spinWheel({ ev: await ev(), saleId: s.id, session, device, by: null });
    expect(spin.voucher).toMatchObject({ kind: 'amount', value: P(20), maxUses: 1, eventId: (await ev()).id });
    expect(spin.voucher?.code).toMatch(/^WIN-[A-Z2-9]{5}$/);
    expect(spin.detail).toContain(spin.voucher!.code);
    await expect(spinWheel({ ev: await ev(), saleId: (await sell(100)).id, session, device, by: null })).rejects.toThrow(/doesn’t qualify/);
  });
});
