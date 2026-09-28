import { db } from '../db/db';
import { audit, create, patch, remove, save } from '../db/write';
import { peso } from '../lib/money';
import { uid } from '../lib/ids';
import { compressImage } from '../lib/files';
import type { SpendItem, SpendStatus } from '../db/types';

export const SPEND_TYPE_LABEL: Record<SpendItem['type'], string> = {
  booth_fee: 'Booth fee',
  consumable: 'Used up at the event',
  asset: 'Reusable asset',
  material: 'Materials for products',
};

export const SPEND_TYPE_HINT: Record<SpendItem['type'], string> = {
  booth_fee: 'Rent paid to the organizer.',
  consumable: 'Tarps, passport cards, vouchers, transport, food. Counted fully at this event.',
  asset: 'Stands, displays, grids, shirts. Spread across the events they serve.',
  material: 'Vinyl, laminate, ink, pin parts. Goes to stock; counted when products sell.',
};

export const SPEND_STATUS_LABEL: Record<SpendStatus, string> = {
  to_buy: 'To buy',
  bought: 'Bought',
  not_needed: 'Not needed',
};

export async function saveSpend(item: Partial<SpendItem> & { eventId: string; name: string; type: SpendItem['type'] }): Promise<SpendItem> {
  if (item.id) {
    const existing = await db.spend.get(item.id);
    if (existing) {
      const next = { ...existing, ...item } as SpendItem;
      await save(db.spend, next);
      await syncMaterialStock(existing, next);
      return next;
    }
  }
  const created = await create<SpendItem>(db.spend, {
    eventId: item.eventId,
    type: item.type,
    name: item.name.trim(),
    qty: item.qty ?? 1,
    unitCost: item.unitCost ?? 0,
    status: item.status ?? 'to_buy',
    amortizeEvents: item.amortizeEvents ?? (item.type === 'asset' ? 5 : 1),
    materialId: item.materialId ?? null,
    stocked: 0,
    pctUsed: item.pctUsed ?? 100,
    paidBy: item.paidBy ?? null,
    reimbursed: 0,
    photoId: item.photoId ?? null,
    notes: item.notes ?? '',
  });
  await syncMaterialStock(null, created);
  await audit('create', 'spend', created.id, `Booth spend: ${created.name} ${peso(Math.round(created.qty * created.unitCost))}`);
  return created;
}

/** A bought materials purchase restocks the material library once (and is undone if un-bought). */
async function syncMaterialStock(before: SpendItem | null, after: SpendItem) {
  if (after.type !== 'material' || !after.materialId) return;
  const m = await db.materials.get(after.materialId);
  if (!m) return;
  const shouldStock = after.status === 'bought' && after.deleted !== 1;
  const wasStocked = (before?.stocked ?? after.stocked) === 1;
  if (shouldStock && !wasStocked) {
    await patch(db.materials, m.id, { onHand: m.onHand + after.qty * m.packQty, counted: 1, packCost: after.unitCost > 0 ? after.unitCost : m.packCost });
    await patch(db.spend, after.id, { stocked: 1 });
  } else if (shouldStock && wasStocked && before && before.qty !== after.qty) {
    await patch(db.materials, m.id, { onHand: Math.max(0, m.onHand + (after.qty - before.qty) * m.packQty) });
  } else if (!shouldStock && wasStocked) {
    await patch(db.materials, m.id, { onHand: Math.max(0, m.onHand - (before?.qty ?? after.qty) * m.packQty) });
    await patch(db.spend, after.id, { stocked: 0 });
  }
}

export async function setSpendStatus(id: string, status: SpendStatus) {
  const existing = await db.spend.get(id);
  if (!existing) return;
  await saveSpend({ ...existing, status });
}

export async function deleteSpend(id: string) {
  const existing = await db.spend.get(id);
  if (!existing) return;
  await remove(db.spend, id);
  await syncMaterialStock(existing, { ...existing, deleted: 1 });
  await audit('delete', 'spend', id, `Removed booth spend ${existing.name}`);
}

export async function setReimbursed(id: string, value: boolean) {
  await patch(db.spend, id, { reimbursed: value ? 1 : 0 });
}

/** Receipt photos stay on this device (compressed); they are not uploaded. */
export async function savePhoto(file: Blob): Promise<string> {
  const blob = await compressImage(file, 1400, 0.8);
  const id = uid();
  await db.photos.put({ id, blob, mime: blob.type || 'image/jpeg', at: Date.now() });
  return id;
}
