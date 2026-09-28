import { db, alive } from '../db/db';
import { audit, create, patch, remove, save } from '../db/write';
import { getSetting, setSetting } from '../db/settings';
import { hashPin, newSalt } from '../lib/hash';
import { peso } from '../lib/money';
import type { ShareResult } from '../domain/share';
import type { AppRole, Member, PaymentMethod, Payout, SecuritySettings } from '../db/types';

export const ROLE_LABEL: Record<AppRole, string> = {
  owner: 'Owner',
  cashier: 'Cashier',
  designer: 'Designer',
  partner: 'Partner',
};

export const ROLE_HINT: Record<AppRole, string> = {
  owner: 'Everything: prices, costs, booth spend, payouts, voids, team and settings.',
  cashier: 'Sells and counts the drawer. No costs or payouts; voids and big discounts need your PIN.',
  designer: 'Sees event dashboards, their own shifts and payout, and how their designs sold.',
  partner: 'Sees their co-branded items and their share only.',
};

export async function saveMember(m: Partial<Member> & { name: string }): Promise<Member> {
  if (m.id) {
    const existing = await db.members.get(m.id);
    if (existing) {
      const next = { ...existing, ...m, email: (m.email ?? existing.email).trim().toLowerCase() } as Member;
      await save(db.members, next);
      if (existing.appRole !== next.appRole) await audit('role', 'member', next.id, `${next.name} is now ${ROLE_LABEL[next.appRole]}`);
      return next;
    }
  }
  const created = await create<Member>(db.members, {
    name: m.name.trim(),
    email: (m.email ?? '').trim().toLowerCase(),
    appRole: m.appRole ?? 'designer',
    roleLabel: m.roleLabel ?? '',
    weight: m.weight ?? 2,
    active: 1,
    phone: m.phone ?? '',
    payoutInfo: m.payoutInfo ?? '',
    notes: m.notes ?? '',
  });
  await audit('create', 'member', created.id, `Added ${created.name} as ${ROLE_LABEL[created.appRole]}`);
  return created;
}

export async function deactivateMember(id: string, active: boolean) {
  await patch(db.members, id, { active: active ? 1 : 0 });
}

export async function deleteMember(id: string) {
  const inUse = (await db.roster.where('memberId').equals(id).count()) + (await db.payouts.where('memberId').equals(id).count());
  if (inUse > 0) throw new Error('This person is on an event roster or has payouts. Mark them inactive instead.');
  await remove(db.members, id);
}

// ----- Owner PIN -----

export async function hasOwnerPin(): Promise<boolean> {
  const s = await getSetting<SecuritySettings>('security');
  return !!s.pinHash;
}

export async function verifyOwnerPin(pin: string): Promise<boolean> {
  const s = await getSetting<SecuritySettings>('security');
  if (!s.pinHash || !s.pinSalt) return true;
  return hashPin(pin, s.pinSalt) === s.pinHash;
}

export async function setOwnerPin(pin: string | null): Promise<void> {
  if (!pin) {
    await setSetting('security', { pinHash: null, pinSalt: null });
    await audit('security', 'settings', null, 'Removed the owner PIN');
    return;
  }
  const salt = newSalt();
  await setSetting('security', { pinHash: hashPin(pin, salt), pinSalt: salt });
  await audit('security', 'settings', null, 'Changed the owner PIN');
}

// ----- Payment methods -----

export async function savePaymentMethod(m: Partial<PaymentMethod> & { name: string }): Promise<void> {
  if (m.id) {
    const existing = await db.paymentMethods.get(m.id);
    if (existing) {
      await save(db.paymentMethods, { ...existing, ...m } as PaymentMethod);
      return;
    }
  }
  const count = await db.paymentMethods.count();
  await create<PaymentMethod>(db.paymentMethods, {
    name: m.name.trim(),
    kind: m.kind ?? 'ewallet',
    requireRef: m.requireRef ?? 1,
    qr: m.qr ?? null,
    accountName: m.accountName ?? '',
    accountNumber: m.accountNumber ?? '',
    active: 1,
    sort: count,
  });
}

// ----- Payouts -----

const payoutId = (eventId: string, kind: Payout['kind'], memberId: string) => `${eventId}:${kind}:${memberId}`;

/**
 * Save the computed split as payouts people can see and you can mark paid.
 * A payout already marked paid is left alone; the result lists any that changed since.
 */
export async function finalizePayouts(eventId: string, result: ShareResult): Promise<{ saved: number; changedAfterPaid: string[] }> {
  const rows: { kind: Payout['kind']; memberId: string; amount: number; detail: string }[] = [
    ...result.staff.map((s) => ({
      kind: 'staff' as const,
      memberId: s.memberId,
      amount: s.amount,
      detail: `${s.roleLabel} · weight ${s.weight} × ${s.hours} h = ${s.points} points${s.topUp ? ` · topped up ${peso(s.topUp)} to the minimum` : ''}`,
    })),
    ...result.partners.map((p) => ({
      kind: 'partner' as const,
      memberId: p.partnerId,
      amount: p.amount,
      detail: `${p.dealName}: ${p.pct}% of ${peso(p.base)} (${p.units} sold${p.sellThroughPct !== null ? `, ${Math.round(p.sellThroughPct)}% sell-through` : ''})`,
    })),
    ...result.royalties.map((r) => ({ kind: 'royalty' as const, memberId: r.memberId, amount: r.amount, detail: `Royalty on ${r.units} pieces (${peso(r.revenue)} sales)` })),
  ];
  // Several deals can pay the same partner: combine per member and kind.
  const merged = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const key = payoutId(eventId, r.kind, r.memberId);
    const prev = merged.get(key);
    merged.set(key, prev ? { ...prev, amount: prev.amount + r.amount, detail: `${prev.detail}; ${r.detail}` } : r);
  }
  const changedAfterPaid: string[] = [];
  let saved = 0;
  const existing = new Map(alive(await db.payouts.where('eventId').equals(eventId).toArray()).map((p) => [p.id, p]));
  for (const [id, r] of merged) {
    const prev = existing.get(id);
    if (prev?.status === 'paid') {
      if (prev.amount !== r.amount) changedAfterPaid.push(id);
      continue;
    }
    const p: Payout = prev
      ? { ...prev, amount: r.amount, detail: r.detail }
      : { id, eventId, memberId: r.memberId, kind: r.kind, amount: r.amount, detail: r.detail, status: 'pending', paidAt: null, method: '', ref: '', createdAt: Date.now(), updatedAt: Date.now() };
    await save(db.payouts, p);
    saved++;
  }
  // Pending payouts that no longer apply (someone left the roster) are removed.
  for (const [id, prev] of existing) {
    if (!merged.has(id) && prev.status === 'pending') await remove(db.payouts, id);
  }
  const ev = await db.events.get(eventId);
  await audit('payouts', 'event', eventId, `Saved payouts for ${ev?.name ?? 'event'}: ${saved} people, staff pool ${peso(result.staffPool)}`);
  return { saved, changedAfterPaid };
}

export async function markPayoutPaid(id: string, paid: boolean, method = '', ref = '') {
  const p = await db.payouts.get(id);
  if (!p) return;
  await patch(db.payouts, id, paid ? { status: 'paid', paidAt: Date.now(), method, ref } : { status: 'pending', paidAt: null });
  const m = await db.members.get(p.memberId);
  await audit('payout', 'payout', id, `${paid ? 'Paid' : 'Unmarked payment to'} ${m?.name ?? 'member'} ${peso(p.amount)}${method ? ` via ${method}` : ''}`);
}
