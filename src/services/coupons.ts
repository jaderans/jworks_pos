import Dexie from 'dexie';
import { db, alive } from '../db/db';
import { audit, build, create, currentActor, patch, remove, save } from '../db/write';
import { peso, type Cents } from '../lib/money';
import { todayISO } from '../lib/time';
import { uid } from '../lib/ids';
import { normalizeCode } from '../domain/loyalty';
import { COUPON_MIN_SPEND, checkCoupon, claimId, earnBatchFor, generateCodes, offText, type CouponCheck } from '../domain/coupons';
import type { AppliedCoupon, Coupon, CouponBatch, CouponClaim, CouponSource, Sale } from '../db/types';

/**
 * Service coupons: the owner makes a set for an event (single-use codes or one
 * shared code), booth sales can earn them, and services claim them. See
 * domain/coupons for the rules.
 */

export interface BatchInput {
  id?: string;
  eventId: string;
  name: string;
  kind: CouponBatch['kind'];
  value: number;
  maxOff: Cents;
  minSpend: Cents;
  validFrom: string;
  validTo: string;
  mode: CouponBatch['mode'];
  maxUses: number | null;
  earnMin: Cents;
  prefix: string;
  notes: string;
  active?: 0 | 1;
  /** A new set of single-use codes: how many to make now (none for earned-only sets). */
  count?: number;
  /** A new shared set: its code; one is made up when it's blank. */
  code?: string;
}

const MAX_CODES = 500;

function checkBatch(b: BatchInput, prefix: string) {
  if (!b.eventId) throw new Error('Pick the event these coupons are for.');
  if (!b.name.trim()) throw new Error('Name this set, e.g. Booth handout.');
  if (!(b.value > 0)) throw new Error('Set how much the coupon takes off.');
  if (b.kind === 'percent' && b.value > 100) throw new Error('A percentage can’t be over 100.');
  if (b.minSpend < COUPON_MIN_SPEND) throw new Error(`Coupons are for services of ${peso(COUPON_MIN_SPEND)} or more.`);
  if (b.kind === 'amount' && b.value >= b.minSpend) throw new Error('The coupon has to take off less than the minimum service price.');
  if (!b.validFrom || !b.validTo) throw new Error('Set when the coupons start and when they expire.');
  if (b.validTo < b.validFrom) throw new Error('The expiry is before the start.');
  if (!/^[A-Z0-9]{2,8}$/.test(prefix)) throw new Error('Use 2 to 8 letters or numbers to start the codes.');
  if (b.mode === 'shared' && b.earnMin > 0) throw new Error('Coupons earned at the booth need their own codes, not one shared code.');
  if (b.maxUses !== null && !(b.maxUses >= 1)) throw new Error('Allow at least one use, or leave it blank for no limit.');
}

const takenCodes = async () => new Set((await db.coupons.toArray()).map((c) => c.code));

export async function saveBatch(b: BatchInput): Promise<CouponBatch> {
  const prefix = normalizeCode(b.prefix).replace(/-/g, '');
  checkBatch(b, prefix);
  const fields = {
    eventId: b.eventId,
    name: b.name.trim(),
    kind: b.kind,
    value: b.value,
    maxOff: b.kind === 'percent' ? Math.max(0, b.maxOff) : 0,
    minSpend: b.minSpend,
    validFrom: b.validFrom,
    validTo: b.validTo,
    mode: b.mode,
    maxUses: b.mode === 'unique' ? 1 : b.maxUses,
    earnMin: b.mode === 'unique' ? Math.max(0, b.earnMin) : 0,
    prefix,
    active: b.active ?? 1,
    notes: b.notes.trim(),
  } satisfies Omit<CouponBatch, 'id' | 'createdAt' | 'updatedAt'>;
  if (b.id) {
    const prev = await db.couponBatches.get(b.id);
    if (!prev || prev.deleted === 1) throw new Error('That set of coupons no longer exists.');
    if (prev.mode !== b.mode) throw new Error('A set can’t switch between single-use and shared codes.');
    const out = await save(db.couponBatches, { ...prev, ...fields, prefix: prev.prefix });
    await audit('update', 'couponBatch', b.id, `Changed coupons “${out.name}”: ${offText(out)}`);
    return out;
  }
  let shared = '';
  if (b.mode === 'shared') {
    const taken = await takenCodes();
    shared = b.code?.trim() ? normalizeCode(b.code) : generateCodes(prefix, 1, taken)[0];
    if (!/^[A-Z0-9-]{3,20}$/.test(shared)) throw new Error('Use 3 to 20 letters, numbers or dashes for the code.');
    if (taken.has(shared)) throw new Error(`${shared} is already a coupon code.`);
  }
  if (b.mode === 'unique' && (b.count ?? 0) > MAX_CODES) throw new Error(`Make up to ${MAX_CODES} codes at a time.`);
  const batch = await create<CouponBatch>(db.couponBatches, fields);
  if (b.mode === 'shared') await newCoupon(batch, shared);
  else if (b.count) await addCodes(batch.id, b.count, false);
  await audit('create', 'couponBatch', batch.id, `Made coupons “${batch.name}”: ${offText(batch)}, services of ${peso(batch.minSpend)} or more${b.mode === 'shared' ? `, code ${shared}` : b.count ? `, ${b.count} codes` : ''}`);
  return batch;
}

