import { db, alive } from '../db/db';
import { audit, create, patch, remove } from '../db/write';
import { getLocal, setLocal, type DeviceInfo } from '../db/local';
import { getSetting } from '../db/settings';
import { peso, sum, type Cents } from '../lib/money';
import { todayISO } from '../lib/time';
import { uid } from '../lib/ids';
import { PRINT_STATUS_LABEL, addWorkingDays, lineTotal, printTotals } from '../domain/print';
import { claimId } from '../domain/coupons';
import { completeSale } from './sales';
import { priceCart } from '../domain/cart';
import { ORDER_LINE } from '../domain/orders';
import { resolveCoupon, syncClaim } from './coupons';
import { designNoOf } from './orders';
import type { PayKind, PrintDelivery, PrintLine, PrintOrder, PrintRates, PrintStatus, Sale, Session } from '../db/types';

/**
 * Sticker printing jobs: quote → proof → 50% down → print → ready → picked up
 * or shipped with the balance. Payments live on the order (GCash, bank or
 * cash), not in an event's sales; JoshWorks Studio books them as a job.
 */

/** PA-001, PA-002… with this device's register letter, so two phones never give the same number. */
async function nextPrintNumber(letter: string): Promise<string> {
  const taken = new Set((await db.printOrders.toArray()).map((o) => o.number));
  let n = (await getLocal<number>('printSeq', 0)) + 1;
  const fmt = (k: number) => `P${letter}-${String(k).padStart(3, '0')}`;
  while (taken.has(fmt(n))) n++;
  await setLocal('printSeq', n);
  return fmt(n);
}

export interface NewPrintOrder {
  customerId: string | null;
  customerName: string;
  contact: string;
  lines: PrintLine[];
  delivery: PrintDelivery;
  printerId: string | null;
  files: string;
  notes: string;
  /** A service coupon code; checked against the print work when the order is saved. */
  couponCode?: string;
  /** Who draws the sticker art, for orders with illustration. */
  illustratorId?: string | null;
  /** The custom sticker design's number, e.g. CS01. */
  designNo?: string;
}

export const blankDelivery = (): PrintDelivery => ({ method: 'pickup', courier: '', address: '', fee: 0, tracking: '' });

function check(o: Pick<NewPrintOrder, 'lines' | 'customerId' | 'customerName' | 'delivery'>) {
  if (!o.customerId && !o.customerName.trim()) throw new Error('Add who the order is for.');
  if (!o.lines.length) throw new Error('Add what to print.');
  for (const l of o.lines) {
    if (!l.label.trim()) throw new Error('Every line needs a description.');
    if (!(l.qty > 0)) throw new Error(`Set how many for ${l.label}.`);
    if (!(l.unitPrice >= 0)) throw new Error(`Set the price of ${l.label}.`);
  }
  if (o.delivery.method === 'courier' && !o.delivery.address.trim()) throw new Error('Add the delivery address for the courier.');
}

const clean = ({ couponCode: _code, ...o }: NewPrintOrder): Omit<NewPrintOrder, 'couponCode'> => ({
  ...o,
  customerName: o.customerName.trim(),
  contact: o.contact.trim(),
  files: o.files.trim(),
  designNo: designNoOf(o.designNo),
  notes: o.notes.trim(),
  lines: o.lines.map((l) => ({ ...l, label: l.label.trim() })),
  delivery: { ...o.delivery, courier: o.delivery.courier.trim(), address: o.delivery.address.trim(), tracking: o.delivery.tracking.trim(), fee: o.delivery.method === 'courier' ? Math.max(0, o.delivery.fee) : 0 },
});

/** The print work's price, before the coupon and the delivery fee. */
const printWork = (lines: readonly PrintLine[]): Cents => sum(lines.map(lineTotal));

const claimFor = (o: PrintOrder) => ({ source: 'print' as const, sourceId: o.id, service: `Service order ${o.number}`, customerId: o.customerId, customerName: o.customerName, price: printWork(o.lines) });

