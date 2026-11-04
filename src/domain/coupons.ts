import { peso, percentOf, type Cents } from '../lib/money';
import { addDays, dayStart, fmtIsoDate } from '../lib/time';
import { normalizeCode } from './loyalty';
import type { Coupon, CouponBatch, CouponClaim, CouponSource } from '../db/types';

/**
 * Service coupons. Every event gets its own codes, handed out at the booth or
 * earned with a booth sale. They come off JoshWorks services (print orders,
 * commissions, service quotes, Studio jobs) of ₱2,500 or more, never booth
 * sales. A use is a claim record whose id is the service (`print:<id>`), not a
 * counter, so merging two phones' files can't count it twice.
 */

/** Services under this don't take coupons. */
export const COUPON_MIN_SPEND: Cents = 250000;
/** Codes run until this many days after the event's last day, unless the owner picks a date. */
export const COUPON_DAYS_AFTER = 60;
/** Remind customers this many days before their code runs out. */
export const REMIND_DAYS = 14;

// Letters and digits nobody misreads: no 0/O or 1/I.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface CouponData {
  coupons: readonly Coupon[];
  batches: readonly CouponBatch[];
  claims: readonly CouponClaim[];
}

export const claimId = (source: CouponSource, sourceId: string) => `${source}:${sourceId}`;

export const CLAIM_SOURCE_LABEL: Record<CouponSource, string> = {
  print: 'Printing',
  order: 'Order',
  quote: 'Service quote',
  studio: 'Studio job',
  manual: 'Recorded by hand',
};

/** "Komiket Iloilo" in 2026 → KI26; a one-word name → its first four letters (KOMI26). */
export function couponPrefix(name: string, startDate: string): string {
  const words = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w && !/^\d+$/.test(w));
  const letters = words.length > 1 ? words.slice(0, 4).map((w) => w[0]).join('') : (words[0] ?? '').slice(0, 4);
  const yy = /^\d{4}/.test(startDate) ? startDate.slice(2, 4) : '';
  return `${letters || 'JW'}${yy}`.slice(0, 8);
}

export type RandomBytes = (n: number) => Uint8Array;
const cryptoBytes: RandomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

/** PREFIX-XXXXX: five random characters, about 33 million codes per prefix. */
export function randomCode(prefix: string, bytes: RandomBytes = cryptoBytes): string {
  return `${prefix}-${Array.from(bytes(5), (x) => ALPHABET[x % ALPHABET.length]).join('')}`;
}

/** `count` new codes, none of them already taken. */
export function generateCodes(prefix: string, count: number, taken: ReadonlySet<string>, bytes: RandomBytes = cryptoBytes): string[] {
  const out = new Set<string>();
  for (let guard = 0; out.size < count && guard < count * 50 + 50; guard++) {
    const code = randomCode(prefix, bytes);
    if (!taken.has(code)) out.add(code);
  }
  return [...out];
}

/** What a coupon takes off a service of this price. */
export function couponOff(b: Pick<CouponBatch, 'kind' | 'value' | 'maxOff'>, price: Cents): Cents {
  if (price <= 0) return 0;
  const raw = b.kind === 'percent' ? percentOf(price, b.value) : Math.round(b.value);
  const capped = b.kind === 'percent' && b.maxOff > 0 ? Math.min(raw, b.maxOff) : raw;
  return Math.max(0, Math.min(capped, price));
}

/** "₱300 off" or "10% off (up to ₱1,000)". */
export function offText(b: Pick<CouponBatch, 'kind' | 'value' | 'maxOff'>): string {
  if (b.kind === 'amount') return `${peso(b.value)} off`;
  return `${b.value}% off${b.maxOff > 0 ? ` (up to ${peso(b.maxOff)})` : ''}`;
}

/** "₱300 off any JoshWorks service of ₱2,500 or more, until Dec 31, 2026." */
export function termsText(b: Pick<CouponBatch, 'kind' | 'value' | 'maxOff' | 'minSpend' | 'validTo'>, business = 'JoshWorks'): string {
  return `${offText(b)} any ${business} service of ${peso(b.minSpend)} or more${b.validTo ? `, until ${fmtIsoDate(b.validTo)}` : ''}.`;
}

