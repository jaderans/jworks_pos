import type { Customer, Order, PrintOrder } from '../db/types';

/**
 * Recall an order at the counter: by its number (QA-07, PA-002), the custom
 * sticker's design no. (CS01), or the customer's name, phone or email.
 * Exact numbers come first, then the newest.
 */

export type FoundOrder = { kind: 'order'; order: Order } | { kind: 'print'; order: PrintOrder };

const key = (s: string | undefined) => (s ?? '').replace(/[\s_-]+/g, '').toUpperCase();
const digits = (s: string | undefined) => (s ?? '').replace(/\D/g, '');

export function findOrders(q: string, orders: readonly Order[], prints: readonly PrintOrder[], customers: readonly Customer[], limit = 20): FoundOrder[] {
  const text = q.trim().toLowerCase();
  if (text.length < 2) return [];
  const k = key(q);
  const phone = digits(q);
  const people = new Map(customers.map((c) => [c.id, c]));
  const all: FoundOrder[] = [...orders.map((order) => ({ kind: 'order' as const, order })), ...prints.map((order) => ({ kind: 'print' as const, order }))].filter((f) => f.order.deleted !== 1);
  const scored = all
    .map((f) => {
      const o = f.order;
      const c = o.customerId ? people.get(o.customerId) : undefined;
      if (key(o.number) === k || (o.designNo && key(o.designNo) === k)) return { f, score: 3 };
      if (key(o.number).includes(k) || (o.designNo && key(o.designNo).includes(k))) return { f, score: 2 };
      const names = [o.customerName, c?.name, c?.email, c?.handle, o.contact].filter(Boolean).join(' ').toLowerCase();
      const phones = [o.contact, c?.phone].map(digits).filter(Boolean);
      if (names.includes(text) || (phone.length >= 4 && phones.some((p) => p.includes(phone)))) return { f, score: 1 };
      return null;
    })
    .filter((x): x is { f: FoundOrder; score: number } => x !== null);
  return scored.sort((a, b) => b.score - a.score || b.f.order.createdAt - a.f.order.createdAt).slice(0, limit).map((x) => x.f);
}
