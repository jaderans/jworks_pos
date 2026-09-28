import { allocate, percentOf, sum, type Cents } from '../lib/money';
import type { AppliedDiscount, SaleLine, SalePayment } from '../db/types';

export interface CartItem {
  key: string;
  productId: string;
  name: string;
  categoryId: string | null;
  unitPrice: Cents;
  qty: number;
  free: boolean;
  freeReason: string;
  designerId: string | null;
}

export interface CartDiscount {
  id: string;
  label: string;
  /** amount: value is centavos; percent: value is a percentage (10 = 10%). */
  kind: 'amount' | 'percent';
  value: number;
  /** A discount typed at the register (as opposed to an event preset). */
  manual?: boolean;
}

export interface BundleLike {
  id: string;
  name: string;
  productIds: string[];
  qty: number;
  price: Cents;
}

export interface BundleApplication {
  ruleId: string;
  name: string;
  times: number;
  savings: Cents;
}

export interface PricedLine extends CartItem {
  gross: Cents;
  bundleOff: Cents;
}

export interface PricedCart {
  lines: PricedLine[];
  itemCount: number;
  subtotal: Cents;
  bundles: BundleApplication[];
  bundleTotal: Cents;
  /** Preset and manual discounts (after bundles). */
  discounts: AppliedDiscount[];
  discountTotal: Cents;
  total: Cents;
}

interface Unit {
  line: number;
  price: Cents;
  productId: string;
  used: boolean;
}

/**
 * Price a cart: line totals, then bundle deals ("4 for ₱75" applies itself,
 * picking the combination that saves the customer the most), then preset and
 * manual discounts on what is left. Everything is whole centavos.
 */
export function priceCart(items: readonly CartItem[], rules: readonly BundleLike[], discounts: readonly CartDiscount[]): PricedCart {
  const lines: PricedLine[] = items.map((it) => ({
    ...it,
    gross: it.free ? 0 : it.unitPrice * it.qty,
    bundleOff: 0,
  }));

  const units: Unit[] = [];
  lines.forEach((l, i) => {
    if (l.free || l.unitPrice <= 0) return;
    for (let k = 0; k < l.qty; k++) units.push({ line: i, price: l.unitPrice, productId: l.productId, used: false });
  });

  const usable = rules.filter((r) => r.qty >= 1 && r.price >= 0 && r.productIds.length > 0);
  const applied = new Map<string, BundleApplication>();

  for (let guard = 0; guard < 500; guard++) {
    let best: { rule: BundleLike; group: Unit[]; savings: Cents } | null = null;
    for (const rule of usable) {
      const ids = new Set(rule.productIds);
      const avail = units.filter((u) => !u.used && ids.has(u.productId)).sort((a, b) => b.price - a.price);
      if (avail.length < rule.qty) continue;
      const group = avail.slice(0, rule.qty);
      const savings = sum(group.map((u) => u.price)) - rule.price;
      if (savings > 0 && (!best || savings > best.savings)) best = { rule, group, savings };
    }
    if (!best) break;
    best.group.forEach((u) => (u.used = true));
    const shares = allocate(best.savings, best.group.map((u) => u.price));
    best.group.forEach((u, idx) => (lines[u.line].bundleOff += shares[idx]));
    const prev = applied.get(best.rule.id);
    applied.set(best.rule.id, {
      ruleId: best.rule.id,
      name: best.rule.name,
      times: (prev?.times ?? 0) + 1,
      savings: (prev?.savings ?? 0) + best.savings,
    });
  }

  const subtotal = sum(lines.map((l) => l.gross));
  const bundles = [...applied.values()];
  const bundleTotal = sum(bundles.map((b) => b.savings));
  const base = subtotal - bundleTotal;

  let remaining = base;
  const applied2: AppliedDiscount[] = [];
  for (const d of discounts) {
    if (remaining <= 0) break;
    const raw = d.kind === 'percent' ? percentOf(base, d.value) : Math.round(d.value);
    const amount = Math.max(0, Math.min(raw, remaining));
    if (amount <= 0) continue;
    remaining -= amount;
    applied2.push({ id: d.id, label: d.label, kind: d.manual ? 'manual' : d.kind, amount });
  }
  const discountTotal = bundleTotal + sum(applied2.map((d) => d.amount));

  return {
    lines,
    itemCount: sum(lines.map((l) => l.qty)),
    subtotal,
    bundles,
    bundleTotal,
    discounts: applied2,
    discountTotal,
    total: Math.max(0, subtotal - discountTotal),
  };
}

/** Sale lines as stored on a sale. */
export function toSaleLines(priced: PricedCart): SaleLine[] {
  return priced.lines.map((l) => ({
    productId: l.productId,
    name: l.name,
    categoryId: l.categoryId,
    qty: l.qty,
    unitPrice: l.unitPrice,
    gross: l.gross,
    bundleOff: l.bundleOff,
    free: l.free ? 1 : 0,
    freeReason: l.freeReason,
    designerId: l.designerId,
  }));
}

/** All discounts on a sale, bundles first, for receipts and reports. */
export function toAppliedDiscounts(priced: PricedCart): AppliedDiscount[] {
  return [
    ...priced.bundles.map((b) => ({ id: b.ruleId, label: b.times > 1 ? `${b.name} ×${b.times}` : b.name, kind: 'bundle' as const, amount: b.savings })),
    ...priced.discounts,
  ];
}

export interface PaymentCheck {
  ok: boolean;
  paid: Cents;
  due: Cents;
  change: Cents;
  message: string;
}

/** Payments must cover the total exactly; cash may be over-tendered (that becomes change). */
export function checkPayments(total: Cents, payments: readonly SalePayment[]): PaymentCheck {
  const paid = sum(payments.map((p) => p.amount));
  const change = sum(payments.map((p) => (p.kind === 'cash' && p.tendered !== null ? Math.max(0, p.tendered - p.amount) : 0)));
  const shortCash = payments.find((p) => p.kind === 'cash' && p.tendered !== null && p.tendered < p.amount);
  if (shortCash) return { ok: false, paid, due: total - paid, change: 0, message: 'Cash received is less than the cash amount.' };
  if (paid < total) return { ok: false, paid, due: total - paid, change, message: 'Payments don’t cover the total yet.' };
  if (paid > total) return { ok: false, paid, due: total - paid, change, message: 'Payments add up to more than the total.' };
  return { ok: true, paid, due: 0, change, message: '' };
}

/**
 * Revenue per line after bundle savings and a share of sale-level discounts,
 * so product and designer totals add up to the sale total exactly.
 */
export function lineRevenue(sale: { lines: readonly SaleLine[]; total: Cents }): Cents[] {
  const afterBundles = sale.lines.map((l) => Math.max(0, l.gross - l.bundleOff));
  const before = sum(afterBundles);
  if (before <= 0) return sale.lines.map(() => 0);
  return allocate(Math.min(sale.total, before), afterBundles);
}