/** How many claims a code allows: one for unique codes; null means no limit. */
export const usesAllowed = (b: Pick<CouponBatch, 'mode' | 'maxUses'>): number | null => (b.mode === 'unique' ? 1 : b.maxUses);

export const claimsOf = (couponId: string, claims: readonly CouponClaim[]) => claims.filter((c) => c.couponId === couponId && c.deleted !== 1);

export type CouponCheck = { ok: true; coupon: Coupon; batch: CouponBatch; discount: Cents } | { ok: false; reason: string };

export interface CouponCheckContext {
  /** ISO date of today. */
  today: string;
  /** The service's price before the coupon. */
  price: Cents;
  /** This service's claim id, so editing it doesn't count its own claim. */
  claimId: string | null;
}

/**
 * Can this code go on this service? A service that already holds the code
 * keeps it even after the code runs out or is turned off; only its price is
 * checked again.
 */
export function checkCoupon(code: string, data: CouponData, ctx: CouponCheckContext): CouponCheck {
  const c = normalizeCode(code);
  if (!c) return { ok: false, reason: 'Type the coupon code.' };
  const live = data.coupons.filter((x) => x.code === c && x.deleted !== 1);
  const coupon = live.find((x) => x.void !== 1) ?? live[0];
  const batch = coupon ? data.batches.find((b) => b.id === coupon.batchId && b.deleted !== 1) : undefined;
  if (!coupon || !batch) return { ok: false, reason: `There’s no coupon with the code ${c}.` };
  const used = claimsOf(coupon.id, data.claims);
  const held = !!ctx.claimId && used.some((x) => x.id === ctx.claimId);
  if (!held) {
    if (coupon.void === 1 || batch.active !== 1) return { ok: false, reason: `${c} is turned off.` };
    if (batch.validFrom && ctx.today < batch.validFrom) return { ok: false, reason: `${c} can be used from ${fmtIsoDate(batch.validFrom)}.` };
    if (batch.validTo && ctx.today > batch.validTo) return { ok: false, reason: `${c} expired on ${fmtIsoDate(batch.validTo)}.` };
    const cap = usesAllowed(batch);
    if (cap !== null && used.length >= cap) {
      const first = used[0];
      return {
        ok: false,
        reason: batch.mode === 'unique' ? `${c} was already used${first ? ` by ${first.customerName || 'a customer'} (${first.service})` : ''}.` : `${c} is used up (${cap} of ${cap}).`,
      };
    }
  }
  if (ctx.price < batch.minSpend) return { ok: false, reason: `${c} is for services of ${peso(batch.minSpend)} or more; this is ${peso(ctx.price)}.` };
  return { ok: true, coupon, batch, discount: couponOff(batch, ctx.price) };
}

export type CouponState = 'open' | 'claimed' | 'expired' | 'off' | 'upcoming';

export const COUPON_STATE_LABEL: Record<CouponState, string> = {
  open: 'Open',
  claimed: 'Claimed',
  expired: 'Expired',
  off: 'Turned off',
  upcoming: 'Not yet',
};

export function couponState(c: Coupon, b: CouponBatch, claims: readonly CouponClaim[], today: string): CouponState {
  const n = claimsOf(c.id, claims).length;
  const cap = usesAllowed(b);
  if (n > 0 && cap !== null && n >= cap) return 'claimed';
  if (c.void === 1 || b.active !== 1) return 'off';
  if (b.validTo && today > b.validTo) return 'expired';
  if (b.validFrom && today < b.validFrom) return 'upcoming';
  return 'open';
}

