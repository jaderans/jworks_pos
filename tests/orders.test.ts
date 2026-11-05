import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { alive, db } from '../src/db/db';
import { ensureDevice } from '../src/db/local';
import { setWriterDevice } from '../src/db/write';
import { toCents } from '../src/lib/money';
import { eventMetrics, drawerState } from '../src/domain/summary';
import { computeShare } from '../src/domain/share';
import { makeCostIndex } from '../src/domain/cost';
import { onHandByProduct } from '../src/domain/stock';
import { depositsHeld, orderMoney } from '../src/domain/orders';
import { createProduct } from '../src/services/catalog';
import { createEvent } from '../src/services/events';
import { openSession } from '../src/services/sales';
import { adjustStock, setManualCost } from '../src/services/production';
import { cancelOrder, createOrder, deleteOrder, pickUpOrder, takeDeposit, updateOrder } from '../src/services/orders';
import { voidSale } from '../src/services/sales';
import { sendOrderToStudio } from '../src/services/studio';
import { STUDIO_FEED_ID } from '../src/domain/studioFeed';
import type { SalePayment } from '../src/db/types';

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
  const order = await createOrder(
    {
      eventId: ev.id, customerId: null, customerName: 'Kaye', contact: '0917', designerId: null, dueAt: '', notes: '',
      lines: [
        { productId: pin.id, name: 'Pin', categoryId: null, designerId: null, qty: 2, unitPrice: P(100) },
        { productId: null, name: 'Custom portrait sticker', categoryId: null, designerId: null, qty: 1, unitPrice: P(300) },
      ],
    },
    device,
  );
  return { ev, pin, device, session, order };
}

const metricsNow = async (eventId: string) => eventMetrics(alive(await db.sales.where('eventId').equals(eventId).toArray()), []);

describe('pre-orders', () => {
  it('numbers orders with the register letter', async () => {
    const { order, ev, device } = await setup();
    expect(order.number).toBe(`Q${device.letter}-01`);
    const second = await createOrder({ ...order, eventId: ev.id }, device);
    expect(second.number).toBe(`Q${device.letter}-02`);
  });

  it('a deposit is money in, not a sale, until pickup', async () => {
    const { ev, pin, device, session, order } = await setup();
    await takeDeposit(order, P(250), { session, device, cashierId: null, payments: [cash(250)] });

    let m = await metricsNow(ev.id);
    expect(m.gross).toBe(0);
    expect(m.transactions).toBe(0);
    expect(m.depositsTaken).toBe(P(250));
    expect(m.byMethod.find((x) => x.methodId === 'cash')?.amount).toBe(P(250));
    const sales1 = alive(await db.sales.toArray());
    expect(drawerState(session, sales1).expected).toBe(P(1000 + 250));
    expect(orderMoney(order, sales1)).toMatchObject({ total: P(500), paid: P(250), balance: P(250) });
    expect(depositsHeld([order], sales1)).toBe(P(250));
    // Stock doesn't move for a deposit.
    expect(onHandByProduct(alive(await db.stockMoves.toArray())).get(pin.id)).toBe(10);

    // Pickup: the real items, paid by the deposit plus GCash for the balance.
    await expect(takeDeposit(order, P(300), { session, device, cashierId: null, payments: [cash(300)] })).rejects.toThrow(/more than/);
    const sale = await pickUpOrder(order, { session, device, cashierId: null, payments: [gcash(250)] });
    expect(sale.total).toBe(P(500));
    expect(sale.payments.map((p) => [p.kind, p.amount])).toEqual([
      ['deposit', P(250)],
      ['ewallet', P(250)],
    ]);
    expect((await db.orders.get(order.id))!.status).toBe('picked-up');

    m = await metricsNow(ev.id);
    expect(m.gross).toBe(P(500));
    expect(m.transactions).toBe(1);
    expect(m.depositsApplied).toBe(P(250));
    // Money received over both days adds up to the sale: ₱250 cash + ₱250 GCash, the deposit tender not counted twice.
    expect(m.byMethod.map((x) => [x.methodId, x.amount]).sort()).toEqual([
      ['cash', P(250)],
      ['gcash', P(250)],
    ]);
    const sales2 = alive(await db.sales.toArray());
    expect(drawerState(session, sales2).expected).toBe(P(1250));
    expect(depositsHeld([(await db.orders.get(order.id))!], sales2)).toBe(0);
    expect(onHandByProduct(alive(await db.stockMoves.toArray())).get(pin.id)).toBe(8);

    // Profit: the pins' production cost, nothing missing for the custom piece.
    const share = computeShare({
      event: (await db.events.get(ev.id))!, sales: sales2, products: new Map([[pin.id, pin]]),
      costOf: makeCostIndex(alive(await db.costPoints.toArray())), roster: [], members: new Map(), deals: [], eventProducts: [], spend: [],
    });
    expect(share.gross).toBe(P(500));
    expect(share.cogs).toBe(P(60));
    expect(share.cogsMissing).toEqual([]);
  });

  it('a cancelled order refunds its deposit, or keeps it as a sale', async () => {
    const { ev, device, session, order } = await setup();
    await takeDeposit(order, P(200), { session, device, cashierId: null, payments: [cash(200)] });
    await cancelOrder(order, 'refund', null);
    let m = await metricsNow(ev.id);
    expect(m.depositsTaken).toBe(0);
    expect(drawerState(session, alive(await db.sales.toArray())).expected).toBe(P(1000));
    expect((await db.orders.get(order.id))!.status).toBe('cancelled');

    const kept = await createOrder({ ...order, eventId: ev.id }, device);
    await takeDeposit(kept, P(150), { session, device, cashierId: null, payments: [cash(150)] });
    await cancelOrder(kept, 'keep', null);
    m = await metricsNow(ev.id);
    expect(m.gross).toBe(P(150));
    expect(m.depositsTaken).toBe(0);
  });
});

