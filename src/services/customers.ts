import { db, alive } from '../db/db';
import { audit, create, patch, remove, save } from '../db/write';
import { normalizeCode } from '../domain/loyalty';
import type { Customer, Voucher } from '../db/types';

const cleanPhone = (p: string) => p.replace(/[^\d+]/g, '');

export async function saveCustomer(c: Partial<Customer> & { name: string }): Promise<Customer> {
  const fields = {
    name: c.name.trim(),
    phone: cleanPhone(c.phone ?? ''),
    email: (c.email ?? '').trim().toLowerCase(),
    handle: (c.handle ?? '').trim(),
    notes: (c.notes ?? '').trim(),
  };
  if (!fields.name) throw new Error('Add the customer’s name.');
  if (fields.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(fields.email)) throw new Error('That email address doesn’t look right.');
  if (c.id) {
    const existing = await db.customers.get(c.id);
    if (existing) {
      const marketingOk = c.marketingOk ?? existing.marketingOk;
      const next: Customer = { ...existing, ...fields, marketingOk, consentAt: marketingOk === 1 ? (existing.marketingOk === 1 ? existing.consentAt : Date.now()) : null };
      return save(db.customers, next);
    }
  }
  const marketingOk = c.marketingOk ?? 0;
  const created = await create<Customer>(db.customers, { ...fields, marketingOk, consentAt: marketingOk === 1 ? Date.now() : null, firstEventId: c.firstEventId ?? null });
  await audit('create', 'customer', created.id, `Added customer ${created.name}`);
  return created;
}

/** Delete on request: their details are wiped, not just hidden. Their past sales stay, without a name. */
export async function deleteCustomer(id: string): Promise<void> {
  const c = await db.customers.get(id);
  if (!c) return;
  await patch(db.customers, id, { name: 'Deleted customer', phone: '', email: '', handle: '', notes: '', marketingOk: 0, consentAt: null });
  await remove(db.customers, id);
  await audit('delete', 'customer', id, 'Deleted a customer’s details on request');
}

export async function saveVoucher(v: Partial<Voucher> & { code: string }): Promise<Voucher> {
  const code = normalizeCode(v.code);
  if (!/^[A-Z0-9-]{3,20}$/.test(code)) throw new Error('Use 3 to 20 letters, numbers or dashes for the code.');
  const clash = alive(await db.vouchers.where('code').equals(code).toArray()).find((x) => x.id !== v.id);
  if (clash) throw new Error(`${code} is already a voucher.`);
  if (!v.value || v.value <= 0) throw new Error('Set how much the voucher takes off.');
  if (v.kind === 'percent' && v.value > 100) throw new Error('A percentage can’t be over 100.');
  const fields = {
    code,
    label: (v.label ?? '').trim(),
    kind: v.kind ?? 'amount',
    value: v.value,
    minSpend: v.minSpend ?? 0,
    validFrom: v.validFrom ?? '',
    validTo: v.validTo ?? '',
    eventId: v.eventId ?? null,
    maxUses: v.maxUses ?? null,
    perCustomer: v.perCustomer ?? null,
    active: v.active ?? 1,
    notes: (v.notes ?? '').trim(),
  } satisfies Omit<Voucher, 'id' | 'createdAt' | 'updatedAt'>;
  if (v.id) {
    const existing = await db.vouchers.get(v.id);
    if (existing) return save(db.vouchers, { ...existing, ...fields });
  }
  const created = await create<Voucher>(db.vouchers, fields);
  await audit('create', 'voucher', created.id, `Added voucher ${created.code}`);
  return created;
}

export async function deleteVoucher(id: string): Promise<void> {
  const v = await db.vouchers.get(id);
  await remove(db.vouchers, id);
  if (v) await audit('delete', 'voucher', id, `Deleted voucher ${v.code}`);
}