export interface CouponStats {
  codes: number;
  /** Given to a known customer or earned with a sale. */
  given: number;
  claims: number;
  /** Codes used at least once. */
  claimedCodes: number;
  open: number;
  expired: number;
  off: number;
  /** Used codes out of the codes that weren't turned off; null with none. */
  claimRate: number | null;
  /** What the services cost before the coupons, what the coupons took off, and what's left. */
  price: Cents;
  discount: Cents;
  net: Cents;
  /** Single-use codes used more than once (two phones offline at the same time). */
  doubles: string[];
}

/** Totals for one event's coupons (pass only that event's rows) or for all of them. */
export function couponStats(data: CouponData, today: string): CouponStats {
  const batches = new Map(data.batches.filter((b) => b.deleted !== 1).map((b) => [b.id, b]));
  const coupons = data.coupons.filter((c) => c.deleted !== 1 && batches.has(c.batchId));
  const claims = data.claims.filter((c) => c.deleted !== 1);
  const s: CouponStats = { codes: coupons.length, given: 0, claims: claims.length, claimedCodes: 0, open: 0, expired: 0, off: 0, claimRate: null, price: 0, discount: 0, net: 0, doubles: [] };
  for (const c of coupons) {
    const b = batches.get(c.batchId)!;
    const mine = claimsOf(c.id, claims);
    if (c.customerId || c.saleId) s.given++;
    if (mine.length) s.claimedCodes++;
    if (b.mode === 'unique' && mine.length > 1) s.doubles.push(c.code);
    const st = couponState(c, b, claims, today);
    if (st === 'open' || st === 'upcoming') s.open++;
    else if (st === 'expired') s.expired++;
    else if (st === 'off') s.off++;
  }
  for (const c of claims) {
    s.price += c.price;
    s.discount += c.discount;
  }
  s.net = s.price - s.discount;
  const usable = s.codes - s.off;
  s.claimRate = usable > 0 ? Math.round((s.claimedCodes / usable) * 100) : null;
  return s;
}

export interface Expiring {
  coupon: Coupon;
  batch: CouponBatch;
  daysLeft: number;
}

/** Codes given to a customer and not used yet that run out within `days`, soonest first. */
export function expiringSoon(data: CouponData, today: string, days = REMIND_DAYS): Expiring[] {
  const batches = new Map(data.batches.filter((b) => b.deleted !== 1).map((b) => [b.id, b]));
  const last = addDays(today, days);
  const out: Expiring[] = [];
  for (const c of data.coupons) {
    const b = batches.get(c.batchId);
    if (!b || c.deleted === 1 || !c.customerId || !b.validTo || b.validTo > last) continue;
    if (couponState(c, b, data.claims, today) !== 'open') continue;
    out.push({ coupon: c, batch: b, daysLeft: Math.round((dayStart(b.validTo) - dayStart(today)) / 86400000) });
  }
  return out.sort((a, b) => a.batch.validTo.localeCompare(b.batch.validTo) || a.coupon.code.localeCompare(b.coupon.code));
}

/** The earn-at-the-booth set a sale qualifies for: the highest minimum it reaches. */
export function earnBatchFor(batches: readonly CouponBatch[], eventId: string, saleTotal: Cents, today: string): CouponBatch | null {
  const fits = batches.filter(
    (b) => b.deleted !== 1 && b.active === 1 && b.eventId === eventId && b.mode === 'unique' && b.earnMin > 0 && saleTotal >= b.earnMin && (!b.validTo || today <= b.validTo),
  );
  return fits.sort((a, b) => b.earnMin - a.earnMin)[0] ?? null;
}

/** A reminder to paste in Messenger or SMS. */
export function reminderText(business: string, o: { name: string; code: string; batch: Pick<CouponBatch, 'kind' | 'value' | 'maxOff' | 'minSpend' | 'validTo'> }): string {
  const first = o.name.split(/\s+/)[0];
  const b = business || 'JoshWorks';
  return `Hi ${first || 'there'}! Your ${b} coupon ${o.code} (${offText(o.batch)} any ${b} service of ${peso(o.batch.minSpend)} or more) is good until ${fmtIsoDate(o.batch.validTo)}. Message us to book stickers, a logo or a commission. See you!`;
}
