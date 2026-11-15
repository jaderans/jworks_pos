import { peso, sum, type Cents } from '../lib/money';
import { isoDate } from '../lib/time';
import { isMoneyOnly, isOrderLine } from './orders';
import type { Category, Sale } from '../db/types';

/**
 * The prize wheel: a sale that meets the event's rule (spend so much, or buy
 * so many items) spins once. Each prize has its own chance, and can stop for
 * the day after so many wins; whatever chance is left is "Try again".
 * Sales promos with chance need a DTI permit in the Philippines.
 */

export interface WheelPrize {
  id: string;
  label: string;
  /**
   * item: a product handed over free (out of stock). pick: they choose from a
   * pile set aside for prizes (any design; no stock count). service: a
   * JoshWorks service made for them free. voucher: a code off their next
   * purchase at this event. spin: another spin, on top of the ones they earned.
   */
  kind: 'item' | 'pick' | 'service' | 'voucher' | 'spin';
  /** A pick from the prize pile: how many, and of what ("sticker"). */
  pick?: { count: number; what: string } | null;
  productId: string | null;
  /** A free service: what it is and what it would cost. It becomes a ₱0 service order. */
  service?: { label: string; value: Cents } | null;
  /** A discount off their next purchase, on a purchase of at least minSpend. */
  voucher: { kind: 'amount' | 'percent'; value: number; minSpend?: Cents } | null;
  /** Percent chance, 0 to 100. */
  chance: number;
  /** The most wins a day; null for no limit. */
  perDay: number | null;
}

export interface WheelConfig {
  on: boolean;
  /** A sale of at least this spins. null: no spend rule. */
  minSpend: Cents | null;
  /** Or at least this many items, of one category or any. null: no item rule. */
  minItems: { count: number; categoryId: string | null } | null;
  prizes: WheelPrize[];
  /** How the slices are drawn: as wide as their chance (the real odds), or all the same size (easier to read). The chances are the same either way. */
  look?: 'chance' | 'equal';
  /**
   * How many spins a qualifying sale gets. sale: this many each. mark: one for
   * every full mark (₱250 spins once, ₱500 twice), up to this many. Missing: one.
   */
  spins?: { per: 'sale' | 'mark'; count: number };
}

export const BLANK_WHEEL: WheelConfig = { on: false, minSpend: 25000, minItems: { count: 15, categoryId: null }, prizes: [] };
export const ONE_SPIN: NonNullable<WheelConfig['spins']> = { per: 'sale', count: 1 };
/** The most spins one sale can get, whichever way they're counted. */
export const MAX_SPINS = 10;

/** A wheel saved to use again at another event (Settings, shared by every device). */
export interface SavedWheel {
  id: string;
  name: string;
  wheel: Omit<WheelConfig, 'on'>;
  savedAt: number;
}

/** What a spin landed on, kept on the sale that spun. */
export interface WheelResult {
  prizeId: string | null;
  label: string;
  at: number;
  /** The voucher code won, if the prize was one. */
  code?: string;
  /** Landed on a free spin: they spin once more. */
  again?: boolean;
}

/** Every spin a sale has had, first to last (sales before multiple spins kept just the one). */
export function spinsOf(sale: Pick<Sale, 'wheel' | 'wheelSpins'>): WheelResult[] {
  return sale.wheelSpins?.results ?? (sale.wheel ? [sale.wheel] : []);
}

export const TRY_AGAIN = 'Try again';

/** "1 sticker", "2 stickers": what a pick-from-the-pile prize lets them take. */
export function pickText(p: Pick<WheelPrize, 'pick'>): string {
  const n = Math.max(1, Math.round(p.pick?.count ?? 1));
  const what = (p.pick?.what.trim() || 'sticker').replace(/s$/, '');
  return `${n} ${what}${n === 1 ? '' : 's'}`;
}

/** The chance left for "Try again". */
export const tryAgainChance = (c: Pick<WheelConfig, 'prizes'>): number => Math.max(0, 100 - sum(c.prizes.map((p) => Math.max(0, p.chance))));

/** Why a wheel setup can't be saved, or null. */
export function wheelProblem(c: WheelConfig): string | null {
  if (!c.minSpend && !c.minItems) return 'Set when the wheel spins: a spend, a number of items, or both.';
  if (c.minItems && !(c.minItems.count > 0)) return 'Set how many items it takes.';
  if (c.spins && !(c.spins.count >= 1 && c.spins.count <= MAX_SPINS)) return `Spins: from 1 to ${MAX_SPINS}.`;  const total = sum(c.prizes.map((p) => p.chance));
  if (total > 100) return `The chances add up to ${total}%. Bring them down to 100% or less.`;
  for (const p of c.prizes) {
    if (!p.label.trim()) return 'Every prize needs a name.';
    if (!(p.chance > 0)) return `Give ${p.label} a chance above 0%.`;
    if (p.kind === 'item' && !p.productId) return `Pick the product for ${p.label}.`;
    if (p.kind === 'service' && !p.service?.label.trim()) return `Say which service ${p.label} is.`;
    if (p.kind === 'pick' && !((p.pick?.count ?? 0) >= 1)) return `Say how many ${p.label} lets them pick.`;
    if (p.kind === 'voucher' && !(p.voucher && p.voucher.value > 0)) return `Set how much ${p.label} takes off.`;
    if (p.kind === 'voucher' && p.voucher?.kind === 'percent' && p.voucher.value > 100) return `${p.label} can’t take off more than 100%.`;
  }
  return null;
}

