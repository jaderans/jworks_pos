import { db, alive } from '../db/db';
import { audit, build, create, patch, remove, save } from '../db/write';
import { toCents } from '../lib/money';
import { daysBetween, todayISO } from '../lib/time';
import type { BundleRule, EventProduct, JWEvent, PartnerDeal, RosterEntry, Shift } from '../db/types';
import { eventProductId } from './catalog';

export const EVENT_STATUS_LABEL: Record<JWEvent['status'], string> = {
  planning: 'Planning',
  live: 'Live',
  closed: 'Closed',
  reported: 'Reported',
};

export async function newEventFields(): Promise<Omit<JWEvent, 'id' | 'createdAt' | 'updatedAt'>> {
  const methods = alive(await db.paymentMethods.toArray()).filter((m) => m.active === 1);
  const today = todayISO();
  return {
    name: '',
    organizer: '',
    venue: '',
    boothNo: '',
    startDate: today,
    endDate: today,
    status: 'planning',
    paymentMethodIds: methods.sort((a, b) => a.sort - b.sort).map((m) => m.id),
    openingFloat: toCents(2000),
    discounts: [],
    cashierDiscountLimitPct: 10,
    targets: { sales: null, items: null, leads: null },
    share: { joshworksPct: 40, poolMode: 'all', weightMode: 'weighthours', minGuarantee: null, topUp: false, royaltiesBeforePool: true },
    counters: { leads: 0, orgOfficers: 0 },
    notes: '',
  };
}

export async function createEvent(fields: Partial<JWEvent> & { name: string }): Promise<JWEvent> {
  const base = await newEventFields();
  const ev = await create<JWEvent>(db.events, { ...base, ...fields, name: fields.name.trim() });
  await audit('create', 'event', ev.id, `Created event ${ev.name}`);
  return ev;
}

export async function updateEvent(id: string, changes: Partial<JWEvent>): Promise<void> {
  await patch(db.events, id, changes);
  if (changes.status) {
    const ev = await db.events.get(id);
    await audit('status', 'event', id, `${ev?.name ?? 'Event'} is now ${EVENT_STATUS_LABEL[changes.status]}`);
  }
}

export async function deleteEvent(id: string): Promise<void> {
  const ev = await db.events.get(id);
  const sales = await db.sales.where('eventId').equals(id).count();
  if (sales > 0) throw new Error('This event has sales. Close it instead of deleting it, so the sales stay on record.');
  await remove(db.events, id);
  await audit('delete', 'event', id, `Deleted event ${ev?.name ?? ''}`);
}

export interface DuplicateOptions {
  name: string;
  startDate: string;
  endDate: string;
  copyPrices: boolean;
  copyStock: boolean;
  copyRoster: boolean;
  copyDeals: boolean;
  copyBundles: boolean;
}

