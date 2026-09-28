import { db, alive } from '../db/db';
import { audit, create, patch, remove, save } from '../db/write';
import { peso, roundUpTo, percentOf, type Cents } from '../lib/money';
import type { BundleRule, Category, EventProduct, Product } from '../db/types';

export const eventProductId = (eventId: string, productId: string) => `${eventId}:${productId}`;

/** Price at an event: the event override, else the base price. */
export function effectivePrice(p: Pick<Product, 'price'>, ep: Pick<EventProduct, 'price'> | undefined): Cents | null {
  return ep && ep.price !== null && ep.price !== undefined ? ep.price : p.price;
}

export function isOnSale(p: Product, ep: EventProduct | undefined): boolean {
  return p.deleted !== 1 && p.active === 1 && (ep ? ep.active === 1 : true);
}

export async function nextBarcode(): Promise<string> {
  const all = await db.products.toArray();
  let max = 0;
  for (const p of all) {
    const m = /^JW-(\d+)$/.exec(p.barcode ?? '');
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `JW-${String(max + 1).padStart(4, '0')}`;
}

export async function findByCode(code: string): Promise<Product | undefined> {
  const c = code.trim();
  if (!c) return undefined;
  const byBarcode = alive(await db.products.where('barcode').equals(c).toArray());
  if (byBarcode.length) return byBarcode[0];
  const upper = c.toUpperCase();
  const all = alive(await db.products.toArray());
  return all.find((p) => p.barcode.toUpperCase() === upper || p.sku.toUpperCase() === upper);
}

export async function createProduct(fields: Partial<Product> & { name: string }): Promise<Product> {
  const count = await db.products.count();
  const p = await create<Product>(db.products, {
    name: fields.name.trim(),
    categoryId: fields.categoryId ?? null,
    sku: (fields.sku ?? '').trim().toUpperCase(),
    barcode: fields.barcode?.trim() || (await nextBarcode()),
    price: fields.price ?? null,
    active: fields.active ?? 1,
    trackStock: fields.trackStock ?? 1,
    designerId: fields.designerId ?? null,
    royalty: fields.royalty ?? null,
    notes: fields.notes ?? '',
    sort: fields.sort ?? count,
  });
  await audit('create', 'product', p.id, `Added product ${p.name}${p.price !== null ? ` at ${peso(p.price)}` : ''}`);
  return p;
}

export async function updateProduct(id: string, changes: Partial<Product>): Promise<void> {
  const before = await db.products.get(id);
  if (!before) return;
  await patch(db.products, id, changes);
  if ('price' in changes && changes.price !== before.price) {
    await audit('price', 'product', id, `Base price of ${before.name}: ${peso(before.price)} → ${peso(changes.price ?? null)}`);
  }
  if (changes.name && changes.name !== before.name) await audit('update', 'product', id, `Renamed ${before.name} to ${changes.name}`);
}

export async function deleteProduct(id: string): Promise<void> {
  const p = await db.products.get(id);
  await remove(db.products, id);
  if (p) await audit('delete', 'product', id, `Deleted product ${p.name}`);
}

export async function setEventProduct(eventId: string, productId: string, changes: Partial<Pick<EventProduct, 'price' | 'active' | 'stockBrought'>>): Promise<void> {
  const id = eventProductId(eventId, productId);
  const existing = await db.eventProducts.get(id);
  if (existing && existing.deleted !== 1) {
    await patch(db.eventProducts, id, changes);
  } else {
    await create<EventProduct>(db.eventProducts, { id, eventId, productId, price: null, active: 1, stockBrought: null, ...changes });
  }
  if ('price' in changes) {
    const p = await db.products.get(productId);
    const ev = await db.events.get(eventId);
    await audit('price', 'eventProduct', id, `${p?.name ?? 'Product'} at ${ev?.name ?? 'event'}: ${changes.price === null ? `back to base price ${peso(p?.price ?? null)}` : peso(changes.price ?? null)}`);
  }
}

export type BulkPriceOp =
  | { kind: 'add'; value: Cents }
  | { kind: 'percent'; value: number }
  | { kind: 'round'; value: number }
  | { kind: 'reset' };

/** Change event prices for many products at once (base prices are untouched). */
export async function bulkEventPrice(eventId: string, products: readonly Product[], ops: BulkPriceOp): Promise<number> {
  let changed = 0;
  const eps = new Map(alive(await db.eventProducts.where('eventId').equals(eventId).toArray()).map((e) => [e.productId, e]));
  for (const p of products) {
    const current = effectivePrice(p, eps.get(p.id));
    let next: Cents | null = current;
    if (ops.kind === 'reset') next = null;
    else if (current === null) continue;
    else if (ops.kind === 'add') next = Math.max(0, current + ops.value);
    else if (ops.kind === 'percent') next = Math.max(0, current + percentOf(current, ops.value));
    else if (ops.kind === 'round') next = roundUpTo(current, ops.value);
    if (next === (eps.get(p.id)?.price ?? null) && ops.kind === 'reset') continue;
    const id = eventProductId(eventId, p.id);
    const existing = eps.get(p.id);
    if (existing) await patch(db.eventProducts, id, { price: next });
    else await create<EventProduct>(db.eventProducts, { id, eventId, productId: p.id, price: next, active: 1, stockBrought: null });
    changed++;
  }
  const ev = await db.events.get(eventId);
  const label = ops.kind === 'add' ? `${ops.value >= 0 ? '+' : ''}${peso(ops.value)}` : ops.kind === 'percent' ? `${ops.value >= 0 ? '+' : ''}${ops.value}%` : ops.kind === 'round' ? `rounded up to ₱${ops.value}` : 'reset to base prices';
  await audit('price', 'event', eventId, `Event prices at ${ev?.name ?? 'event'}: ${label} on ${changed} product${changed === 1 ? '' : 's'}`);
  return changed;
}

export async function createCategory(name: string): Promise<Category> {
  const count = await db.categories.count();
  return create<Category>(db.categories, { name: name.trim(), sort: count });
}

export async function renameCategory(id: string, name: string) {
  await patch(db.categories, id, { name: name.trim() });
}

export async function deleteCategory(id: string) {
  const products = alive(await db.products.where('categoryId').equals(id).toArray());
  for (const p of products) await patch(db.products, p.id, { categoryId: null });
  await remove(db.categories, id);
}

export async function saveBundleRule(rule: Partial<BundleRule> & { name: string; productIds: string[]; qty: number; price: Cents }): Promise<void> {
  if (rule.id) {
    const existing = await db.bundleRules.get(rule.id);
    if (existing) {
      await save(db.bundleRules, { ...existing, ...rule } as BundleRule);
      await audit('update', 'bundle', rule.id, `Updated bundle ${rule.name}: ${rule.qty} for ${peso(rule.price)}`);
      return;
    }
  }
  const created = await create<BundleRule>(db.bundleRules, {
    name: rule.name,
    productIds: rule.productIds,
    qty: rule.qty,
    price: rule.price,
    active: rule.active ?? 1,
    eventId: rule.eventId ?? null,
  });
  await audit('create', 'bundle', created.id, `Added bundle ${rule.name}: ${rule.qty} for ${peso(rule.price)}`);
}

export async function deleteBundleRule(id: string) {
  const r = await db.bundleRules.get(id);
  await remove(db.bundleRules, id);
  if (r) await audit('delete', 'bundle', id, `Deleted bundle ${r.name}`);
}
