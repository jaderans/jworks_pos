import { alive, db } from '../db/db';
import { getSetting } from '../db/settings';
import { eventMetrics } from '../domain/summary';
import { computeShare } from '../domain/share';
import { makeCostIndex } from '../domain/cost';
import type { BusinessSettings } from '../db/types';
import type { ReportInput } from './eventReport';

/** Everything an event's reports need, read straight from the database (no screen open), for automatic summaries. */
export async function loadReportInput(eventId: string): Promise<ReportInput | null> {
  const ev = await db.events.get(eventId);
  if (!ev || ev.deleted === 1) return null;
  const [sales, sessions, products, categories, eventProducts, roster, members, deals, spend, costPoints, payouts, business] = await Promise.all([
    db.sales.where('eventId').equals(eventId).toArray().then((r) => alive(r).sort((a, b) => b.at - a.at)),
    db.sessions.where('eventId').equals(eventId).toArray().then((r) => alive(r)),
    db.products.toArray().then((r) => alive(r)),
    db.categories.toArray().then((r) => alive(r)),
    db.eventProducts.where('eventId').equals(eventId).toArray().then((r) => alive(r)),
    db.roster.where('eventId').equals(eventId).toArray().then((r) => alive(r)),
    db.members.toArray().then((r) => alive(r)),
    db.partnerDeals.where('eventId').equals(eventId).toArray().then((r) => alive(r)),
    db.spend.where('eventId').equals(eventId).toArray().then((r) => alive(r)),
    db.costPoints.toArray().then((r) => alive(r)),
    db.payouts.where('eventId').equals(eventId).toArray().then((r) => alive(r)),
    getSetting<BusinessSettings>('business'),
  ]);
  const productMap = new Map(products.map((p) => [p.id, p]));
  const memberMap = new Map(members.map((m) => [m.id, m]));
  const costOf = makeCostIndex(costPoints);
  return {
    business: business.name,
    ev,
    sales,
    sessions,
    metrics: eventMetrics(sales, categories),
    share: computeShare({ event: ev, sales, products: productMap, costOf, roster, members: memberMap, deals, eventProducts, spend }),
    products: productMap,
    eventProducts,
    roster,
    members: memberMap,
    spend,
    payouts,
    costOf,
  };
}
