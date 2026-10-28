import type { Cents } from '../lib/money';
import type { Material, Product, Recipe } from '../db/types';

/**
 * What to make before the next event: each product's sales per open hour at
 * recent events (newest counting most), times the hours planned, plus a safety
 * margin, less what's already in the studio. Recipes turn that into materials
 * and packs to buy.
 */

export interface PastEvent {
  eventId: string;
  name: string;
  /** Hours the booth was open (any register). */
  hours: number;
  /** Units sold per product (sales only, not deposits). */
  sold: ReadonlyMap<string, number>;
  /** Products on the table: sold there or counted in. Others don't count against them. */
  offered: ReadonlySet<string>;
}

export interface RestockRow {
  productId: string;
  name: string;
  perHour: number;
  expected: number;
  target: number;
  inStudio: number;
  make: number;
  /** Past events the estimate is based on. */
  basedOn: number;
}

export function restockPlan(o: {
  products: readonly Pick<Product, 'id' | 'name' | 'active' | 'trackStock' | 'deleted'>[];
  /** Newest first. */
  past: readonly PastEvent[];
  plannedHours: number;
  safetyPct: number;
  onHand: ReadonlyMap<string, number>;
}): RestockRow[] {
  const n = o.past.length;
  const rows: RestockRow[] = [];
  for (const p of o.products) {
    if (p.deleted === 1 || p.active !== 1) continue;
    let weighted = 0;
    let weights = 0;
    let basedOn = 0;
    o.past.forEach((ev, i) => {
      if (!ev.offered.has(p.id) || ev.hours <= 0) return;
      const w = n - i;
      weighted += ((ev.sold.get(p.id) ?? 0) / ev.hours) * w;
      weights += w;
      basedOn++;
    });
    if (!basedOn) continue;
    const perHour = Math.round((weighted / weights) * 100) / 100;
    const expected = Math.round(perHour * o.plannedHours * 10) / 10;
    const target = Math.ceil(expected * (1 + Math.max(0, o.safetyPct) / 100) - 1e-9);
    if (target <= 0) continue;
    const inStudio = p.trackStock === 1 ? Math.max(0, o.onHand.get(p.id) ?? 0) : 0;
    rows.push({ productId: p.id, name: p.name, perHour, expected, target, inStudio, make: Math.max(0, target - inStudio), basedOn });
  }
  return rows.sort((a, b) => b.make - a.make || b.target - a.target || a.name.localeCompare(b.name));
}

export interface MaterialNeed {
  materialId: string;
  name: string;
  unit: string;
  need: number;
  onHand: number;
  short: number;
  packQty: number;
  packs: number;
  /** null when the material has no pack cost yet. */
  cost: Cents | null;
}

/** Materials the planned pieces need, from their recipes, and the packs to buy for what isn't on hand. */
export function materialsFor(makes: readonly { productId: string; qty: number }[], recipes: ReadonlyMap<string, Recipe>, materials: ReadonlyMap<string, Material>): MaterialNeed[] {
  const need = new Map<string, number>();
  for (const m of makes) {
    const r = recipes.get(m.productId);
    if (!r || m.qty <= 0) continue;
    for (const item of r.items) need.set(item.materialId, (need.get(item.materialId) ?? 0) + item.qty * m.qty);
  }
  return [...need.entries()]
    .map(([materialId, qty]) => {
      const mat = materials.get(materialId);
      const total = Math.round(qty * 100) / 100;
      const onHand = Math.max(0, mat?.onHand ?? 0);
      const short = Math.max(0, Math.round((total - onHand) * 100) / 100);
      const packQty = Math.max(1, mat?.packQty ?? 1);
      const packs = Math.ceil(short / packQty - 1e-9);
      return {
        materialId,
        name: mat?.name ?? 'Deleted material',
        unit: mat?.unit ?? '',
        need: total,
        onHand,
        short,
        packQty,
        packs,
        cost: mat?.packCost !== null && mat?.packCost !== undefined ? packs * mat.packCost : null,
      };
    })
    .sort((a, b) => b.packs - a.packs || a.name.localeCompare(b.name));
}
