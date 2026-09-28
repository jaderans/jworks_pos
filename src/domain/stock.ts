import type { EventProduct, Material, Sale, StockMove } from '../db/types';

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
    if (s.status !== 'completed' || s.deleted === 1) continue;
    for (const l of s.lines) out.set(l.productId, (out.get(l.productId) ?? 0) + l.qty);
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
