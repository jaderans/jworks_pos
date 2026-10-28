import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { SYNCED_TABLES, alive, db } from '../src/db/db';
import { ensureDevice } from '../src/db/local';
import { setWriterDevice } from '../src/db/write';
import { sum, toCents } from '../src/lib/money';
import { priceCart } from '../src/domain/cart';
import { feedPeople } from '../src/domain/studioFeed';
import { createProduct } from '../src/services/catalog';
import { createEvent } from '../src/services/events';
import { completeSale, openSession } from '../src/services/sales';
import { adjustStock, setManualCost } from '../src/services/production';
import { createOrder, pickUpOrder, takeDeposit } from '../src/services/orders';
import { eventFeed, orderFeed, sendEventToStudio } from '../src/services/studio';
import { loadReportInput } from '../src/reports/loadReport';
import type { Member, Payout, SalePayment } from '../src/db/types';
import type { ShareResult } from '../src/domain/share';

const P = toCents;
const cash = (amount: number): SalePayment => ({ methodId: 'cash', name: 'Cash', kind: 'cash', amount: P(amount), tendered: P(amount), ref: '' });
const gcash = (amount: number): SalePayment => ({ methodId: 'gcash', name: 'GCash', kind: 'ewallet', amount: P(amount), tendered: null, ref: '123' });

beforeEach(async () => {
  await db.delete();
  await db.open();
  const d = await ensureDevice();
  setWriterDevice(d.deviceId);
});

async function setup() {
  const ev = await createEvent({ name: 'Komiket' });
  const pin = await createProduct({ name: 'Pin', price: P(100), trackStock: 1 });
  await adjustStock(pin.id, 10, 'Counted');
  await setManualCost(pin.id, P(30));
  const device = await ensureDevice();
  const session = await openSession(ev.id, device, P(1000), null);
  const newOrder = (total: number) =>
    createOrder(
      { eventId: ev.id, customerId: null, customerName: 'Kaye', contact: '0917', designerId: null, dueAt: '', notes: '', lines: [{ productId: null, name: 'Custom portrait', categoryId: null, designerId: null, qty: 1, unitPrice: P(total) }] },
      device,
    );
  const sellPin = (payments: SalePayment[]) =>
    completeSale({
      eventId: ev.id, session, device, cashierId: null, note: '', payments,
      priced: priceCart([{ key: 'k', productId: pin.id, name: 'Pin', categoryId: null, unitPrice: P(100), qty: 1, free: false, freeReason: '', designerId: null }], [], []),
    });
  return { ev, device, session, newOrder, sellPin };
}

describe('Studio link', () => {
  it('payments by method add up to sales, with pickup deposits traced to how they were paid', async () => {
    const { ev, device, session, newOrder, sellPin } = await setup();
    const picked = await newOrder(500);
    await takeDeposit(picked, P(250), { session, device, cashierId: null, payments: [cash(250)] });
    await pickUpOrder((await db.orders.get(picked.id))!, { session, device, cashierId: null, payments: [gcash(250)] });
    await sellPin([gcash(100)]);
    // A deposit for an order not picked up yet: money in, not a sale
    const waiting = await newOrder(300);
    await takeDeposit(waiting, P(100), { session, device, cashierId: null, payments: [cash(100)] });

    const feed = (await eventFeed(ev.id))!;
    expect(feed.gross).toBe(P(600));
    expect(feed.methods).toEqual([
      { methodId: 'gcash', name: 'GCash', kind: 'ewallet', amount: P(350) },
      { methodId: 'cash', name: 'Cash', kind: 'cash', amount: P(250) },
    ]);
    expect(sum(feed.methods.map((m) => m.amount))).toBe(feed.gross);
    expect(feed.depositsHeld).toBe(P(100));

    // Same numbers as the event report
    const report = (await loadReportInput(ev.id))!;
    expect(feed.cogs).toBe(report.share.cogs);
    expect(feed.joshworksNet).toBe(report.share.joshworksNet);
    expect(feed.transactions).toBe(report.metrics.transactions);
  });

  it('an order goes over with every payment toward it', async () => {
    const { device, session, newOrder } = await setup();
    const o = await newOrder(500);
    await takeDeposit(o, P(250), { session, device, cashierId: null, payments: [cash(250)] });
    await pickUpOrder((await db.orders.get(o.id))!, { session, device, cashierId: null, payments: [gcash(250)] });
    const feed = (await orderFeed(o.id))!;
    expect(feed).toMatchObject({ type: 'order', number: o.number, total: P(500), status: 'picked-up', customer: { name: 'Kaye', phone: '0917' } });
    expect(feed.payments.map((p) => [p.stage, p.name, p.amount])).toEqual([
      ['deposit', 'Cash', P(250)],
      ['pickup', 'GCash', P(250)],
    ]);
  });

  it('sending again updates the one row, and backups carry it', async () => {
    const { ev, sellPin } = await setup();
    await sellPin([cash(100)]);
    await sendEventToStudio(ev.id, 'Joshua');
    await sellPin([cash(100)]);
    await sendEventToStudio(ev.id, 'Joshua');
    const rows = alive(await db.studioFeed.toArray());
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(`event:${ev.id}`);
    expect(rows[0].feed.type === 'event' && rows[0].feed.gross).toBe(P(200));
    expect(SYNCED_TABLES).toContain('studioFeed');
  });

  it('one line per person and kind, with what was already paid', () => {
    const members = new Map<string, Member>([['m1', { id: 'm1', name: 'Ian Yap', email: 'ian@example.com' } as Member]]);
    const share = {
      staff: [
        { rosterId: 'r1', memberId: 'm1', name: 'Ian', roleLabel: 'Cashier', weight: 1, hours: 4, points: 4, amount: P(300), belowMin: false, topUp: 0 },
        { rosterId: 'r2', memberId: 'm1', name: 'Ian', roleLabel: 'Cashier', weight: 1, hours: 2, points: 2, amount: P(150), belowMin: false, topUp: 0 },
      ],
      royalties: [{ memberId: 'm1', name: 'Ian', units: 3, revenue: P(60), amount: P(6) }],
      partners: [],
    } as unknown as ShareResult;
    const payouts = [{ id: 'p', eventId: 'e', memberId: 'm1', kind: 'staff', amount: P(450), detail: '', status: 'paid', paidAt: 5, method: 'GCash', ref: '', createdAt: 0, updatedAt: 0 }] as Payout[];
    expect(feedPeople({ share, members, payouts })).toEqual([
      { memberId: 'm1', name: 'Ian Yap', email: 'ian@example.com', kind: 'staff', role: 'Cashier', amount: P(450), paid: P(450), paidAt: 5, method: 'GCash' },
      { memberId: 'm1', name: 'Ian Yap', email: 'ian@example.com', kind: 'royalty', role: 'Design royalty', amount: P(6), paid: 0, paidAt: null, method: '' },
    ]);
  });
});