export async function createPrintOrder(o: NewPrintOrder, device: DeviceInfo): Promise<PrintOrder> {
  check(o);
  const rates = await getSetting<PrintRates>('printRates');
  const id = uid();
  const coupon = await resolveCoupon(o.couponCode, printWork(o.lines), claimId('print', id));
  const number = await nextPrintNumber(device.letter);
  const order = await create<PrintOrder>(db.printOrders, {
    id,
    ...clean(o),
    coupon,
    number,
    status: 'quote',
    statusAt: Date.now(),
    proofAt: null,
    approvedAt: null,
    dueDate: '',
    printerPct: rates.printerPct,
    illustratorPct: rates.illustration.artistPct,
    payments: [],
    doneAt: null,
  });
  await syncClaim(claimFor(order), coupon);
  const t = printTotals(order, rates.downPct);
  await audit('create', 'print', order.id, `Service order ${number} for ${order.customerName || 'a customer'}: ${peso(t.total)}`);
  return order;
}

async function get(id: string): Promise<PrintOrder> {
  const o = await db.printOrders.get(id);
  if (!o || o.deleted === 1) throw new Error('That service order no longer exists.');
  return o;
}

export async function updatePrintOrder(id: string, changes: NewPrintOrder & { printerPct?: number; illustratorPct?: number }): Promise<void> {
  const o = await get(id);
  if (o.status === 'done' || o.status === 'cancelled') return updateClosedPrint(o, changes);
  check(changes);
  const coupon = await resolveCoupon(changes.couponCode, printWork(changes.lines), claimId('print', id));
  const { printerPct, illustratorPct, ...rest } = changes;
  const next = { ...clean(rest), coupon, ...(printerPct !== undefined ? { printerPct } : {}), ...(illustratorPct !== undefined ? { illustratorPct } : {}) };
  await patch(db.printOrders, id, next);
  await syncClaim(claimFor({ ...o, ...next }), coupon);
}

/** A closed order keeps what was printed and its price. Who it's for, who printed it, the files and the notes can still be fixed. */
async function updateClosedPrint(o: PrintOrder, { printerPct, illustratorPct, ...changes }: NewPrintOrder & { printerPct?: number; illustratorPct?: number }): Promise<void> {
  const fixed = clean({ ...changes, lines: o.lines, delivery: o.delivery });
  check(fixed);
  const { customerId, customerName, contact, printerId, files, notes, designNo } = fixed;
  const details = {
    customerId, customerName, contact, printerId, files, notes, designNo,
    ...(fixed.illustratorId !== undefined ? { illustratorId: fixed.illustratorId } : {}),
    ...(printerPct !== undefined ? { printerPct } : {}),
    ...(illustratorPct !== undefined ? { illustratorPct } : {}),
  };
  await patch(db.printOrders, o.id, details);
  if (o.status === 'done') await syncClaim(claimFor({ ...o, ...details }), o.coupon);
}

/** Why a print order can't be deleted yet: a payment taken at the register is a sale, voided first. Null when it can. */
export async function printDeleteBlock(o: PrintOrder): Promise<string | null> {
  const ids = o.payments.map((p) => p.saleId).filter((x): x is string => !!x);
  const sales = (await db.sales.bulkGet(ids)).filter((s): s is Sale => !!s && s.status === 'completed' && s.deleted !== 1);
  return sales.length ? `${o.number} was paid at the register. Void ${sales.map((s) => s.receiptNo).join(' and ')} in the Sales log first.` : null;
}

/** Delete a print order, with its coupon use and any payments on it. Its summary leaves Studio by itself (see printFeed). */
export async function deletePrintOrder(id: string): Promise<void> {
  const o = await get(id);
  const blocked = await printDeleteBlock(o);
  if (blocked) throw new Error(blocked);
  const paid = sum(o.payments.map((p) => p.amount));
  await syncClaim(claimFor(o), null);
  await remove(db.printOrders, id);
  await audit('delete', 'print', id, `Deleted ${o.number} for ${o.customerName || 'a customer'}${paid ? `, with ${peso(paid)} paid` : ''}`);
}

export async function markProofSent(id: string): Promise<void> {
  const o = await get(id);
  await patch(db.printOrders, id, { proofAt: Date.now() });
  await audit('status', 'print', id, `${o.number}: proof sent`);
}

/** The customer approved the proof: the lead time starts. */
export async function approvePrint(id: string): Promise<string> {
  const o = await get(id);
  const rates = await getSetting<PrintRates>('printRates');
  const dueDate = addWorkingDays(todayISO(), rates.leadDays.max);
  await patch(db.printOrders, id, { approvedAt: Date.now(), dueDate });
  await audit('status', 'print', id, `${o.number}: proof approved, ready by ${dueDate}`);
  return dueDate;
}

