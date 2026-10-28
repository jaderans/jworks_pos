import { peso, sum, type Cents } from '../lib/money';
import { fmtIsoDate } from '../lib/time';
import type { CartDiscount } from './cart';
import type { LoyaltySettings, Sale, Voucher } from '../db/types';

/**
 * Stamp cards and voucher codes. Nothing here is a stored counter: stamps and
 * voucher uses are worked out from the sales themselves, so merging two phones'
 * files (or the same file twice) can never double them.
 */

const counts = (s: Sale) => s.status === 'completed' && s.deleted !== 1;

/** Stamps one sale earns: one for every pesoPerStamp actually paid. */
export function stampsForSale(sale: Pick<Sale, 'total'>, rules: LoyaltySettings): number {
  if (!rules.enabled || rules.pesoPerStamp <= 0) return 0;
  return Math.floor(sale.total / rules.pesoPerStamp);
}

export interface LoyaltyState {
  earned: number;
  /** Stamps traded in for rewards. */
  used: number;
  balance: number;
  /** Rewards ready to use now. */
  rewards: number;
  /** Stamps until the next reward. */
  toNext: number;
  visits: number;
  spent: Cents;
  lastAt: number | null;
}

export function loyaltyState(customerId: string, sales: readonly Sale[], rules: LoyaltySettings): LoyaltyState {
  const mine = sales.filter((s) => s.customerId === customerId && counts(s));
  const per = Math.max(1, Math.round(rules.stampsForReward));
  const earned = sum(mine.map((s) => stampsForSale(s, rules)));
  const used = mine.filter((s) => s.discounts.some((d) => d.kind === 'loyalty')).length * per;
  const balance = Math.max(0, earned - used);
  return {
    earned,
    used,
    balance,
    rewards: rules.enabled ? Math.floor(balance / per) : 0,
    toNext: per - (balance % per),
    visits: mine.length,
    spent: sum(mine.map((s) => s.total)),
    lastAt: mine.length ? Math.max(...mine.map((s) => s.at)) : null,
  };
}

/** "₱100 off" or "10% off". */
export const rewardText = (rules: Pick<LoyaltySettings, 'rewardKind' | 'rewardValue'>) =>
  rules.rewardKind === 'percent' ? `${rules.rewardValue}% off` : `${peso(rules.rewardValue)} off`;

export function loyaltyDiscount(rules: LoyaltySettings): CartDiscount {
  return { id: 'loyalty', label: `Loyalty reward (${rewardText(rules)})`, kind: rules.rewardKind, value: rules.rewardValue, source: 'loyalty' };
}

/** Codes are kept uppercase with no spaces, so "komiket 50" and "KOMIKET50" are the same code. */
export const normalizeCode = (code: string) => code.toUpperCase().replace(/\s+/g, '');

export const voucherUses = (code: string, sales: readonly Sale[]) => sales.filter((s) => counts(s) && s.voucherCode === code);

export type VoucherCheck = { ok: true; discount: CartDiscount } | { ok: false; reason: string };

export interface VoucherContext {
  code: string;
  /** ISO date of today. */
  today: string;
  eventId: string;
  /** What the cart costs after bundle deals. */
  base: Cents;
  customerId: string | null;
  /** Sales that used this code (any event, any device merged in). */
  sales: readonly Sale[];
}

/**
 * Can this code be used on this cart? Limits are checked against the sales on
 * this device; two phones selling offline can go slightly over a cap until they merge.
 */
export function checkVoucher(v: Voucher | undefined, ctx: VoucherContext): VoucherCheck {
  const code = normalizeCode(ctx.code);
  if (!v || v.deleted === 1) return { ok: false, reason: `There’s no voucher with the code ${code}.` };
  if (v.active !== 1) return { ok: false, reason: `${v.code} is turned off.` };
  if (v.validFrom && ctx.today < v.validFrom) return { ok: false, reason: `${v.code} starts on ${fmtIsoDate(v.validFrom)}.` };
  if (v.validTo && ctx.today > v.validTo) return { ok: false, reason: `${v.code} ended on ${fmtIsoDate(v.validTo)}.` };
  if (v.eventId && v.eventId !== ctx.eventId) return { ok: false, reason: `${v.code} is for a different event.` };
  if (ctx.base < v.minSpend) return { ok: false, reason: `${v.code} needs a spend of at least ${peso(v.minSpend)}.` };
  const uses = voucherUses(v.code, ctx.sales);
  if (v.maxUses !== null && uses.length >= v.maxUses) return { ok: false, reason: `${v.code} is used up (${v.maxUses} of ${v.maxUses}).` };
  if (v.perCustomer !== null) {
    if (!ctx.customerId) return { ok: false, reason: `${v.code} is limited per customer. Add the customer to this sale first.` };
    if (uses.filter((s) => s.customerId === ctx.customerId).length >= v.perCustomer) {
      return { ok: false, reason: `This customer has already used ${v.code}${v.perCustomer > 1 ? ` ${v.perCustomer} times` : ''}.` };
    }
  }
  const off = v.kind === 'percent' ? `${v.value}% off` : `${peso(v.value)} off`;
  return { ok: true, discount: { id: 'voucher', label: `${v.code} (${v.label || off})`, kind: v.kind, value: v.value, source: 'voucher' } };
}
