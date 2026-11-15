import { peso, type Cents } from '../lib/money';
import type { BundleLike, PricedCart } from './cart';
import type { WheelSlice } from './wheel';
import type { StickOrder } from './stick';

/** A Couple-of-Stickers order on the customer screen, for the customer to check: a number once it's saved. */
export type DisplayStick = Pick<StickOrder, 'nickname' | 'packs' | 'addOns' | 'readyFrom' | 'readyTo' | 'photo' | 'paid' | 'paidWith'> & { number: string | null };

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

/**
 * The prize wheel on the customer screen. waiting: it turns slowly until the
 * customer taps it (or the cashier spins for them). Then turn says where it
 * lands. sound: which window plays the spin's sounds, the screen (when it has
 * been clicked, so the browser lets it) or the register.
 */
export interface DisplayWheel {
  id: string;
  slices: WheelSlice[];
  waiting: boolean;
  turn: number;
  won: boolean;
  label: string;
  detail: string;
  sound: 'screen' | 'register' | 'none';
  /** Spins they still have after this one. */
  more?: number;
  /** With more than one spin: the prizes won on this sale so far. */
  tally?: string[];
}

export interface DisplayState {
  v: 1;
  /** closed: no register open. cart: ringing up (or nothing yet). paying: the payment step. thanks: the sale is done. wheel: the prize wheel spins. */
  mode: 'closed' | 'cart' | 'paying' | 'thanks' | 'wheel' | 'order';
  /** The event being sold at: the screen's price slides come from it. */
  eventId: string;
  business: string;
  eventName: string;
  cart: DisplayCart;
  customer: { name: string; loyalty: string | null } | null;
  pay: { amount: Cents; method: string; qr: string | null } | null;
  thanks: { receiptNo: string; total: Cents; change: Cents; paidWith: string; receipt: string; coupon: { code: string; text: string } | null; loyalty: string | null } | null;
  /** A spin: the slices, how far the wheel turns, and what it lands on. */
  wheel?: DisplayWheel | null;
  /** Couple-of-Stickers being filled in after they pay, for them to check. */
  stick?: DisplayStick | null;
  /** Close to a spin on the prize wheel: how much more, or that this sale spins. */
  spin?: { ready: boolean; text: string; more?: string; slices: WheelSlice[] } | null;
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