/** Start a new event from an earlier one: settings, prices, team and deals carry over; sales don't. */
export async function duplicateEvent(sourceId: string, opts: DuplicateOptions): Promise<JWEvent> {
  const src = await db.events.get(sourceId);
  if (!src) throw new Error('The event to copy no longer exists.');
  return db.transaction('rw', [db.events, db.eventProducts, db.roster, db.partnerDeals, db.bundleRules, db.audit], async () => {
    const ev = await create<JWEvent>(db.events, {
      ...src,
      id: undefined,
      name: opts.name.trim() || `${src.name} (copy)`,
      startDate: opts.startDate,
      endDate: opts.endDate,
      status: 'planning',
      counters: { leads: 0, orgOfficers: 0 },
      notes: src.notes,
    } as never);
    if (opts.copyPrices || opts.copyStock) {
      const eps = alive(await db.eventProducts.where('eventId').equals(sourceId).toArray());
      await db.eventProducts.bulkPut(
        eps.map((e) =>
          build<EventProduct>({
            id: eventProductId(ev.id, e.productId),
            eventId: ev.id,
            productId: e.productId,
            price: opts.copyPrices ? e.price : null,
            active: e.active,
            stockBrought: opts.copyStock ? e.stockBrought : null,
          }),
        ),
      );
    }
    if (opts.copyRoster) {
      const days = daysBetween(opts.startDate, opts.endDate);
      const roster = alive(await db.roster.where('eventId').equals(sourceId).toArray());
      await db.roster.bulkPut(
        roster.map((r) =>
          build<RosterEntry>({
            eventId: ev.id,
            memberId: r.memberId,
            roleLabel: r.roleLabel,
            weight: r.weight,
            shifts: defaultShifts(days, r.shifts),
            hoursOverride: null,
            inPool: r.inPool,
          }),
        ),
      );
    }
    if (opts.copyDeals) {
      const deals = alive(await db.partnerDeals.where('eventId').equals(sourceId).toArray());
      await db.partnerDeals.bulkPut(deals.map((d) => build<PartnerDeal>({ ...d, id: undefined, eventId: ev.id } as never)));
    }
    if (opts.copyBundles) {
      const rules = alive(await db.bundleRules.where('eventId').equals(sourceId).toArray());
      await db.bundleRules.bulkPut(rules.map((r) => build<BundleRule>({ ...r, id: undefined, eventId: ev.id } as never)));
    }
    await audit('create', 'event', ev.id, `Created ${ev.name} from ${src.name}`);
    return ev;
  });
}

/** One 9:00–17:00 shift per event day, or the times someone usually works. */
export function defaultShifts(days: string[], template: Shift[] = []): Shift[] {
  const t = template[0] ?? { date: '', start: '09:00', end: '17:00' };
  return days.map((date) => ({ date, start: t.start, end: t.end }));
}

export async function addToRoster(eventId: string, memberId: string): Promise<void> {
  const ev = await db.events.get(eventId);
  const m = await db.members.get(memberId);
  if (!ev || !m) return;
  const existing = alive(await db.roster.where('eventId').equals(eventId).toArray()).find((r) => r.memberId === memberId);
  if (existing) return;
  await create<RosterEntry>(db.roster, {
    eventId,
    memberId,
    roleLabel: m.roleLabel || 'Team',
    weight: m.weight || 1,
    shifts: defaultShifts(daysBetween(ev.startDate, ev.endDate)),
    hoursOverride: null,
    inPool: m.appRole === 'partner' ? 0 : 1,
  });
  await audit('roster', 'event', eventId, `Added ${m.name} to the ${ev.name} roster`);
}

export async function updateRoster(id: string, changes: Partial<RosterEntry>) {
  await patch(db.roster, id, changes);
}

export async function removeFromRoster(id: string) {
  const r = await db.roster.get(id);
  await remove(db.roster, id);
  if (r) {
    const m = await db.members.get(r.memberId);
    await audit('roster', 'event', r.eventId, `Removed ${m?.name ?? 'a member'} from the roster`);
  }
}

export async function saveDeal(deal: Partial<PartnerDeal> & { eventId: string; partnerId: string; name: string }): Promise<void> {
  if (deal.id) {
    const existing = await db.partnerDeals.get(deal.id);
    if (existing) {
      await save(db.partnerDeals, { ...existing, ...deal } as PartnerDeal);
      return;
    }
  }
  const d = await create<PartnerDeal>(db.partnerDeals, {
    eventId: deal.eventId,
    partnerId: deal.partnerId,
    name: deal.name,
    productIds: deal.productIds ?? [],
    basis: deal.basis ?? 'net',
    mode: deal.mode ?? 'fixed',
    fixedPct: deal.fixedPct ?? 20,
    tiers: deal.tiers ?? [],
  });
  await audit('create', 'deal', d.id, `Added partner deal ${d.name}`);
}

export async function deleteDeal(id: string) {
  await remove(db.partnerDeals, id);
}

export async function bumpCounter(eventId: string, key: 'leads' | 'orgOfficers', delta: number) {
  const ev = await db.events.get(eventId);
  if (!ev) return;
  const next = { ...ev.counters, [key]: Math.max(0, (ev.counters?.[key] ?? 0) + delta) };
  await patch(db.events, eventId, { counters: next });
}
