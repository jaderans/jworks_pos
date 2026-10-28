import { db, alive } from '../db/db';
import { audit, create, patch } from '../db/write';
import { getLocal, setLocal, type DeviceInfo } from '../db/local';
import { peso, type Cents } from '../lib/money';
import { priceCart, type CartItem } from '../domain/cart';
import { ORDER_LINE, ORDER_STATUS_LABEL, orderMoney, orderTotal } from '../domain/orders';
import { completeSale, voidSale } from './sales';
import type { Order, OrderLine, OrderStatus, Sale, SalePayment, Session } from '../db/types';

const orderSales = async (orderId: string) => alive(await db.sales.where('orderId').equals(orderId).toArray());

/** QA-01, QA-02… per event, with this device's register letter so two phones never give the same number. */
async function nextOrderNumber(eventId: string, letter: string): Promise<string> {
  const key = `orderSeq:${eventId}`;
  const taken = new Set(alive(await db.orders.where('eventId').equals(eventId).toArray()).map((o) => o.number));
  let n = (await getLocal<number>(key, 0)) + 1;
  const fmt = (k: number) => `Q${letter}-${String(k).padStart(2, '0')}`;
  while (taken.has(fmt(n))) n++;
  await setLocal(key, n);
  return fmt(n);
}

export interface NewOrder {
  eventId: string;
  customerId: string | null;
  customerName: string;
  contact: string;
  lines: OrderLine[];
  designerId: string | null;
  dueAt: string;
  notes: string;
}

function check(o: Pick<NewOrder, 'lines' | 'customerId' | 'customerName'>) {
  if (!o.customerId && !o.customerName.trim()) throw new Error('Add who the order is for.');
  if (!o.lines.length) throw new Error('Add at least one item.');
  for (const l of o.lines) {
    if (!l.name.trim()) throw new Error('Every item needs a name.');
    if (!(l.qty > 0)) throw new Error(`Set how many of ${l.name}.`);
    if (!(l.unitPrice >= 0)) throw new Error(`Set the price of ${l.name}.`);
  }
}

export async function createOrder(o: NewOrder, device: DeviceInfo): Promise<Order> {
  check(o);
  const number = await nextOrderNumber(o.eventId, device.letter);
  const order = await create<Order>(db.orders, {
    ...o,
    customerName: o.customerName.trim(),
    contact: o.contact.trim(),
    notes: o.notes.trim(),
    lines: o.lines.map((l) => ({ ...l, name: l.name.trim() })),
    number,
    status: 'new',
    statusAt: Date.now(),
    pickupSaleId: null,
  });
  await audit('create', 'order', order.id, `Order ${number} for ${order.customerName || 'a customer'}: ${peso(orderTotal(order))}`);
  return order;
}

export async function updateOrder(id: string, changes: Partial<NewOrder>): Promise<void> {
  const o = await db.orders.get(id);
  if (!o) return;
  if (o.status === 'picked-up' || o.status === 'cancelled') throw new Error(`Order ${o.number} is closed.`);
  const next = { ...o, ...changes };
  check(next);
  await patch(db.orders, id, changes);
}

export async function setOrderStatus(id: string, status: OrderStatus): Promise<void> {
  const o = await db.orders.get(id);
  if (!o || o.status === status) return;
  await patch(db.orders, id, { status, statusAt: Date.now() });
  await audit('status', 'order', id, `Order ${o.number}: ${ORDER_STATUS_LABEL[status]}`);
}

export interface TakeMoney {
  session: Session;
  device: DeviceInfo;
  cashierId: string | null;
  payments: SalePayment[];
}

/** Money toward an order: in the drawer (or GCash) today, a sale at pickup. */
export async function takeDeposit(order: Order, amount: Cents, t: TakeMoney): Promise<Sale> {
  const m = orderMoney(order, await orderSales(order.id));
  if (!(amount > 0)) throw new Error('Enter the deposit amount.');
  if (amount > m.balance) throw new Error(`That's more than the ${peso(m.balance)} still due.`);
  const priced = priceCart(
    [{ key: 'deposit', productId: `${ORDER_LINE}${order.id}`, name: `Deposit · order ${order.number}`, categoryId: null, unitPrice: amount, qty: 1, free: false, freeReason: '', designerId: null }],
    [],
    [],
  );
  const sale = await completeSale({
    eventId: t.session.eventId,
    session: t.session,
    device: t.device,
    cashierId: t.cashierId,
    priced,
    payments: t.payments,
    note: `Deposit for order ${order.number}`,
    customerId: order.customerId,
    kind: 'deposit',
    orderId: order.id,
  });
  await audit('payment', 'order', order.id, `Deposit ${peso(amount)} for order ${order.number}`);
  return sale;
}

/**
 * Hand the order over: a normal sale with the real items (stock and production
 * cost come off), paid by the deposits already taken plus the balance now.
 */
export async function pickUpOrder(order: Order, t: TakeMoney): Promise<Sale> {
  if (order.status === 'picked-up' || order.status === 'cancelled') throw new Error(`Order ${order.number} is already ${ORDER_STATUS_LABEL[order.status].toLowerCase()}.`);
  const m = orderMoney(order, await orderSales(order.id));
  const items: CartItem[] = order.lines.map((l, i) => ({
    key: String(i),
    productId: l.productId ?? `${ORDER_LINE}${order.id}:${i}`,
    name: l.name,
    categoryId: l.categoryId,
    unitPrice: l.unitPrice,
    qty: l.qty,
    free: false,
    freeReason: '',
    designerId: l.designerId ?? order.designerId,
  }));
  const priced = priceCart(items, [], []);
  const fromDeposit = Math.min(m.paid, priced.total);
  const deposit: SalePayment[] = fromDeposit ? [{ methodId: 'deposit', name: `Order deposit (${order.number})`, kind: 'deposit', amount: fromDeposit, tendered: null, ref: '' }] : [];
  const sale = await completeSale({
    eventId: t.session.eventId,
    session: t.session,
    device: t.device,
    cashierId: t.cashierId,
    priced,
    payments: [...deposit, ...t.payments],
    note: `Order ${order.number} picked up`,
    customerId: order.customerId,
    orderId: order.id,
  });
  await patch(db.orders, order.id, { status: 'picked-up', statusAt: Date.now(), pickupSaleId: sale.id });
  await audit('status', 'order', order.id, `Order ${order.number} picked up (${peso(sale.total)})`);
  return sale;
}

/** Cancel an order: refund the deposits (their sales are voided) or keep them (they become sales). */
export async function cancelOrder(order: Order, deposits: 'refund' | 'keep', by: string | null): Promise<void> {
  const m = orderMoney(order, await orderSales(order.id));
  for (const d of m.deposits) {
    if (deposits === 'refund') await voidSale(d.id, `Order ${order.number} cancelled; deposit refunded`, by);
    else await patch(db.sales, d.id, { kind: undefined, lines: d.lines.map((l) => ({ ...l, name: `Kept deposit · order ${order.number}` })) });
  }
  await patch(db.orders, order.id, { status: 'cancelled', statusAt: Date.now() });
  await audit('status', 'order', order.id, `Order ${order.number} cancelled${m.paid ? `; deposit ${peso(m.paid)} ${deposits === 'refund' ? 'refunded' : 'kept'}` : ''}`);
}