describe('editing and deleting orders', () => {
  const live = async (id: string) => alive(await db.orders.toArray()).find((o) => o.id === id);

  it('deletes an order with no money on it, and its summary leaves Studio but stays as a tombstone', async () => {
    const { order } = await setup();
    await sendOrderToStudio(order.id, 'Joshua');
    await cancelOrder(order, 'refund', null);
    await deleteOrder(order.id);
    expect(await live(order.id)).toBeUndefined();
    const row = await db.studioFeed.get(STUDIO_FEED_ID.order(order.id));
    expect(row?.deleted).toBe(1);
    expect(row?.feed).toMatchObject({ type: 'order', orderId: order.id });
  });

  it('won’t delete an order holding a deposit until it’s refunded', async () => {
    const { device, session, order } = await setup();
    await takeDeposit(order, P(250), { session, device, cashierId: null, payments: [cash(250)] });
    await expect(deleteOrder(order.id)).rejects.toThrow(/has a deposit/);
    expect(await live(order.id)).toBeDefined();
    await cancelOrder(order, 'refund', null);
    await deleteOrder(order.id);
    expect(await live(order.id)).toBeUndefined();
  });

  it('won’t delete a picked-up order until its sale is voided', async () => {
    const { device, session, order } = await setup();
    const sale = await pickUpOrder(order, { session, device, cashierId: null, payments: [cash(500)] });
    await expect(deleteOrder(order.id)).rejects.toThrow(new RegExp(`Void ${sale.receiptNo}`));
    await voidSale(sale.id, 'Test', null);
    await deleteOrder(order.id);
    expect(await live(order.id)).toBeUndefined();
  });

  it('a closed order keeps its items and price; the name and notes can still be fixed', async () => {
    const { order } = await setup();
    await sendOrderToStudio(order.id, 'Joshua');
    await cancelOrder(order, 'refund', null);
    await updateOrder(order.id, { customerName: 'Kaye Santos', notes: 'Fixed', lines: [] });
    const saved = await db.orders.get(order.id);
    expect(saved).toMatchObject({ customerName: 'Kaye Santos', notes: 'Fixed', status: 'cancelled' });
    expect(saved?.lines).toEqual(order.lines);
    const row = await db.studioFeed.get(STUDIO_FEED_ID.order(order.id));
    expect(row?.feed).toMatchObject({ customer: { name: 'Kaye Santos' } });
  });

  it('editing an order Studio has updates its summary; one it doesn’t have stays unsent', async () => {
    const { order } = await setup();
    await updateOrder(order.id, { notes: 'Not sent yet' });
    expect(await db.studioFeed.get(STUDIO_FEED_ID.order(order.id))).toBeUndefined();
    await sendOrderToStudio(order.id, 'Joshua');
    await updateOrder(order.id, { notes: 'Bigger size' });
    expect((await db.studioFeed.get(STUDIO_FEED_ID.order(order.id)))?.feed).toMatchObject({ notes: 'Bigger size' });
  });
});