/** "Spend ₱250 or buy 15 Sticker items" */
export function wheelRuleText(c: Pick<WheelConfig, 'minSpend' | 'minItems'>, categories: readonly Pick<Category, 'id' | 'name'>[]): string {
  const parts: string[] = [];
  if (c.minSpend) parts.push(`spend ${peso(c.minSpend)}`);
  if (c.minItems) {
    const cat = c.minItems.categoryId ? categories.find((x) => x.id === c.minItems!.categoryId)?.name : null;
    parts.push(`buy ${c.minItems.count} ${cat ? `${cat} items` : 'items'}`);
  }
  const text = parts.join(' or ');
  return text ? text[0].toUpperCase() + text.slice(1) : '';
}

/** A cart being rung up or a finished sale (whose lines keep `free` as 0/1). */
type CartLike = { total: Cents; lines: readonly { qty: number; categoryId: string | null; free: boolean | number; productId: string }[] };

/** Paid items that count toward the item rule (free items and orders don't). */
function countedItems(c: WheelConfig, lines: CartLike['lines']): number {
  if (!c.minItems) return 0;
  return sum(lines.filter((l) => !l.free && !isOrderLine(l.productId) && (!c.minItems!.categoryId || l.categoryId === c.minItems!.categoryId)).map((l) => l.qty));
}

/** How many spins a cart or sale earns by itself: 0 below the mark. Free spins won come on top. */
export function spinsFor(c: WheelConfig, cart: CartLike): number {
  const bySpend = c.minSpend ? Math.floor(cart.total / c.minSpend) : 0;
  const byItems = c.minItems && c.minItems.count > 0 ? Math.floor(countedItems(c, cart.lines) / c.minItems.count) : 0;
  const marks = Math.max(bySpend, byItems);
  if (marks < 1) return 0;
  const s = c.spins ?? ONE_SPIN;
  const most = Math.min(MAX_SPINS, Math.max(1, Math.round(s.count)));
  return s.per === 'mark' ? Math.min(most, marks) : most;
}

/** A sale the wheel can count at all: a completed booth sale, never a prize itself. */
const spinnable = (sale: Sale, c: WheelConfig | null | undefined): c is WheelConfig =>
  !!c?.on && sale.status === 'completed' && sale.deleted !== 1 && !isMoneyOnly(sale) && !sale.prizeFor;

/**
 * Spins this sale still has: what it earned (kept from its first spin, so a
 * later change to the wheel doesn't change it), plus free spins it won, less
 * the spins it has had.
 */
export function spinsLeft(sale: Sale, c: WheelConfig | null | undefined): number {
  if (!spinnable(sale, c)) return 0;
  const done = spinsOf(sale);
  const earned = sale.wheelSpins?.earned ?? (done.length ? 1 : spinsFor(c, sale));
  return Math.max(0, earned + done.filter((r) => r.again).length - done.length);
}

/** Does this sale (still) spin? Booth sales only, as many times as it earned, and never a prize sale. */
export function wheelQualifies(sale: Sale, c: WheelConfig | null | undefined): boolean {
  return spinsLeft(sale, c) > 0;
}

/** "One spin for every ₱250 or 15 items, up to 3" — empty for the usual one spin a sale. */
export function spinsText(c: Pick<WheelConfig, 'minSpend' | 'minItems' | 'spins'>): string {
  const s = c.spins ?? ONE_SPIN;
  if (s.per === 'sale') return s.count > 1 ? `${s.count} spins a sale` : '';
  const marks = [c.minSpend ? peso(c.minSpend) : '', c.minItems ? `${c.minItems.count} items` : ''].filter(Boolean).join(' or ');
  return `One spin for every ${marks}, up to ${s.count}`;
}

/** Wins per prize today at this event, across every device's sales. */
export function winsToday(sales: readonly Sale[], today = isoDate()): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of sales) {
    if (s.deleted === 1) continue;
    for (const w of spinsOf(s)) {
      if (!w.prizeId || isoDate(w.at) !== today) continue;
      out.set(w.prizeId, (out.get(w.prizeId) ?? 0) + 1);
    }
  }
  return out;
}

/**
 * The prize for a draw r in [0, 1): each prize owns a band as wide as its
 * chance. A prize that has reached its limit for the day is "Try again"
 * instead, so the others keep their odds.
 */