export async function setPrintStatus(id: string, status: PrintStatus, tracking?: string): Promise<void> {
  const o = await get(id);
  if (o.status === status) return;
  const changes: Partial<PrintOrder> = { status, statusAt: Date.now() };
  if (status === 'printing' && !o.approvedAt) {
    const rates = await getSetting<PrintRates>('printRates');
    changes.approvedAt = Date.now();
    changes.dueDate = addWorkingDays(todayISO(), rates.leadDays.max);
  }
  if (status === 'done') changes.doneAt = Date.now();
  if (tracking !== undefined) changes.delivery = { ...o.delivery, tracking: tracking.trim() };
  await patch(db.printOrders, id, changes);
  const how = status === 'done' ? (o.delivery.method === 'courier' ? 'shipped' : 'picked up') : PRINT_STATUS_LABEL[status].toLowerCase();
  await audit('status', 'print', id, `${o.number}: ${how}`);
}

export interface PrintPaymentInput {
  methodId: string;
  name: string;
  kind: PayKind;
  amount: Cents;
  ref: string;
  by: string | null;
}

/**
 * Money toward a print order. With a register open on this phone it's taken as
 * a sale there (a service, kept apart from the booth's merch), so it shows in
 * the Sales log, the money totals and the drawer. Otherwise it stays on the order.
 */
export async function takePrintPayment(
  id: string,
  p: PrintPaymentInput,
  register: { session: Session; device: DeviceInfo } | null,
  /** With no register open: count it at this event anyway, in no drawer. */
  noRegister?: { eventId: string; device: DeviceInfo } | null,
): Promise<void> {
  const o = await get(id);
  const rates = await getSetting<PrintRates>('printRates');
  const t = printTotals(o, rates.downPct);
  if (!(p.amount > 0)) throw new Error('Enter the amount.');
  if (p.amount > t.balance) throw new Error(`That's more than the ${peso(t.balance)} still due.`);
  const stage = t.paid < t.down ? 'down' : 'balance';
  let saleId: string | undefined;
  const open = register && register.session.closedAt === null ? register : null;
  const at = open ? { eventId: open.session.eventId, session: open.session, device: open.device } : noRegister ? { eventId: noRegister.eventId, session: null, device: noRegister.device } : null;
  if (at) {
    const name = `${stage === 'down' ? 'Down payment' : 'Payment'} · service order ${o.number}`;
    const priced = priceCart([{ key: 'print', productId: `${ORDER_LINE}print:${o.id}`, name, categoryId: null, unitPrice: p.amount, qty: 1, free: false, freeReason: '', designerId: null }], [], []);
    const sale = await completeSale({
      eventId: at.eventId,
      session: at.session,
      device: at.device,
      cashierId: p.by,
      priced,
      payments: [{ methodId: p.methodId, name: p.name, kind: p.kind, amount: p.amount, tendered: p.kind === 'cash' ? p.amount : null, ref: p.ref }],
      note: `Sticker printing for ${o.customerName || 'a customer'}`,
      customerId: o.customerId,
      kind: 'service',
      printOrderId: o.id,
    });
    saleId = sale.id;
  }
  await patch(db.printOrders, id, { payments: [...o.payments, { id: uid(), at: Date.now(), methodId: p.methodId, name: p.name, kind: p.kind, amount: p.amount, ref: p.ref.trim(), stage, by: p.by, ...(saleId ? { saleId } : {}) }] });
  await audit('payment', 'print', id, `${o.number}: ${stage === 'down' ? 'down payment' : 'payment'} ${peso(p.amount)} (${p.name})${saleId ? ', taken at the register' : ''}`);
}

export async function cancelPrint(id: string, reason: string): Promise<void> {
  const o = await get(id);
  await syncClaim(claimFor(o), null);
  await patch(db.printOrders, id, { status: 'cancelled', statusAt: Date.now(), notes: reason.trim() ? `${o.notes ? `${o.notes}\n` : ''}Cancelled: ${reason.trim()}` : o.notes });
  await audit('status', 'print', id, `${o.number}: cancelled${reason.trim() ? ` (${reason.trim()})` : ''}`);
}

export async function openPrintOrders(): Promise<PrintOrder[]> {
  return alive(await db.printOrders.toArray()).filter((o) => o.status !== 'done' && o.status !== 'cancelled');
}
