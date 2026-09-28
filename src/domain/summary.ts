import { sum, type Cents } from '../lib/money';
import { isoDate, localHour } from '../lib/time';
import { lineRevenue } from './cart';
import type { Category, Sale, Session } from '../db/types';

export interface MethodTotal {
  methodId: string;
  name: string;
  kind: string;
  amount: Cents;
  count: number;
}

export interface ProductTotal {
  productId: string;
  name: string;
  categoryId: string | null;
  qty: number;
  revenue: Cents;
}

export interface EventMetrics {
  transactions: number;
  voided: number;
  gross: Cents;
  listValue: Cents;
  discounts: Cents;
  itemsSold: number;
  freeItems: number;
  avgSale: Cents;
  biggestSale: Cents;
  byMethod: MethodTotal[];
  byHour: { hour: number; amount: Cents; count: number }[];
  byDay: { date: string; amount: Cents; count: number }[];
  byProduct: ProductTotal[];
  byCategory: { categoryId: string | null; name: string; qty: number; revenue: Cents }[];
  byCashier: { cashierId: string | null; amount: Cents; count: number }[];
  addOnAttach: number | null;
}

export function eventMetrics(sales: readonly Sale[], categories: readonly Category[]): EventMetrics {
  const completed = sales.filter((s) => s.status === 'completed' && s.deleted !== 1);
  const voided = sales.filter((s) => s.status === 'voided' && s.deleted !== 1).length;
  const catName = new Map(categories.map((c) => [c.id, c.name]));

  const methods = new Map<string, MethodTotal>();
  const hours = new Map<number, { amount: Cents; count: number }>();
  const days = new Map<string, { amount: Cents; count: number }>();
  const products = new Map<string, ProductTotal>();
  const cats = new Map<string, { categoryId: string | null; name: string; qty: number; revenue: Cents }>();
  const cashiers = new Map<string, { cashierId: string | null; amount: Cents; count: number }>();
  let itemsSold = 0;
  let freeItems = 0;
  let addOns = 0;

  for (const s of completed) {
    for (const p of s.payments) {
      const m = methods.get(p.methodId) ?? { methodId: p.methodId, name: p.name, kind: p.kind, amount: 0, count: 0 };
      m.amount += p.amount;
      m.count += 1;
      methods.set(p.methodId, m);
    }
    const h = localHour(s.at);
    const hv = hours.get(h) ?? { amount: 0, count: 0 };
    hv.amount += s.total;
    hv.count += 1;
    hours.set(h, hv);
    const d = isoDate(s.at);
    const dv = days.get(d) ?? { amount: 0, count: 0 };
    dv.amount += s.total;
    dv.count += 1;
    days.set(d, dv);
    const ck = s.cashierId ?? '';
    const cv = cashiers.get(ck) ?? { cashierId: s.cashierId, amount: 0, count: 0 };
    cv.amount += s.total;
    cv.count += 1;
    cashiers.set(ck, cv);

    const rev = lineRevenue(s);
    s.lines.forEach((l, i) => {
      itemsSold += l.qty;
      if (l.free) freeItems += l.qty;
      const p = products.get(l.productId) ?? { productId: l.productId, name: l.name, categoryId: l.categoryId, qty: 0, revenue: 0 };
      p.qty += l.qty;
      p.revenue += rev[i];
      products.set(l.productId, p);
      const key = l.categoryId ?? '';
      const name = l.categoryId ? catName.get(l.categoryId) ?? 'Other' : 'No category';
      const c = cats.get(key) ?? { categoryId: l.categoryId, name, qty: 0, revenue: 0 };
      c.qty += l.qty;
      c.revenue += rev[i];
      cats.set(key, c);
      if (/add[\s-]?on/i.test(name)) addOns += l.qty;
    });
  }

  const gross = sum(completed.map((s) => s.total));
  const listValue = sum(completed.map((s) => s.subtotal));
  const hasAddOnCategory = categories.some((c) => /add[\s-]?on/i.test(c.name) && c.deleted !== 1);

  return {
    transactions: completed.length,
    voided,
    gross,
    listValue,
    discounts: sum(completed.map((s) => s.discountTotal)),
    itemsSold,
    freeItems,
    avgSale: completed.length ? Math.round(gross / completed.length) : 0,
    biggestSale: completed.length ? Math.max(...completed.map((s) => s.total)) : 0,
    byMethod: [...methods.values()].sort((a, b) => b.amount - a.amount),
    byHour: [...hours.entries()].map(([hour, v]) => ({ hour, ...v })).sort((a, b) => a.hour - b.hour),
    byDay: [...days.entries()].map(([date, v]) => ({ date, ...v })).sort((a, b) => a.date.localeCompare(b.date)),
    byProduct: [...products.values()].sort((a, b) => b.revenue - a.revenue || b.qty - a.qty),
    byCategory: [...cats.values()].sort((a, b) => b.revenue - a.revenue),
    byCashier: [...cashiers.values()].sort((a, b) => b.amount - a.amount),
    addOnAttach: hasAddOnCategory && completed.length ? addOns / completed.length : null,
  };
}

export interface DrawerState {
  opening: Cents;
  cashSales: Cents;
  cashIn: Cents;
  cashOut: Cents;
  expected: Cents;
  counted: Cents | null;
  overShort: Cents | null;
}

/** Cash that should be in the drawer for one register session. */
export function drawerState(session: Session, sales: readonly Sale[]): DrawerState {
  const mine = sales.filter((s) => s.sessionId === session.id && s.status === 'completed' && s.deleted !== 1);
  const cashSales = sum(mine.flatMap((s) => s.payments.filter((p) => p.kind === 'cash').map((p) => p.amount)));
  const cashIn = sum(session.cashMoves.filter((m) => m.kind === 'in').map((m) => m.amount));
  const cashOut = sum(session.cashMoves.filter((m) => m.kind === 'out').map((m) => m.amount));
  const expected = session.openingFloat + cashSales + cashIn - cashOut;
  const counted = session.countedTotal;
  return { opening: session.openingFloat, cashSales, cashIn, cashOut, expected, counted, overShort: counted === null ? null : counted - expected };
}

/** Philippine cash denominations for the drawer count, in centavos. */
export const DENOMINATIONS: { key: string; label: string; value: Cents }[] = [
  { key: '1000', label: '₱1,000', value: 100000 },
  { key: '500', label: '₱500', value: 50000 },
  { key: '200', label: '₱200', value: 20000 },
  { key: '100', label: '₱100', value: 10000 },
  { key: '50', label: '₱50', value: 5000 },
  { key: '20', label: '₱20', value: 2000 },
  { key: '10', label: '₱10', value: 1000 },
  { key: '5', label: '₱5', value: 500 },
  { key: '1', label: '₱1', value: 100 },
  { key: '0.25', label: '25¢', value: 25 },
];

export const countTotal = (counts: Record<string, number>): Cents =>
  sum(DENOMINATIONS.map((d) => Math.max(0, Math.floor(counts[d.key] ?? 0)) * d.value));