export function pickPrize(c: Pick<WheelConfig, 'prizes'>, wins: ReadonlyMap<string, number>, r: number): WheelPrize | null {
  let edge = 0;
  for (const p of c.prizes) {
    edge += Math.max(0, p.chance);
    if (r * 100 < edge) return p.perDay !== null && (wins.get(p.id) ?? 0) >= p.perDay ? null : p;
  }
  return null;
}

export interface WheelSlice {
  id: string | null;
  label: string;
  /** Degrees clockwise from the top. */
  from: number;
  to: number;
}

/** The wheel as drawn: each slice as wide as its chance, so what you see is what you get. */
export function wheelSlices(c: Pick<WheelConfig, 'prizes' | 'look'>): WheelSlice[] {
  const prizes = c.prizes.filter((p) => p.chance > 0);
  const total = prizes.reduce((a, p) => a + p.chance, 0);
  const tryAgain = total < 99.999;
  // All the same size: easier to read. Where it stops still follows the chances (see landingTurn).
  if (c.look === 'equal') {
    const n = prizes.length + (tryAgain ? 1 : 0);
    const w = 360 / Math.max(1, n);
    const out: WheelSlice[] = prizes.map((p, i) => ({ id: p.id, label: p.label, from: i * w, to: (i + 1) * w }));
    if (tryAgain) out.push({ id: null, label: TRY_AGAIN, from: prizes.length * w, to: 360 });
    return out;
  }
  const out: WheelSlice[] = [];
  let at = 0;
  for (const p of prizes) {
    out.push({ id: p.id, label: p.label, from: at, to: at + p.chance * 3.6 });
    at += p.chance * 3.6;
  }
  if (at < 359.999) out.push({ id: null, label: TRY_AGAIN, from: at, to: 360 });
  return out;
}

/** How far the wheel turns (clockwise) to stop with the pointer, at the top, inside the slice won. */
export function landingTurn(slices: readonly WheelSlice[], prizeId: string | null, r: number, spins = 6): number {
  const s = slices.find((x) => x.id === prizeId) ?? slices[slices.length - 1];
  const at = s.from + (s.to - s.from) * (0.15 + 0.7 * r);
  return spins * 360 + ((360 - at) % 360);
}

/** Within reach of a spin: within this share of the mark (₱100 of ₱250, 6 of 15 pieces). */
const NEAR = 0.4;

/**
 * What the customer screen says about the wheel while they buy: how much more
 * (pesos or pieces) earns a spin when they're close, or that this sale spins.
 * Counted the way wheelQualifies counts: the total, and paid items of the
 * chosen category. Null when the wheel is off or they aren't close yet.
 */
export function spinNudge(c: WheelConfig | null | undefined, cart: CartLike, categoryName?: string | null): { ready: boolean; text: string; more?: string } | null {
  if (!c?.on || !c.prizes.some((p) => p.chance > 0) || !cart.lines.length) return null;
  const s = c.spins ?? ONE_SPIN;
  const have = spinsFor(c, cart);
  const times = (n: number) => (n > 1 ? ` ${n} times` : '');
  const one = (c.minItems?.categoryId && categoryName ? categoryName.toLowerCase() : 'item').replace(/s$/, '');
  /** How far to the next mark (marks = 1 for the first spin), when it's within reach. */
  const toMark = (marks: number): { spend: string } | { items: string } | null => {
    const spendGap = c.minSpend ? c.minSpend * marks - cart.total : null;
    const itemGap = c.minItems ? c.minItems.count * marks - countedItems(c, cart.lines) : null;
    // The closer of the two marks, as a share of one mark.
    const spendLeft = spendGap !== null && c.minSpend ? spendGap / c.minSpend : Infinity;
    const itemLeft = itemGap !== null && c.minItems ? itemGap / c.minItems.count : Infinity;
    if (Math.min(spendLeft, itemLeft) > NEAR) return null;
    if (spendLeft <= itemLeft && spendGap !== null) return { spend: `Add ${peso(spendGap)} more` };
    return { items: `${itemGap} more ${itemGap === 1 ? one : `${one}s`}` };
  };
  if (have > 0) {
    const ready = { ready: true, text: `This sale spins the prize wheel${times(have)}!` };
    // Counting by the mark: close to the next one, say how much more for another spin.
    if (s.per !== 'mark' || have >= Math.min(MAX_SPINS, s.count)) return ready;
    const next = toMark(have + 1);
    return next ? { ...ready, more: `${'spend' in next ? next.spend : next.items} for ${have + 1} spins!` } : ready;
  }
  const first = toMark(1);
  if (!first) return null;
  const opening = s.per === 'mark' ? 1 : Math.min(MAX_SPINS, s.count);
  return { ready: false, text: `${'spend' in first ? first.spend : first.items} to spin the prize wheel${times(opening)}!` };
}
