import { db, alive } from '../db/db';
import { audit, build, create, patch, remove, save } from '../db/write';
import { peso, type Cents } from '../lib/money';
import { batchCost, recipeCost, weightedAverage, type BatchInput } from '../domain/cost';
import { onHandByProduct } from '../domain/stock';
import type { Batch, CostPoint, Material, ProductCost, Recipe, StockMove } from '../db/types';

async function addCostPoint(productId: string, unitCost: Cents, source: CostPoint['source'], note: string) {
  const points = alive(await db.costPoints.where('productId').equals(productId).toArray()).sort((a, b) => b.effectiveFrom - a.effectiveFrom);
  if (points[0] && points[0].unitCost === unitCost) return;
  await create<CostPoint>(db.costPoints, { productId, unitCost, effectiveFrom: Date.now(), source, note });
}

async function upsertCost(productId: string, changes: Partial<ProductCost>): Promise<ProductCost> {
  const existing = await db.productCosts.get(productId);
  if (existing) {
    const next = { ...existing, ...changes, deleted: 0 as const };
    await save(db.productCosts, next);
    return next;
  }
  return create<ProductCost>(db.productCosts, { id: productId, mode: 'manual', manual: null, recipe: null, current: null, ...changes });
}

export async function setManualCost(productId: string, cost: Cents | null): Promise<void> {
  await upsertCost(productId, { mode: 'manual', manual: cost, current: cost });
  if (cost !== null) await addCostPoint(productId, cost, 'manual', 'Entered by hand');
  const p = await db.products.get(productId);
  await audit('cost', 'product', productId, `Production cost of ${p?.name ?? 'product'} set to ${peso(cost)}`);
}

export async function setRecipe(productId: string, recipe: Recipe, materials: ReadonlyMap<string, Material>): Promise<{ cost: Cents | null; missing: string[] }> {
  const b = recipeCost(recipe, materials);
  const cost = b.missing.length ? null : Math.round(b.total);
  await upsertCost(productId, { mode: 'recipe', recipe, current: cost });
  if (cost !== null) await addCostPoint(productId, cost, 'recipe', 'From recipe');
  const p = await db.products.get(productId);
  await audit('cost', 'product', productId, `Recipe for ${p?.name ?? 'product'} saved${cost !== null ? `: ${peso(cost)} per piece` : ' (some materials have no cost yet)'}`);
  return { cost, missing: b.missing };
}

export async function setCostMode(productId: string, mode: ProductCost['mode']): Promise<void> {
  const existing = await db.productCosts.get(productId);
  let current: Cents | null = existing?.current ?? null;
  if (mode === 'manual') current = existing?.manual ?? null;
  await upsertCost(productId, { mode, current });
}

/** After a material price changes, re-cost every product whose recipe uses it. */
export async function refreshRecipeCosts(): Promise<number> {
  const materials = new Map(alive(await db.materials.toArray()).map((m) => [m.id, m]));
  const costs = alive(await db.productCosts.toArray()).filter((c) => c.mode === 'recipe' && c.recipe);
  let changed = 0;
  for (const c of costs) {
    const b = recipeCost(c.recipe!, materials);
    const cost = b.missing.length ? null : Math.round(b.total);
    if (cost !== c.current) {
      await save(db.productCosts, { ...c, current: cost });
      if (cost !== null) await addCostPoint(c.id, cost, 'recipe', 'Material price changed');
      changed++;
    }
  }
  return changed;
}

export async function saveMaterial(m: Partial<Material> & { name: string }): Promise<Material> {
  if (m.id) {
    const existing = await db.materials.get(m.id);
    if (existing) {
      const next = { ...existing, ...m } as Material;
      if (next.onHand !== existing.onHand) next.counted = 1;
      await save(db.materials, next);
      if (existing.packCost !== next.packCost || existing.packQty !== next.packQty) {
        await audit('cost', 'material', next.id, `${next.name}: ${peso(existing.packCost)} per ${existing.packQty} → ${peso(next.packCost)} per ${next.packQty}`);
        await refreshRecipeCosts();
      }
      return next;
    }
  }
  const created = await create<Material>(db.materials, {
    code: m.code ?? '',
    name: m.name.trim(),
    category: m.category ?? '',
    unit: m.unit ?? 'pc',
    packQty: m.packQty ?? 1,
    packCost: m.packCost ?? null,
    onHand: Math.max(0, m.onHand ?? 0),
    reorderAt: m.reorderAt ?? 0,
    counted: m.counted ?? (m.onHand ? 1 : 0),
    supplier: m.supplier ?? '',
    notes: m.notes ?? '',
  });
  await audit('create', 'material', created.id, `Added material ${created.name}`);
  return created;
}

