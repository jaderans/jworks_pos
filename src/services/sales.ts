import { db, alive } from '../db/db';
import { audit, build, create, patch } from '../db/write';
import { nextReceiptSeq, type DeviceInfo } from '../db/local';
import { receiptNumber, uid } from '../lib/ids';
import { peso, type Cents } from '../lib/money';
import { checkPayments, toAppliedDiscounts, toSaleLines, type PricedCart } from '../domain/cart';
import { countTotal, drawerState, moveMethod } from '../domain/summary';
import { voidEarnedCoupons } from './coupons';
import type { CashMove, Sale, SalePayment, Session, StockMove } from '../db/types';

export async function openSessionFor(eventId: string, deviceId: string): Promise<Session | undefined> {
  const rows = alive(await db.sessions.where('eventId').equals(eventId).toArray());
  return rows.filter((s) => s.deviceId === deviceId && s.closedAt === null).sort((a, b) => b.openedAt - a.openedAt)[0];
}

export async function openSession(eventId: string, device: DeviceInfo, openingFloat: Cents, by: string | null): Promise<Session> {
  const existing = await openSessionFor(eventId, device.deviceId);
  if (existing) return existing;
  const s = await create<Session>(db.sessions, {
    eventId,
    deviceId: device.deviceId,
    letter: device.letter,
    openedAt: Date.now(),
    openedBy: by,
    openingFloat,
    cashMoves: [],
    closedAt: null,
    closedBy: null,
    counted: null,
    countedTotal: null,
    expected: null,
    notes: '',
  });
  await audit('open', 'session', s.id, `Opened register ${device.letter} with a ${peso(openingFloat)} float`);
  return s;
}

const moveText = (m: Pick<CashMove, 'kind' | 'amount' | 'method'>) => `${m.kind === 'in' ? 'In' : 'Out'} ${peso(m.amount)} (${moveMethod(m as CashMove).name})`;

/** Money in or out of a register that isn't a sale: the drawer's cash, or GCash and the like. */
export async function addCashMove(sessionId: string, kind: CashMove['kind'], amount: Cents, reason: string, by: string | null, method?: CashMove['method']): Promise<void> {
  const s = await db.sessions.get(sessionId);
  if (!s) return;
  const move: CashMove = { id: uid(), at: Date.now(), kind, amount, reason: reason.trim(), by, ...(method ? { method } : {}) };
  await patch(db.sessions, sessionId, { cashMoves: [...(s.cashMoves ?? []), move] });
  await audit('cash', 'session', sessionId, `Register ${s.letter}: ${moveText(move)}${move.reason ? `: ${move.reason}` : ''}`);
}

/**
 * Fix a cash move recorded wrong (in instead of out, cash instead of GCash, the
 * amount). A closed register's expected drawer is worked out again.
 */
export async function updateCashMove(sessionId: string, moveId: string, changes: Pick<CashMove, 'kind' | 'amount' | 'reason' | 'method'>): Promise<void> {
  const s = await db.sessions.get(sessionId);
  const before = s?.cashMoves?.find((m) => m.id === moveId);
  if (!s || !before) throw new Error('That cash move no longer exists.');
  if (!(changes.amount > 0)) throw new Error('Enter the amount.');
  const cashMoves = s.cashMoves.map((m) => (m.id === moveId ? { ...m, ...changes, reason: changes.reason.trim() } : m));
  await saveMoves(s, cashMoves);
  await audit('cash', 'session', sessionId, `Register ${s.letter}: changed ${moveText(before)} to ${moveText(changes)}`);
}

export async function removeCashMove(sessionId: string, moveId: string): Promise<void> {
  const s = await db.sessions.get(sessionId);
  const before = s?.cashMoves?.find((m) => m.id === moveId);
  if (!s || !before) return;
  await saveMoves(s, s.cashMoves.filter((m) => m.id !== moveId));
  await audit('cash', 'session', sessionId, `Register ${s.letter}: removed ${moveText(before)}`);
}

async function saveMoves(s: Session, cashMoves: CashMove[]) {
  if (s.closedAt === null) return patch(db.sessions, s.id, { cashMoves });
  const sales = alive(await db.sales.where('sessionId').equals(s.id).toArray());
  await patch(db.sessions, s.id, { cashMoves, expected: drawerState({ ...s, cashMoves }, sales).expected });
}

export async function closeSession(sessionId: string, counted: Record<string, number>, notes: string, by: string | null): Promise<Session | undefined> {
  const s = await db.sessions.get(sessionId);
  if (!s) return undefined;
  const sales = alive(await db.sales.where('sessionId').equals(sessionId).toArray());
  const d = drawerState(s, sales);
  const total = countTotal(counted);
  await patch(db.sessions, sessionId, { closedAt: Date.now(), closedBy: by, counted, countedTotal: total, expected: d.expected, notes });
  const diff = total - d.expected;
  await audit('close', 'session', sessionId, `Closed register ${s.letter}: expected ${peso(d.expected)}, counted ${peso(total)} (${diff === 0 ? 'balanced' : diff > 0 ? `over ${peso(diff)}` : `short ${peso(-diff)}`})`);
  return db.sessions.get(sessionId);
}

export async function reopenSession(sessionId: string): Promise<void> {
  await patch(db.sessions, sessionId, { closedAt: null, closedBy: null });
  await audit('reopen', 'session', sessionId, 'Reopened a closed register');
}

