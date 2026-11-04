import { liveQuery, type Subscription } from 'dexie';
import { alive, db } from '../db/db';
import { build, save } from '../db/write';
import { getSetting } from '../db/settings';
import { STUDIO_FEED_ID, buildPrintFeed, sameFeed } from '../domain/studioFeed';
import type { Customer, Member, PrintOrder, PrintRates, StudioFeedRow } from '../db/types';

/**
 * Print orders reach JoshWorks Studio by themselves: whenever one changes, its
 * summary row is brought up to date, so Studio → Money → Booth events (or the
 * Studio file) always has the latest. Only rows that changed are written.
 */

let sub: Subscription | null = null;

interface Snapshot {
  orders: PrintOrder[];
  rows: StudioFeedRow[];
  members: Map<string, Member>;
  customers: Map<string, Customer>;
  rates: PrintRates;
}

async function refresh(d: Snapshot) {
  const rows = new Map(d.rows.map((r) => [r.id, r]));
  for (const o of d.orders) {
    const id = STUDIO_FEED_ID.print(o.id);
    const prev = rows.get(id);
    if (o.deleted === 1) {
      if (prev && prev.deleted !== 1) await save(db.studioFeed, { ...prev, deleted: 1 });
      continue;
    }
    const feed = buildPrintFeed({
      order: o,
      downPct: d.rates.downPct,
      customer: o.customerId ? d.customers.get(o.customerId) : undefined,
      printer: o.printerId ? d.members.get(o.printerId) : undefined,
    });
    if (prev && prev.deleted !== 1 && sameFeed(prev.feed, feed)) continue;
    await save(db.studioFeed, { ...(prev ?? build<StudioFeedRow>({ id, feed, sentBy: '' })), feed, sentBy: 'Print orders', deleted: 0 });
  }
}

export function startPrintFeed(): void {
  if (sub) return;
  sub = liveQuery(async (): Promise<Snapshot> => {
    const [orders, rows, members, customers, rates] = await Promise.all([
      db.printOrders.toArray(),
      db.studioFeed.where('id').startsWith('print:').toArray(),
      db.members.toArray(),
      db.customers.toArray(),
      getSetting<PrintRates>('printRates'),
    ]);
    return { orders, rows, members: new Map(alive(members).map((m) => [m.id, m])), customers: new Map(alive(customers).map((c) => [c.id, c])), rates };
  }).subscribe({ next: (d) => void refresh(d), error: () => undefined });
}

export function stopPrintFeed(): void {
  sub?.unsubscribe();
  sub = null;
}