export async function deleteMaterial(id: string) {
  const m = await db.materials.get(id);
  await remove(db.materials, id);
  if (m) await audit('delete', 'material', id, `Deleted material ${m.name}`);
}

export async function adjustMaterial(id: string, delta: number, note: string) {
  const m = await db.materials.get(id);
  if (!m) return;
  const onHand = Math.max(0, Math.round((m.onHand + delta) * 1000) / 1000);
  if (onHand === m.onHand && m.counted === 1) return;
  await patch(db.materials, id, { onHand, counted: 1 });
  await audit('stock', 'material', id, `${m.name}: ${delta >= 0 ? '+' : ''}${delta} ${m.unit}${note ? ` (${note})` : ''}`);
}

export interface BatchRecordInput extends BatchInput {
  productId: string;
  deductMaterials: boolean;
  note: string;
}

/** Log a production run: stock goes up, materials go down, and the product's cost is averaged in. */
export async function recordBatch(input: BatchRecordInput): Promise<Batch> {
  return db.transaction('rw', [db.batches, db.stockMoves, db.materials, db.productCosts, db.costPoints, db.products, db.audit], async () => {
    const materials = new Map(alive(await db.materials.toArray()).map((m) => [m.id, m]));
    const c = batchCost(input, materials);
    if (c.good <= 0) throw new Error('A batch needs at least one good piece.');
    const unit = c.unit ?? 0;
    const onHand = onHandByProduct(alive(await db.stockMoves.where('productId').equals(input.productId).toArray())).get(input.productId) ?? 0;
    const batch = build<Batch>({
      productId: input.productId,
      at: Date.now(),
      qtyMade: input.qtyMade,
      qtySpoiled: input.qtySpoiled,
      materials: input.materials.filter((m) => m.qty > 0),
      laborMinutes: input.laborMinutes,
      laborRate: input.laborRate,
      oneTime: input.oneTime,
      other: input.other,
      overheadPct: input.overheadPct,
      totalCost: c.total,
      unitCost: unit,
      deductMaterials: input.deductMaterials ? 1 : 0,
      note: input.note,
    });
    await db.batches.put(batch);
    await db.stockMoves.put(build<StockMove>({ productId: input.productId, qty: c.good, kind: 'batch', refId: batch.id, eventId: null, at: batch.at, note: `Batch of ${c.good}` }));
    if (input.deductMaterials) {
      for (const item of batch.materials) {
        const m = materials.get(item.materialId);
        if (m) await patch(db.materials, m.id, { onHand: Math.max(0, Math.round((m.onHand - item.qty) * 1000) / 1000) });
      }
    }
    const existing = await db.productCosts.get(input.productId);
    const prevCost = existing?.mode === 'batches' ? existing.current : null;
    const avg = weightedAverage(onHand, prevCost, c.good, unit);
    if (!existing || existing.mode === 'batches' || existing.current === null) {
      await upsertCost(input.productId, { mode: 'batches', current: avg });
      await addCostPoint(input.productId, avg, 'batch', `Batch of ${c.good}`);
    }
    const p = await db.products.get(input.productId);
    await audit('batch', 'product', input.productId, `Made ${c.good} ${p?.name ?? 'pieces'} for ${peso(c.total)} (${peso(unit)} each)`);
    return batch;
  });
}

export async function adjustStock(productId: string, delta: number, note: string): Promise<void> {
  if (!delta) return;
  await create<StockMove>(db.stockMoves, { productId, qty: delta, kind: 'adjust', refId: null, eventId: null, at: Date.now(), note });
  const p = await db.products.get(productId);
  await audit('stock', 'product', productId, `${p?.name ?? 'Product'} stock ${delta > 0 ? '+' : ''}${delta}${note ? ` (${note})` : ''}`);
}