const newCoupon = (b: CouponBatch, code: string, more: Partial<Coupon> = {}) =>
  create<Coupon>(db.coupons, { code, batchId: b.id, eventId: b.eventId, customerId: null, saleId: null, givenAt: null, remindedAt: null, void: 0, ...more });

/** More single-use codes for a set. */
export async function addCodes(batchId: string, count: number, log = true): Promise<string[]> {
  const b = await db.couponBatches.get(batchId);
  if (!b || b.deleted === 1) throw new Error('That set of coupons no longer exists.');
  if (b.mode !== 'unique') throw new Error('A shared code is one code for everyone.');
  if (!(count >= 1) || count > MAX_CODES) throw new Error(`Make 1 to ${MAX_CODES} codes at a time.`);
  const codes = generateCodes(b.prefix, Math.round(count), await takenCodes());
  await db.coupons.bulkPut(codes.map((code) => build<Coupon>({ code, batchId: b.id, eventId: b.eventId, customerId: null, saleId: null, givenAt: null, remindedAt: null, void: 0 })));
  if (log) await audit('create', 'couponBatch', b.id, `Added ${codes.length} codes to “${b.name}”`);
  return codes;
}

export async function setBatchActive(id: string, active: boolean): Promise<void> {
  const b = await db.couponBatches.get(id);
  if (!b) return;
  await patch(db.couponBatches, id, { active: active ? 1 : 0 });
  await audit('update', 'couponBatch', id, `${active ? 'Turned on' : 'Turned off'} coupons “${b.name}”`);
}

/** Delete a set and its codes; only while none of them has been used. */
export async function deleteBatch(id: string): Promise<void> {
  const b = await db.couponBatches.get(id);
  if (!b) return;
  const codes = alive(await db.coupons.where('batchId').equals(id).toArray());
  const used = alive(await db.couponClaims.where('couponId').anyOf(codes.map((c) => c.id)).toArray());
  if (used.length) throw new Error('Some of these codes were used. Turn the set off instead.');
  for (const c of codes) await remove(db.coupons, c.id);
  await remove(db.couponBatches, id);
  await audit('delete', 'couponBatch', id, `Deleted coupons “${b.name}” (${codes.length} codes)`);
}

export async function setCouponOff(id: string, off: boolean): Promise<void> {
  const c = await db.coupons.get(id);
  if (!c) return;
  await patch(db.coupons, id, { void: off ? 1 : 0 });
  await audit('update', 'coupon', id, `${off ? 'Turned off' : 'Turned on'} coupon ${c.code}`);
}

/** Who a code was handed to, for the expiry reminder. */
export async function giveCoupon(id: string, customerId: string | null): Promise<void> {
  const c = await db.coupons.get(id);
  if (!c) return;
  await patch(db.coupons, id, { customerId, givenAt: customerId ? (c.givenAt ?? Date.now()) : null, remindedAt: null });
}

export async function markReminded(id: string): Promise<void> {
  await patch(db.coupons, id, { remindedAt: Date.now() });
}

/**
 * A booth sale over a set's amount earns the customer a code (the best set it
 * reaches, one code per sale). Deposits don't earn.
 */
