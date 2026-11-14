import { peso, type Cents } from '../lib/money';
import type { BundleLike, PricedCart } from './cart';

/**
 * The customer screen: what the customer sees on the second monitor while the
 * cashier rings them up. The register sends this whole state on every change.
 */

export interface DisplayLine {
  name: string;
  qty: number;
  /** What the line costs before bundle deals; 0 for a free item. */
  total: Cents;
  free: boolean;
}

export interface DisplayCart {
  lines: DisplayLine[];
  /** Bundle deals and discounts, as savings. */
  savings: { label: string; amount: Cents }[];
  subtotal: Cents;
  total: Cents;
  count: number;
  /** "Add 1 more Cat Meme: 5 for ₱110" when the cart is one item short of a deal. */
  nudge: string | null;
}

export interface DisplayState {
  v: 1;
  /** closed: no register open. cart: ringing up (or nothing yet). paying: the payment step. thanks: the sale is done. */
  mode: 'closed' | 'cart' | 'paying' | 'thanks';
  business: string;
  eventName: string;
  cart: DisplayCart;
  customer: { name: string; loyalty: string | null } | null;
  pay: { amount: Cents; method: string; qr: string | null } | null;
  thanks: { receiptNo: string; total: Cents; change: Cents; paidWith: string; receipt: string; coupon: { code: string; text: string } | null; loyalty: string | null } | null;
}

export const emptyDisplayCart = (): DisplayCart => ({ lines: [], savings: [], subtotal: 0, total: 0, count: 0, nudge: null });

/**
 * One item short of a bundle deal: the deal the customer is closest to, worded
 * for them. Only deals that save money count; the register never applies the others.
 */
export function bundleNudge(lines: PricedCart['lines'], rules: readonly BundleLike[]): string | null {
  for (const r of rules) {
    if (r.qty < 2) continue;
    const mine = lines.filter((l) => !l.free && r.productIds.includes(l.productId));
    const count = mine.reduce((a, l) => a + l.qty, 0);
    if (!count || count % r.qty !== r.qty - 1) continue;
    const cheapest = Math.min(...mine.map((l) => l.unitPrice));
    if (r.price >= cheapest * r.qty) continue;
    const what = r.productIds.length === 1 ? mine[0].name : `from ${r.name}`;
    return `Add 1 more ${what}: ${r.qty} for ${peso(r.price)}`;
  }
  return null;
}

export function displayCart(priced: PricedCart, rules: readonly BundleLike[]): DisplayCart {
  return {
    lines: priced.lines.map((l) => ({ name: l.name, qty: l.qty, total: l.free ? 0 : l.gross, free: l.free })),
    savings: [
      ...priced.bundles.map((b) => ({ label: b.times > 1 ? `${b.name} × ${b.times}` : b.name, amount: b.savings })),
      ...priced.discounts.map((d) => ({ label: d.label, amount: d.amount })),
    ].filter((x) => x.amount > 0),
    subtotal: priced.subtotal,
    total: priced.total,
    count: priced.itemCount,
    nudge: bundleNudge(priced.lines, rules),
  };
}
