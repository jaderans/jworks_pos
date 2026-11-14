import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { alive, db } from '../src/db/db';
import { ensureDevice } from '../src/db/local';
import { setWriterDevice } from '../src/db/write';
import { toCents } from '../src/lib/money';
import { drawerState, eventMetrics, moneyIn } from '../src/domain/summary';
import { computeShare } from '../src/domain/share';
import { DEFAULT_PRINT_RATES as R, sheetsLine } from '../src/domain/print';
import { createEvent } from '../src/services/events';
import { addCashMove, changeSalePayments, closeSession, openSession, removeCashMove, updateCashMove, voidSale } from '../src/services/sales';
import { blankDelivery, createPrintOrder, deletePrintOrder, printDeleteBlock, takePrintPayment } from '../src/services/print';
import type { Sale, Session } from '../src/db/types';

const P = toCents;
const gcash = { id: 'gcash', name: 'GCash', kind: 'ewallet' as const };

beforeEach(async () => {
  await db.delete();
  await db.open();
  setWriterDevice((await ensureDevice()).deviceId);
});

const sale = (over: Partial<Sale>): Sale =>
  ({ id: Math.random().toString(36), sessionId: 's1', status: 'completed', deleted: 0, lines: [], payments: [], total: 0, subtotal: 0, discountTotal: 0, discounts: [], at: 1, ...over }) as Sale;

describe('money in, by payment method', () => {
  // Register C at Hilway November 2026: ₱2,000 float, then cash out ₱200, ₱200 into GCash, ₱100 cash back.
  const session = (moves: Session['cashMoves']): Session => ({ id: 's1', letter: 'C', openingFloat: P(2000), cashMoves: moves, closedAt: null, countedTotal: null, deleted: 0 }) as Session;
  const sales = [
    sale({ total: P(1925), payments: [{ methodId: 'cash-id', name: 'Cash', kind: 'cash', amount: P(1925), tendered: P(1925), ref: '' }] }),
    sale({ total: P(565), payments: [{ methodId: 'gcash', name: 'GCash', kind: 'ewallet', amount: P(565), tendered: null, ref: '1' }] }),
  ];
  const moves: Session['cashMoves'] = [
    { id: 'm1', at: 2, kind: 'out', amount: P(200), reason: '', by: null },
    { id: 'm2', at: 3, kind: 'in', amount: P(200), reason: '', by: null, method: gcash },
    { id: 'm3', at: 4, kind: 'in', amount: P(100), reason: '', by: null },
  ];

  it('GCash moves change the GCash total, not the drawer', () => {
    const s = session(moves);
    expect(drawerState(s, sales).expected).toBe(P(2000 + 1925 - 200 + 100));
    const m = moneyIn(sales, [s]);
    expect(m.methods.map((l) => [l.name, l.taken, l.moves, l.amount])).toEqual([
      ['Cash', P(1925), P(-100), P(1825)],
      ['GCash', P(565), P(200), P(765)],
    ]);
    expect(m.total).toBe(P(1825 + 765));
    expect([m.movesIn, m.movesOut]).toEqual([P(300), P(200)]);
    expect(m.drawers).toBe(P(3825));
  });

  it('moves recorded before the method was asked are cash', () => {
    const old = moves.map(({ method: _m, ...x }) => x);
    expect(drawerState(session(old), sales).expected).toBe(P(2000 + 1925 - 200 + 200 + 100));
  });

  it('deposits and services are money in; a pickup’s deposit part isn’t counted twice', () => {
    const cash = (amount: number) => ({ methodId: 'cash-id', name: 'Cash', kind: 'cash' as const, amount: P(amount), tendered: P(amount), ref: '' });
    const m = moneyIn(
      [
        sale({ kind: 'deposit', total: P(100), payments: [cash(100)] }),
        sale({ total: P(240), payments: [{ methodId: 'deposit', name: 'Order deposit', kind: 'deposit', amount: P(100), tendered: null, ref: '' }, cash(140)] }),
        sale({ kind: 'service', total: P(420), payments: [cash(420)] }),
        sale({ status: 'voided', total: P(50), payments: [cash(50)] }),
      ],
      [],
    );
    expect(m.total).toBe(P(660));
    expect([m.sales, m.deposits, m.depositsApplied, m.services]).toEqual([P(240), P(100), P(100), P(420)]);
  });
});

