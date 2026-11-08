import { roundUpTo, sum, type Cents } from '../lib/money';
import type { Order, OrderStatus, Sale } from '../db/types';

/**
 * Pre-orders and commissions. A deposit is its own small sale (kind 'deposit'):
 * the money is in the drawer or GCash, but it isn't a sale until pickup. At
 * pickup a normal sale carries the real items (so stock and production cost are
 * right), paid partly by an "Order deposit" tender that isn't new money.
 */

/** Lines that aren't catalog products (a deposit, a custom commission piece): no stock, no production cost. */
export const ORDER_LINE = 'order:';
export const isOrderLine = (productId: string) => productId.startsWith(ORDER_LINE);
export const isDeposit = (s: Pick<Sale, 'kind'>) => s.kind === 'deposit';
/** Money in that isn't a booth sale: an order deposit (a sale at pickup) or a JoshWorks service paid at the register. */
export const isMoneyOnly = (s: Pick<Sale, 'kind'>) => s.kind === 'deposit' || s.kind === 'service';
/** Completed booth sales: the merch figures, stock and the team's booth share. */
export const isRevenueSale = (s: Sale) => s.status === 'completed' && s.deleted !== 1 && !isMoneyOnly(s);

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  new: 'New',
  'in-progress': 'Being made',
  ready: 'Ready for pickup',
  'picked-up': 'Picked up',
  cancelled: 'Cancelled',
};
export const OPEN_STATUSES: readonly OrderStatus[] = ['new', 'in-progress', 'ready'];
export const isOpenOrder = (o: Pick<Order, 'status'>) => OPEN_STATUSES.includes(o.status);

const lineAmount = (l: Pick<Order['lines'][number], 'unitPrice' | 'qty'>) => Math.round(l.unitPrice * l.qty);

/** The commission pieces (custom lines): what a service coupon counts. Catalog products are booth merch. */
export const orderServicePrice = (o: Pick<Order, 'lines'>): Cents => sum(o.lines.filter((l) => !l.productId).map(lineAmount));

/** A service coupon's discount, never more than the commission pieces. */
export const orderDiscount = (o: Pick<Order, 'lines' | 'coupon'>): Cents => Math.min(orderServicePrice(o), Math.max(0, o.coupon?.discount ?? 0));

/** What the customer pays in all, after the coupon. */
export const orderTotal = (o: Pick<Order, 'lines' | 'coupon'>): Cents => sum(o.lines.map(lineAmount)) - orderDiscount(o);

export interface OrderMoney {
  total: Cents;
  paid: Cents;
  balance: Cents;
  deposits: Sale[];
}

/** What an order costs, what's been paid toward it (its deposit sales), and what's left. */
export function orderMoney(order: Pick<Order, 'id' | 'lines' | 'coupon'>, sales: readonly Sale[]): OrderMoney {
  const deposits = sales.filter((s) => s.orderId === order.id && s.kind === 'deposit' && s.status === 'completed' && s.deleted !== 1);
  const paid = sum(deposits.map((s) => s.total));
  const total = orderTotal(order);
  return { total, paid, balance: Math.max(0, total - paid), deposits };
}

/** Why an order can't be deleted yet: its deposits and pickup are sales, and sales stay in the records. Null when it can. */
export function orderDeleteBlock(order: Pick<Order, 'id' | 'number' | 'status'>, sales: readonly Sale[]): string | null {
  const live = sales.filter((s) => s.orderId === order.id && s.status === 'completed' && s.deleted !== 1);
  if (!live.length) return null;
  return isOpenOrder(order) ? `${order.number} has a deposit. Cancel the order and refund it first.` : `${order.number} has a sale. Void ${live.map((s) => s.receiptNo).join(' and ')} in the Sales log first.`;
}

/** Deposits taken for orders that haven't been picked up or cancelled yet: money held for customers. */
export function depositsHeld(orders: readonly Order[], sales: readonly Sale[]): Cents {
  return sum(orders.filter((o) => o.deleted !== 1 && isOpenOrder(o)).map((o) => orderMoney(o, sales).paid));
}

/** Half, rounded up to ₱5. */
export const suggestedDeposit = (total: Cents): Cents => (total > 0 ? Math.min(total, roundUpTo(Math.round(total / 2), 5)) : 0);

/** "Due Thu, Oct 29, 3:00 PM" from the stored local date-time. */
export function dueText(dueAt: string): string {
  if (!dueAt) return '';
  const d = new Date(dueAt);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-PH', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(d);
}