export async function issueEarnedCoupon(sale: Sale): Promise<Coupon | null> {
  if (sale.kind === 'deposit' || sale.kind === 'service' || sale.status !== 'completed') return null;
  const already = alive(await db.coupons.where('saleId').equals(sale.id).toArray());
  if (already.length) return already[0];
  const b = earnBatchFor(alive(await db.couponBatches.where('eventId').equals(sale.eventId).toArray()), sale.eventId, sale.total, todayISO());
  if (!b) return null;
  const [code] = generateCodes(b.prefix, 1, await takenCodes());
  const c = await newCoupon(b, code, { customerId: sale.customerId ?? null, saleId: sale.id, givenAt: Date.now() });
  await audit('create', 'coupon', c.id, `${sale.receiptNo} earned coupon ${code} (${offText(b)})`);
  return c;
}

/** A voided sale's earned code is turned off, unless it was already used. */
export async function voidEarnedCoupons(saleId: string): Promise<void> {
  for (const c of alive(await db.coupons.where('saleId').equals(saleId).toArray())) {
    const used = alive(await db.couponClaims.where('couponId').equals(c.id).toArray());
    if (!used.length && c.void !== 1) await patch(db.coupons, c.id, { void: 1 });
  }
}

/** Check a code against this device's coupons. */
export async function checkCouponCode(code: string, price: Cents, claim: string | null): Promise<CouponCheck> {
  const c = normalizeCode(code);
  const coupons = alive(await db.coupons.where('code').equals(c).toArray());
  const batches = alive((await db.couponBatches.bulkGet(coupons.map((x) => x.batchId))).filter((b): b is CouponBatch => !!b));
  const claims = coupons.length ? alive(await db.couponClaims.where('couponId').anyOf(coupons.map((x) => x.id)).toArray()) : [];
  return checkCoupon(c, { coupons, batches, claims }, { today: todayISO(), price, claimId: claim });
}

/** What to store on a service for this code, after checking it; null with no code. */
export async function resolveCoupon(code: string | null | undefined, price: Cents, claim: string | null): Promise<AppliedCoupon | null> {
  if (!code?.trim()) return null;
  const r = await checkCouponCode(code, price, claim);
  if (!r.ok) throw new Error(r.reason);
  return { couponId: r.coupon.id, code: r.coupon.code, discount: r.discount };
}

export interface ClaimInfo {
  source: CouponSource;
  sourceId: string;
  /** "Print order PA-004". */
  service: string;
  customerId: string | null;
  customerName: string;
  /** Before the coupon. */
  price: Cents;
}

/** Keep a service's claim in step with the coupon it holds now: added, changed, or released when it has none. */
export async function syncClaim(info: ClaimInfo, applied: AppliedCoupon | null | undefined): Promise<void> {
  const id = claimId(info.source, info.sourceId);
  const prev = await db.couponClaims.get(id);
  const held = prev && prev.deleted !== 1 ? prev : null;
  if (!applied) {
    if (!held) return;
    await remove(db.couponClaims, id);
    await audit('release', 'coupon', held.couponId, `${held.code} is free again (${held.service})`);
    return;
  }
  const coupon = await db.coupons.get(applied.couponId);
  if (!coupon || coupon.deleted === 1) throw new Error('That coupon no longer exists.');
  const fields = {
    couponId: coupon.id,
    code: coupon.code,
    batchId: coupon.batchId,
    eventId: coupon.eventId,
    ...info,
    customerName: info.customerName.trim(),
    discount: applied.discount,
  };
  if (held && (Object.keys(fields) as (keyof typeof fields)[]).every((k) => held[k] === fields[k])) return;
  const kept = held && held.couponId === coupon.id ? held : null;
  await save(db.couponClaims, { ...(held ?? build<CouponClaim>({ id, ...fields, at: Date.now(), by: currentActor() })), ...fields, id, at: kept ? kept.at : Date.now(), by: kept ? kept.by : currentActor(), deleted: 0 });
  if (!kept) await audit('claim', 'coupon', coupon.id, `${coupon.code} used on ${info.service}: ${peso(applied.discount)} off`);
}

/** A service booked somewhere the app can't see (Messenger, Studio on another device). */
export async function recordClaim(o: { code: string; service: string; customerId: string | null; customerName: string; price: Cents }): Promise<void> {
  if (!o.service.trim()) throw new Error('Say what the coupon was used on.');
  if (!o.customerId && !o.customerName.trim()) throw new Error('Add who used it.');
  const applied = await resolveCoupon(o.code, o.price, null);
  if (!applied) throw new Error('Type the coupon code.');
  await syncClaim({ source: 'manual', sourceId: uid(), service: o.service.trim(), customerId: o.customerId, customerName: o.customerName, price: o.price }, applied);
}