export interface CompleteSaleInput {
  eventId: string;
  session: Session;
  device: DeviceInfo;
  cashierId: string | null;
  priced: PricedCart;
  payments: SalePayment[];
  note: string;
  customerId?: string | null;
  voucherCode?: string;
  kind?: 'deposit' | 'service';
  orderId?: string;
  printOrderId?: string;
  prizeFor?: string;
}

/** Save a sale and take its items out of stock, in one transaction. */
export async function completeSale(input: CompleteSaleInput): Promise<Sale> {
  const check = checkPayments(input.priced.total, input.payments);
  if (!check.ok) throw new Error(check.message);
  if (input.priced.lines.length === 0) throw new Error('The cart is empty.');
  return db.transaction('rw', [db.sales, db.stockMoves, db.products, db.local], async () => {
    const seq = await nextReceiptSeq();
    const now = Date.now();
    const sale = build<Sale>({
      eventId: input.eventId,
      sessionId: input.session.id,
      deviceId: input.device.deviceId,
      receiptNo: receiptNumber(input.device.letter, seq),
      at: now,
      cashierId: input.cashierId,
      lines: toSaleLines(input.priced),
      subtotal: input.priced.subtotal,
      discountTotal: input.priced.discountTotal,
      discounts: toAppliedDiscounts(input.priced),
      total: input.priced.total,
      payments: input.payments.map((p) => ({ ...p, ref: p.ref.trim() })),
      change: check.change,
      note: input.note.trim(),
      status: 'completed',
      voidedAt: null,
      voidedBy: null,
      voidReason: '',
      customerId: input.customerId ?? null,
      voucherCode: input.voucherCode || undefined,
      kind: input.kind,
      orderId: input.orderId,
      printOrderId: input.printOrderId,
      prizeFor: input.prizeFor,
    });
    await db.sales.put(sale);
    const ids = [...new Set(sale.lines.map((l) => l.productId))];
    const products = await db.products.bulkGet(ids);
    const tracked = new Set(products.filter((p) => p && p.trackStock === 1).map((p) => p!.id));
    const moves = sale.lines
      .filter((l) => tracked.has(l.productId))
      .map((l) => build<StockMove>({ productId: l.productId, qty: -l.qty, kind: 'sale', refId: sale.id, eventId: sale.eventId, at: now, note: sale.receiptNo }));
    if (moves.length) await db.stockMoves.bulkPut(moves);
    return sale;
  });
}

/** Void a whole sale: it drops out of every total and its items go back to stock. */
export async function voidSale(saleId: string, reason: string, by: string | null): Promise<void> {
  // A print order's payment taken as this sale comes off the order, so its balance is due again.
  const voiding = await db.sales.get(saleId);
  if (voiding?.printOrderId && voiding.status === 'completed') {
    const o = await db.printOrders.get(voiding.printOrderId);
    if (o) await patch(db.printOrders, o.id, { payments: o.payments.filter((p) => p.saleId !== saleId) });
  }
  await db.transaction('rw', [db.sales, db.stockMoves, db.audit], async () => {
    const sale = await db.sales.get(saleId);
    if (!sale || sale.status === 'voided') return;
    await patch(db.sales, saleId, { status: 'voided', voidedAt: Date.now(), voidedBy: by, voidReason: reason.trim() });
    const saleMoves = alive(await db.stockMoves.where('refId').equals(saleId).toArray()).filter((m) => m.kind === 'sale');
    if (saleMoves.length) {
      await db.stockMoves.bulkPut(
        saleMoves.map((m) => build<StockMove>({ productId: m.productId, qty: -m.qty, kind: 'void', refId: saleId, eventId: m.eventId, at: Date.now(), note: `Void ${sale.receiptNo}` })),
      );
    }
    await audit('void', 'sale', saleId, `Voided ${sale.receiptNo} (${peso(sale.total)})${reason.trim() ? `: ${reason.trim()}` : ''}`);
  });
  // A coupon the sale earned goes with it, unless it was already used.
  await voidEarnedCoupons(saleId);
}

/** Fix a payment recorded under the wrong method (e.g. Cash that was really GCash). */
export async function changeSalePayments(saleId: string, payments: SalePayment[]): Promise<void> {
  const sale = await db.sales.get(saleId);
  if (!sale) return;
  const check = checkPayments(sale.total, payments);
  if (!check.ok) throw new Error(check.message);
  await patch(db.sales, saleId, { payments, change: check.change });
  // The print order it paid for shows the same method.
  const o = sale.printOrderId ? await db.printOrders.get(sale.printOrderId) : undefined;
  const [p] = payments;
  if (o && payments.length === 1 && p.kind !== 'deposit') {
    const how = { methodId: p.methodId, name: p.name, kind: p.kind };
    await patch(db.printOrders, o.id, { payments: o.payments.map((x) => (x.saleId === saleId ? { ...x, ...how } : x)) });
  }
  const from = sale.payments.map((p) => p.name).join(' + ');
  const to = payments.map((p) => p.name).join(' + ');
  await audit('payment', 'sale', saleId, `Changed payment on ${sale.receiptNo}: ${from} → ${to}`);
}

export async function updateSaleNote(saleId: string, note: string): Promise<void> {
  await patch(db.sales, saleId, { note });
}
