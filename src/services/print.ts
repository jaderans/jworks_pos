import { db, alive } from '../db/db';
import { audit, create, patch } from '../db/write';
import { getLocal, setLocal, type DeviceInfo } from '../db/local';
import { getSetting } from '../db/settings';
import { peso, sum, type Cents } from '../lib/money';
import { todayISO } from '../lib/time';
import { uid } from '../lib/ids';
import { PRINT_STATUS_LABEL, addWorkingDays, lineTotal, printTotals } from '../domain/print';
import { claimId } from '../domain/coupons';
import { addCashMove } from './sales';
import { resolveCoupon, syncClaim } from './coupons';
import type { PayKind, PrintDelivery, PrintLine, PrintOrder, PrintRates, PrintStatus, Session } from '../db/types';

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
  notes: o.notes.trim(),
  lines: o.lines.map((l) => ({ ...l, label: l.label.trim() })),
  delivery: { ...o.delivery, courier: o.delivery.courier.trim(), address: o.delivery.address.trim(), tracking: o.delivery.tracking.trim(), fee: o.delivery.method === 'courier' ? Math.max(0, o.delivery.fee) : 0 },
});

/** The print work's price, before the coupon and the delivery fee. */
const printWork = (lines: readonly PrintLine[]): Cents => sum(lines.map(lineTotal));

const claimFor = (o: PrintOrder) => ({ source: 'print' as const, sourceId: o.id, service: `Print order ${o.number}`, customerId: o.customerId, customerName: o.customerName, price: printWork(o.lines) });

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
    payments: [],
    doneAt: null,
  });
  await syncClaim(claimFor(order), coupon);
  const t = printTotals(order, rates.downPct);
  await audit('create', 'print', order.id, `Print order ${number} for ${order.customerName || 'a customer'}: ${peso(t.total)}`);
  return order;
}

async function get(id: string): Promise<PrintOrder> {
  const o = await db.printOrders.get(id);
  if (!o || o.deleted === 1) throw new Error('That print order no longer exists.');
  return o;
}

export async function updatePrintOrder(id: string, changes: NewPrintOrder & { printerPct?: number }): Promise<void> {
  const o = await get(id);
  if (o.status === 'done' || o.status === 'cancelled') throw new Error(`${o.number} is closed.`);
  check(changes);
  const coupon = await resolveCoupon(changes.couponCode, printWork(changes.lines), claimId('print', id));
  const { printerPct, ...rest } = changes;
  const next = { ...clean(rest), coupon, ...(printerPct !== undefined ? { printerPct } : {}) };
  await patch(db.printOrders, id, next);
  await syncClaim(claimFor({ ...o, ...next }), coupon);
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
 * Money toward a print order. Cash taken while this phone's register is open
 * goes in that drawer as a cash-in, so the drawer still counts out right.
 */
export async function takePrintPayment(id: string, p: PrintPaymentInput, session: Session | null): Promise<void> {
  const o = await get(id);
  const rates = await getSetting<PrintRates>('printRates');
  const t = printTotals(o, rates.downPct);
  if (!(p.amount > 0)) throw new Error('Enter the amount.');
  if (p.amount > t.balance) throw new Error(`That's more than the ${peso(t.balance)} still due.`);
  const stage = t.paid < t.down ? 'down' : 'balance';
  await patch(db.printOrders, id, { payments: [...o.payments, { id: uid(), at: Date.now(), methodId: p.methodId, name: p.name, kind: p.kind, amount: p.amount, ref: p.ref.trim(), stage, by: p.by }] });
  if (p.kind === 'cash' && session && session.closedAt === null) await addCashMove(session.id, 'in', p.amount, `Print order ${o.number}`, p.by);
  await audit('payment', 'print', id, `${o.number}: ${stage === 'down' ? 'down payment' : 'payment'} ${peso(p.amount)} (${p.name})`);
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
