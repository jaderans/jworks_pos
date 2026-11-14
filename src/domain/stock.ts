import type { EventProduct, Material, Sale, StockMove } from '../db/types';
import { isMoneyOnly } from './orders';

/** Studio stock on hand per product (sum of all stock moves). */
export function onHandByProduct(moves: readonly StockMove[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of moves) {
    if (m.deleted === 1) continue;
    out.set(m.productId, (out.get(m.productId) ?? 0) + m.qty);
  }
  return out;
}

/** Units sold per product in a set of sales (completed only). */
export function soldByProduct(sales: readonly Sale[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of sales) {
    if (s.status !== 'completed' || s.deleted === 1 || isMoneyOnly(s)) continue;
    for (const l of s.lines) if (!l.productId.startsWith('order:')) out.set(l.productId, (out.get(l.productId) ?? 0) + l.qty);
  }
  return out;
}

export interface EventStockRow {
  productId: string;
  brought: number | null;
  sold: number;
  left: number | null;
  sellThroughPct: number | null;
}

export function eventStock(eventProducts: readonly EventProduct[], sold: ReadonlyMap<string, number>): Map<string, EventStockRow> {
  const out = new Map<string, EventStockRow>();
  for (const ep of eventProducts) {
    if (ep.deleted === 1) continue;
    const s = sold.get(ep.productId) ?? 0;
    const brought = ep.stockBrought;
    out.set(ep.productId, {
      productId: ep.productId,
      brought,
      sold: s,
      left: brought === null ? null : brought - s,
      sellThroughPct: brought && brought > 0 ? (s / brought) * 100 : null,
    });
  }
  return out;
}

/** A material's stock means something once it has been counted or restocked; before that 0 just means "not counted". */
export const materialCounted = (m: Material): boolean => m.counted === 1 || m.onHand > 0;

export const needsReorder = (m: Material): boolean => m.deleted !== 1 && m.reorderAt > 0 && materialCounted(m) && m.onHand <= m.reorderAt;

export interface DayStockRow {
  productId: string;
  name: string;
  /** Counted in for this event; null when not counted. */
  brought: number | null;
  soldToday: number;
  soldSoFar: number;
  left: number | null;
  status: 'out' | 'low' | 'ok' | 'uncounted';
}

/**
 * The booth's inventory at the end of a day: for every product counted in or
 * sold, what was brought, sold that day, sold so far, and what's left.
 * Low means 2 or fewer, or under a tenth of what was brought.
 */
export function dayStock(
  eventProducts: readonly EventProduct[],
  /** The product's name, or null when it was deleted. */
  productName: (id: string) => string | null,
  sales: readonly Sale[],
  dayStartMs: number,
  dayEndMs: number,
): DayStockRow[] {
  const upTo = sales.filter((s) => s.at < dayEndMs);
  // A deleted product sold that day keeps the name it sold under.
  const soldAs = new Map<string, string>();
  for (const s of upTo) for (const l of s.lines) soldAs.set(l.productId, l.name);
  const today = upTo.filter((s) => s.at >= dayStartMs);
  const soldToday = soldByProduct(today);
  const soldSoFar = soldByProduct(upTo);
  const brought = new Map(eventProducts.filter((e) => e.deleted !== 1).map((e) => [e.productId, e.stockBrought]));
  const ids = new Set([...[...brought].filter(([, b]) => b !== null).map(([id]) => id), ...soldSoFar.keys()]);
  return [...ids]
    .map((id) => {
      const b = brought.get(id) ?? null;
      const so = soldSoFar.get(id) ?? 0;
      const left = b === null ? null : b - so;
      const status: DayStockRow['status'] = left === null ? 'uncounted' : left <= 0 ? 'out' : left <= Math.max(2, Math.ceil((b ?? 0) / 10)) ? 'low' : 'ok';
      const name = productName(id);
      const today = soldToday.get(id) ?? 0;
      // Deleted and not sold that day: nothing to restock or count.
      if (name === null && !today) return null;
      return { productId: id, name: name ?? soldAs.get(id) ?? 'A deleted product', brought: b, soldToday: today, soldSoFar: so, left, status };
    })
    .filter((r): r is DayStockRow => r !== null)
    .sort((a, b) => b.soldToday - a.soldToday || a.name.localeCompare(b.name));
}
