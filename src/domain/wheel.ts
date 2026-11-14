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
  /** item: a product handed over free. voucher: a code off their next purchase at this event. */
  kind: 'item' | 'voucher';
  productId: string | null;
  voucher: { kind: 'amount' | 'percent'; value: number } | null;
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
}

export const BLANK_WHEEL: WheelConfig = { on: false, minSpend: 25000, minItems: { count: 15, categoryId: null }, prizes: [] };

/** What a spin landed on, kept on the sale that spun. */
export interface WheelResult {
  prizeId: string | null;
  label: string;
  at: number;
  /** The voucher code won, if the prize was one. */
  code?: string;
}

export const TRY_AGAIN = 'Try again';

/** The chance left for "Try again". */
export const tryAgainChance = (c: Pick<WheelConfig, 'prizes'>): number => Math.max(0, 100 - sum(c.prizes.map((p) => Math.max(0, p.chance))));

/** Why a wheel setup can't be saved, or null. */
export function wheelProblem(c: WheelConfig): string | null {
  if (!c.minSpend && !c.minItems) return 'Set when the wheel spins: a spend, a number of items, or both.';
  if (c.minItems && !(c.minItems.count > 0)) return 'Set how many items it takes.';
  const total = sum(c.prizes.map((p) => p.chance));
  if (total > 100) return `The chances add up to ${total}%. Bring them down to 100% or less.`;
  for (const p of c.prizes) {
    if (!p.label.trim()) return 'Every prize needs a name.';
    if (!(p.chance > 0)) return `Give ${p.label} a chance above 0%.`;
    if (p.kind === 'item' && !p.productId) return `Pick the product for ${p.label}.`;
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

/** Does this sale spin? Booth sales only, once each, and never a prize sale. */
export function wheelQualifies(sale: Sale, c: WheelConfig | null | undefined): boolean {
  if (!c?.on || sale.status !== 'completed' || sale.deleted === 1 || isMoneyOnly(sale) || sale.prizeFor || sale.wheel) return false;
  if (c.minSpend && sale.total >= c.minSpend) return true;
  if (c.minItems) {
    const count = sum(sale.lines.filter((l) => !l.free && !isOrderLine(l.productId) && (!c.minItems!.categoryId || l.categoryId === c.minItems!.categoryId)).map((l) => l.qty));
    if (count >= c.minItems.count) return true;
  }
  return false;
}

/** Wins per prize today at this event, across every device's sales. */
export function winsToday(sales: readonly Sale[], today = isoDate()): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of sales) {
    const w = s.wheel;
    if (!w?.prizeId || s.deleted === 1 || isoDate(w.at) !== today) continue;
    out.set(w.prizeId, (out.get(w.prizeId) ?? 0) + 1);
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
export function wheelSlices(c: Pick<WheelConfig, 'prizes'>): WheelSlice[] {
  const out: WheelSlice[] = [];
  let at = 0;
  for (const p of c.prizes) {
    if (!(p.chance > 0)) continue;
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
