import type { Cents } from '../lib/money';
import type { CostPoint, Material, Recipe, RecipeItem } from '../db/types';

/** Cost of one material unit (a sheet, a pin set) in centavos; may be fractional. */
export function materialUnitCost(m: Pick<Material, 'packCost' | 'packQty'> | undefined): number | null {
  if (!m || m.packCost === null || m.packCost === undefined || !(m.packQty > 0)) return null;
  return m.packCost / m.packQty;
}

export interface CostBreakdown {
  materials: number;
  labor: number;
  packaging: number;
  spoilage: number;
  overhead: number;
  total: number;
  /** Materials in the recipe that have no cost yet. */
  missing: string[];
}

/**
 * Cost per piece from a recipe:
 * (materials + labor) × (1 + spoilage) + packaging, then × (1 + overhead).
 */
export function recipeCost(recipe: Recipe, materials: ReadonlyMap<string, Material>): CostBreakdown {
  const missing: string[] = [];
  let mat = 0;
  for (const item of recipe.items) {
    const m = materials.get(item.materialId);
    const unit = materialUnitCost(m);
    if (unit === null) {
      missing.push(m?.name ?? 'Unknown material');
      continue;
    }
    mat += unit * item.qty;
  }
  const labor = (Math.max(0, recipe.laborMinutes) / 60) * Math.max(0, recipe.laborRate);
  const spoilage = (mat + labor) * (Math.max(0, recipe.spoilagePct) / 100);
  const beforeOverhead = mat + labor + spoilage + Math.max(0, recipe.packaging);
  const overhead = beforeOverhead * (Math.max(0, recipe.overheadPct) / 100);
  return { materials: mat, labor, packaging: Math.max(0, recipe.packaging), spoilage, overhead, total: beforeOverhead + overhead, missing };
}

export interface BatchInput {
  qtyMade: number;
  qtySpoiled: number;
  materials: RecipeItem[];
  laborMinutes: number;
  laborRate: Cents;
  oneTime: Cents;
  other: Cents;
  overheadPct: number;
}

export interface BatchCost {
  good: number;
  materials: number;
  labor: number;
  direct: number;
  overhead: number;
  total: Cents;
  unit: Cents | null;
  missing: string[];
}

/** Cost of a production batch; unit cost is spread over the good pieces only. */
export function batchCost(input: BatchInput, materials: ReadonlyMap<string, Material>): BatchCost {
  const missing: string[] = [];
  let mat = 0;
  for (const item of input.materials) {
    const m = materials.get(item.materialId);
    const unit = materialUnitCost(m);
    if (unit === null) {
      if (item.qty > 0) missing.push(m?.name ?? 'Unknown material');
      continue;
    }
    mat += unit * item.qty;
  }
  const labor = (Math.max(0, input.laborMinutes) / 60) * Math.max(0, input.laborRate);
  const direct = mat + labor + Math.max(0, input.oneTime) + Math.max(0, input.other);
  const overhead = direct * (Math.max(0, input.overheadPct) / 100);
  const total = Math.round(direct + overhead);
  const good = Math.max(0, input.qtyMade - input.qtySpoiled);
  return { good, materials: mat, labor, direct, overhead, total, unit: good > 0 ? Math.round(total / good) : null, missing };
}

/** Weighted average when new stock arrives at a different cost. */
export function weightedAverage(oldQty: number, oldCost: Cents | null, addQty: number, addCost: Cents): Cents {
  const q0 = Math.max(0, oldQty);
  if (oldCost === null || q0 === 0) return addCost;
  if (addQty <= 0) return oldCost;
  return Math.round((q0 * oldCost + addQty * addCost) / (q0 + addQty));
}

export interface CostLookup {
  cost: Cents | null;
  /** True when no cost existed yet at that moment and a later one was used. */
  backfilled: boolean;
}

/** The unit cost in force at a moment (points must be for one product). */
export function costAt(points: readonly CostPoint[], at: number): CostLookup {
  const live = points.filter((p) => p.deleted !== 1).sort((a, b) => a.effectiveFrom - b.effectiveFrom);
  if (live.length === 0) return { cost: null, backfilled: false };
  let found: CostPoint | null = null;
  for (const p of live) {
    if (p.effectiveFrom <= at) found = p;
    else break;
  }
  if (found) return { cost: found.unitCost, backfilled: false };
  return { cost: live[0].unitCost, backfilled: true };
}

/** Build a fast lookup over all cost points. */
export function makeCostIndex(points: readonly CostPoint[]): (productId: string, at: number) => CostLookup {
  const byProduct = new Map<string, CostPoint[]>();
  for (const p of points) {
    if (p.deleted === 1) continue;
    const arr = byProduct.get(p.productId) ?? [];
    arr.push(p);
    byProduct.set(p.productId, arr);
  }
  for (const arr of byProduct.values()) arr.sort((a, b) => a.effectiveFrom - b.effectiveFrom);
  return (productId, at) => costAt(byProduct.get(productId) ?? [], at);
}

export const marginPct = (price: number, cost: number): number | null => (price > 0 ? ((price - cost) / price) * 100 : null);
export const markupPct = (price: number, cost: number): number | null => (cost > 0 ? ((price - cost) / cost) * 100 : null);
