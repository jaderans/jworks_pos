import { liveQuery, type Subscription } from 'dexie';
import { alive, db } from '../db/db';
import { build, save } from '../db/write';
import { getLocal } from '../db/local';
import { STUDIO_FEED_ID, buildOrderFeed, buildStickFeed, sameFeed } from '../domain/studioFeed';
import { eventFeed } from './studio';
import type { Customer, Member, Order, Sale, StudioFeed, StudioFeedRow } from '../db/types';

/**
 * JoshWorks Studio's live feed, kept by the owner's device: commission and
 * Couple-of-Stickers orders go in as soon as they're made and stay up to
 * date; a running event's summary is worked out again a little after each
 * change (and an event Studio already has keeps up with late fixes). With
 * cloud sync on, Studio signed in as the same owner sees them live and the
 * owner taps Add or Update there. Only rows that changed are written.
 */

/** Finished orders older than this stay out, unless Studio already has them. */
const RECENT_MS = 90 * 86_400_000;
/** An event's summary waits this long after the last change (a busy register changes it every minute). */
const EVENT_WAIT_MS = 15_000;

let orderSub: Subscription | null = null;
let eventSub: Subscription | null = null;
let eventTimer = 0;

/** Only the owner's device writes the feed: the others don't have the costs, and can't send it to the cloud. */
async function ownerHere(): Promise<boolean> {
  const id = await getLocal<string | null>('currentMemberId', null);
  const m = id ? await db.members.get(id) : undefined;
  return !!m && m.deleted !== 1 && m.appRole === 'owner';
}

async function put(id: string, prev: StudioFeedRow | undefined, feed: StudioFeed, by: string): Promise<void> {
  if (prev && prev.deleted !== 1 && sameFeed(prev.feed, feed)) return;
  await save(db.studioFeed, { ...(prev ?? build<StudioFeedRow>({ id, feed, sentBy: by })), feed, sentBy: prev?.sentBy || by, deleted: 0 });
}

interface OrderSnap {
  owner: boolean;
  orders: Order[];
  rows: Map<string, StudioFeedRow>;
  sales: Map<string, Sale[]>;
  events: Map<string, string>;
  members: Map<string, Member>;
  customers: Map<string, Customer>;
}

async function refreshOrders(d: OrderSnap): Promise<void> {
  if (!d.owner) return;
  const now = Date.now();
  for (const o of d.orders) {
    const id = o.stick ? STUDIO_FEED_ID.stick(o.id) : STUDIO_FEED_ID.order(o.id);
    const prev = d.rows.get(id);
    if (o.deleted === 1) {
      // Gone from the POS: a tombstone, so Studio can offer to remove the job it made.
      if (prev && prev.deleted !== 1) await save(db.studioFeed, { ...prev, deleted: 1 });
      continue;
    }
    const finished = o.status === 'picked-up' || o.status === 'cancelled';
    if (!prev && finished && now - o.updatedAt > RECENT_MS) continue;
    const eventName = d.events.get(o.eventId) ?? '';
    const customer = o.customerId ? d.customers.get(o.customerId) : undefined;
    const maker = o.designerId ? d.members.get(o.designerId) : undefined;
    const feed: StudioFeed = o.stick
      ? buildStickFeed({ order: o, eventName, customer, maker })
      : buildOrderFeed({ order: o, eventName, customer, designer: maker, sales: d.sales.get(o.id) ?? [] });
    await put(id, prev, feed, o.stick ? 'Couple-of-Stickers' : 'Orders');
  }
}

/** Running events, and any event Studio already has, worked out again. */
async function refreshEvents(): Promise<void> {
  if (!(await ownerHere())) return;
  const [events, rows] = await Promise.all([db.events.toArray(), db.studioFeed.where('id').startsWith('event:').toArray()]);
  const sent = new Map(rows.map((r) => [r.id, r]));
  for (const ev of alive(events)) {
    const id = STUDIO_FEED_ID.event(ev.id);
    const prev = sent.get(id);
    if (ev.status !== 'live' && !(prev && prev.deleted !== 1)) continue;
    const feed = await eventFeed(ev.id).catch(() => null);
    if (feed) await put(id, prev, feed, 'Live');
  }
}

function soon(): void {
  window.clearTimeout(eventTimer);
  eventTimer = window.setTimeout(() => void refreshEvents().catch(() => undefined), EVENT_WAIT_MS);
}

export function startLiveFeed(): void {
  if (orderSub) return;
  orderSub = liveQuery(async (): Promise<OrderSnap> => {
    const [owner, orders, rows, events, members, customers] = await Promise.all([
      ownerHere(),
      db.orders.toArray(),
      db.studioFeed.where('id').startsWith('order:').toArray(),
      db.events.toArray(),
      db.members.toArray(),
      db.customers.toArray(),
    ]);
    const stickRows = await db.studioFeed.where('id').startsWith('stick:').toArray();
    const ids = orders.filter((o) => !o.stick && o.deleted !== 1).map((o) => o.id);
    const paid = ids.length ? alive(await db.sales.where('orderId').anyOf(ids).toArray()) : [];
    const sales = new Map<string, Sale[]>();
    for (const s of paid) sales.set(s.orderId!, [...(sales.get(s.orderId!) ?? []), s]);
    return {
      owner,
      orders,
      rows: new Map([...rows, ...stickRows].map((r) => [r.id, r])),
      sales,
      events: new Map(events.map((e) => [e.id, e.name])),
      members: new Map(alive(members).map((m) => [m.id, m])),
      customers: new Map(alive(customers).map((c) => [c.id, c])),
    };
  }).subscribe({ next: (d) => void refreshOrders(d).catch(() => undefined), error: () => undefined });
  // Anything an event's summary is made of: the newest change in each, so any new write wakes it.
  eventSub = liveQuery(async () => {
    const last = await Promise.all([db.sales, db.payouts, db.spend, db.roster, db.partnerDeals, db.events].map((t) => t.orderBy('updatedAt').last()));
    return last.map((x) => x?.updatedAt ?? 0).join('|');
  }).subscribe({ next: soon, error: () => undefined });
}

export function stopLiveFeed(): void {
  orderSub?.unsubscribe();
  eventSub?.unsubscribe();
  orderSub = eventSub = null;
  window.clearTimeout(eventTimer);
}