describe('cash moves', () => {
  async function register() {
    const device = await ensureDevice();
    const ev = await createEvent({ name: 'Hilway' });
    return { device, ev, session: await openSession(ev.id, device, P(2000), null) };
  }

  it('records the method, and a wrong move can be fixed or removed', async () => {
    const { session } = await register();
    await addCashMove(session.id, 'out', P(200), 'Change', null);
    await addCashMove(session.id, 'in', P(200), 'GCash cash-in', null);
    await addCashMove(session.id, 'out', P(100), '', null);
    let s = (await db.sessions.get(session.id))!;
    // The second was GCash, and the last was ₱100 back in.
    await updateCashMove(session.id, s.cashMoves[1].id, { kind: 'in', amount: P(200), reason: 'GCash cash-in', method: gcash });
    await updateCashMove(session.id, s.cashMoves[2].id, { kind: 'in', amount: P(100), reason: 'Back in', method: undefined });
    s = (await db.sessions.get(session.id))!;
    expect(s.cashMoves.map((m) => [m.kind, m.amount, m.method?.name ?? 'Cash'])).toEqual([['out', P(200), 'Cash'], ['in', P(200), 'GCash'], ['in', P(100), 'Cash']]);
    expect(drawerState(s, []).expected).toBe(P(1900));
    await removeCashMove(session.id, s.cashMoves[0].id);
    expect((await db.sessions.get(session.id))!.cashMoves).toHaveLength(2);
  });

  it('fixing a move on a closed register works out its expected drawer again', async () => {
    const { session } = await register();
    await addCashMove(session.id, 'out', P(100), '', null);
    const closed = (await closeSession(session.id, { '1000': 1, '500': 1, '200': 2 }, '', null))!;
    expect(closed.expected).toBe(P(1900));
    await updateCashMove(session.id, closed.cashMoves[0].id, { kind: 'in', amount: P(100), reason: '', method: undefined });
    expect((await db.sessions.get(session.id))!.expected).toBe(P(2100));
  });
});

describe('sticker printing paid at the register', () => {
  async function setup() {
    const device = await ensureDevice();
    const ev = await createEvent({ name: 'Hilway' });
    const session = await openSession(ev.id, device, P(2000), null);
    const o = await createPrintOrder({ customerId: null, customerName: 'Cenon Salazar', contact: '0917', lines: [sheetsLine(R, 'std-matte-glossy', 'die', 6)], delivery: blankDelivery(), printerId: null, files: '', notes: '' }, device);
    return { device, ev, session, o };
  }
  const pay = (amount: number, kind: 'cash' | 'ewallet' = 'ewallet') =>
    kind === 'cash' ? { methodId: 'cash', name: 'Cash', kind, amount: P(amount), ref: '', by: null } : { methodId: 'gcash', name: 'GCash', kind, amount: P(amount), ref: '55', by: null };

  it('is a sale under Services: money in and in the drawer, never in the booth’s sales or share', async () => {
    const { device, ev, session, o } = await setup();
    await takePrintPayment(o.id, pay(210), { session, device });
    await takePrintPayment(o.id, pay(210, 'cash'), { session, device });
    const sales = alive(await db.sales.toArray());
    expect(sales.map((s) => [s.kind, s.printOrderId, s.total, s.eventId])).toEqual([
      ['service', o.id, P(210), ev.id],
      ['service', o.id, P(210), ev.id],
    ]);
    const order = (await db.printOrders.get(o.id))!;
    expect(order.payments.map((p) => p.saleId).sort()).toEqual(sales.map((s) => s.id).sort());

    const m = eventMetrics(sales, []);
    expect([m.gross, m.transactions, m.servicesTaken]).toEqual([0, 0, P(420)]);
    expect(moneyIn(sales, [session]).total).toBe(P(420));
    expect(drawerState(session, sales).expected).toBe(P(2210));
    // The drawer has no cash move for it: the sale is the record.
    expect((await db.sessions.get(session.id))!.cashMoves).toEqual([]);
    const share = computeShare({ event: ev, sales, products: new Map(), costOf: () => ({ cost: null, source: 'none' }) as never, roster: [], members: new Map(), deals: [], eventProducts: [], spend: [] });
    expect(share.gross).toBe(0);
  });

  it('voiding the sale takes the payment off the order; it can’t be deleted until then', async () => {
    const { device, session, o } = await setup();
    await takePrintPayment(o.id, pay(210), { session, device });
    const [s] = alive(await db.sales.toArray());
    expect(await printDeleteBlock((await db.printOrders.get(o.id))!)).toMatch(new RegExp(`Void ${s.receiptNo}`));
    await expect(deletePrintOrder(o.id)).rejects.toThrow(/paid at the register/);

    await changeSalePayments(s.id, [{ methodId: 'maya', name: 'Maya', kind: 'ewallet', amount: P(210), tendered: null, ref: '' }]);
    expect((await db.printOrders.get(o.id))!.payments[0].name).toBe('Maya');

    await voidSale(s.id, 'Wrong order', null);
    expect((await db.printOrders.get(o.id))!.payments).toEqual([]);
    await deletePrintOrder(o.id);
    expect(alive(await db.printOrders.toArray())).toEqual([]);
  });

  it('with no register open it can still count at an event: a sale in no drawer', async () => {
    const { device, ev, session, o } = await setup();
    await takePrintPayment(o.id, pay(210), null, { eventId: ev.id, device });
    const [sale] = alive(await db.sales.toArray());
    expect(sale).toMatchObject({ kind: 'service', sessionId: '', eventId: ev.id, total: P(210), printOrderId: o.id });
    expect((await db.printOrders.get(o.id))!.payments[0].saleId).toBe(sale.id);
    expect(moneyIn([sale], [session]).total).toBe(P(210));
    expect(drawerState(session, [sale]).expected).toBe(P(2000));
  });

  it('with no register open it stays on the order', async () => {
    const { o } = await setup();
    await takePrintPayment(o.id, pay(210), null);
    expect(alive(await db.sales.toArray())).toEqual([]);
    expect((await db.printOrders.get(o.id))!.payments.map((p) => [p.amount, p.saleId])).toEqual([[P(210), undefined]]);
  });
});