/** Undo a claim recorded by hand. Other claims follow their service. */
export async function removeClaim(id: string): Promise<void> {
  const c = await db.couponClaims.get(id);
  if (!c || c.source !== 'manual') return;
  await remove(db.couponClaims, id);
  await audit('release', 'coupon', c.couponId, `${c.code}: removed the claim for ${c.service}`);
}

// ----- JoshWorks Studio -----

/** JoshWorks Studio keeps its data in this database on the same site. */
const STUDIO_DB = 'jworks-campaigns';

interface StudioMoney {
  id: string;
  deleted?: 0 | 1;
  total?: Cents;
  discountAmount?: Cents;
  couponCode?: string;
  couponId?: string;
}

/**
 * Studio jobs on this device that took a coupon become claims here, so every
 * phone sees them. Jobs Studio imported from the POS (pos-…) are skipped:
 * their print order or order already holds the claim. Studio is opened
 * read-only and closed straight away.
 */
export async function readStudioClaims(): Promise<{ found: boolean; changed: number }> {
  if (!(await Dexie.exists(STUDIO_DB))) return { found: false, changed: 0 };
  const st = new Dexie(STUDIO_DB);
  const wanted = new Map<string, { info: ClaimInfo; code: string; couponId: string; discount: Cents }>();
  // Jobs this device's Studio knows about; a claim for a job it doesn't have is left alone.
  const known = new Set<string>();
  try {
    await st.open();
    const names = new Set(st.tables.map((t) => t.name));
    if (!names.has('jobMoney') || !names.has('jobs')) return { found: true, changed: 0 };
    const money = (await st.table('jobMoney').toArray()) as StudioMoney[];
    const jobs = new Map(((await st.table('jobs').toArray()) as { id: string; deleted?: 0 | 1; number?: string; title?: string; clientId?: string | null; clientName?: string }[]).map((j) => [j.id, j]));
    const clients = names.has('clients') ? new Map(((await st.table('clients').toArray()) as { id: string; name?: string }[]).map((c) => [c.id, c])) : new Map<string, { name?: string }>();
    for (const id of jobs.keys()) known.add(id);
    for (const m of money) {
      const job = jobs.get(m.id);
      if (m.deleted === 1 || !m.couponCode || m.id.startsWith('pos-') || !job || job.deleted === 1) continue;
      const discount = Math.max(0, m.discountAmount ?? 0);
      wanted.set(m.id, {
        code: normalizeCode(m.couponCode),
        couponId: m.couponId ?? '',
        discount,
        info: {
          source: 'studio',
          sourceId: m.id,
          service: `Studio job ${job.number ?? ''}${job.title ? `: ${job.title}` : ''}`.trim(),
          customerId: null,
          customerName: (job.clientId ? clients.get(job.clientId)?.name : '') || job.clientName || '',
          price: Math.max(0, m.total ?? 0) + discount,
        },
      });
    }
  } catch {
    return { found: true, changed: 0 };
  } finally {
    st.close();
  }
  let changed = 0;
  for (const w of wanted.values()) {
    const coupon = (w.couponId && (await db.coupons.get(w.couponId))) || alive(await db.coupons.where('code').equals(w.code).toArray())[0];
    if (!coupon) continue;
    const before = await db.couponClaims.get(claimId('studio', w.info.sourceId));
    await syncClaim(w.info, { couponId: coupon.id, code: coupon.code, discount: w.discount });
    const after = await db.couponClaims.get(claimId('studio', w.info.sourceId));
    if (before?.updatedAt !== after?.updatedAt) changed++;
  }
  // Jobs that dropped their coupon, or were deleted, let it go.
  for (const c of alive(await db.couponClaims.toArray())) {
    if (c.source === 'studio' && known.has(c.sourceId) && !wanted.has(c.sourceId)) {
      await syncClaim({ source: 'studio', sourceId: c.sourceId, service: c.service, customerId: null, customerName: c.customerName, price: c.price }, null);
      changed++;
    }
  }
  return { found: true, changed };
}
