import { alive, db } from '../db/db';
import { build, save } from '../db/write';
import { loadReportInput } from '../reports/loadReport';
import { STUDIO_FEED_ID, buildEventFeed, buildOrderFeed, studioFile } from '../domain/studioFeed';
import { depositsHeld } from '../domain/orders';
import { downloadBlob, safeFileName } from '../lib/files';
import type { Sale, StudioEventFeed, StudioFeed, StudioFeedRow, StudioOrderFeed } from '../db/types';

/**
 * "Send to Studio": the POS writes a summary row that JoshWorks Studio picks up
 * on this device (same site, same browser) or from a downloaded file.
 */

/** An event's summary, worked out now. */
export async function eventFeed(eventId: string): Promise<StudioEventFeed | null> {
  const input = await loadReportInput(eventId);
  if (!input) return null;
  // Pickups draw on deposits that may have been taken at an earlier event.
  const orderIds = [...new Set(input.sales.filter((s) => s.payments.some((p) => p.kind === 'deposit') && s.orderId).map((s) => s.orderId as string))];
  const depositSales: Sale[] = orderIds.length ? alive(await db.sales.where('orderId').anyOf(orderIds).toArray()) : [];
  const orders = alive(await db.orders.where('eventId').equals(eventId).toArray());
  const orderSales = orders.length ? alive(await db.sales.where('orderId').anyOf(orders.map((o) => o.id)).toArray()) : [];
  return buildEventFeed(input, depositSales, depositsHeld(orders, orderSales));
}

export async function orderFeed(orderId: string): Promise<StudioOrderFeed | null> {
  const order = await db.orders.get(orderId);
  if (!order || order.deleted === 1) return null;
  const [ev, customer, designer, sales] = await Promise.all([
    db.events.get(order.eventId),
    order.customerId ? db.customers.get(order.customerId) : undefined,
    order.designerId ? db.members.get(order.designerId) : undefined,
    db.sales.where('orderId').equals(orderId).toArray(),
  ]);
  return buildOrderFeed({ order, eventName: ev?.name ?? '', customer: customer?.deleted === 1 ? undefined : customer, designer, sales: alive(sales) });
}

async function put(id: string, feed: StudioFeed, by: string): Promise<StudioFeedRow> {
  const prev = await db.studioFeed.get(id);
  return save(db.studioFeed, { ...(prev ?? build<StudioFeedRow>({ id, feed, sentBy: by })), feed, sentBy: by, deleted: 0 });
}

export async function sendEventToStudio(eventId: string, by: string): Promise<StudioFeedRow> {
  const feed = await eventFeed(eventId);
  if (!feed) throw new Error('That event no longer exists.');
  return put(STUDIO_FEED_ID.event(eventId), feed, by);
}

export async function sendOrderToStudio(orderId: string, by: string): Promise<StudioFeedRow> {
  const feed = await orderFeed(orderId);
  if (!feed) throw new Error('That order no longer exists.');
  return put(STUDIO_FEED_ID.order(orderId), feed, by);
}

/** Everything sent so far, as one file for Studio on another device. */
export async function downloadStudioFile(name: string): Promise<number> {
  const rows = alive(await db.studioFeed.toArray());
  const file = studioFile(rows.map((r) => r.feed));
  downloadBlob(new Blob([JSON.stringify(file, null, 1)], { type: 'application/json' }), `${safeFileName(name)} - for JoshWorks Studio.json`);
  return rows.length;
}
