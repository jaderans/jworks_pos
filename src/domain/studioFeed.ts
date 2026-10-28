import { sum, type Cents } from '../lib/money';
import { isoDate } from '../lib/time';
import { isRevenueSale, orderTotal } from './orders';
import type { ReportInput } from '../reports/eventReport';
import type { Customer, Member, Order, Payout, Sale, StudioEventFeed, StudioFeed, StudioFeedMethod, StudioFeedPerson, StudioOrderFeed, StudioOrderPayment } from '../db/types';

/**
 * The summaries JoshWorks Studio imports: an event's money as the event report
 * works it out (so the numbers match it to the centavo), and commission orders
 * as Studio jobs.
 */

export const STUDIO_FEED_ID = {
  event: (eventId: string) => `event:${eventId}`,
  order: (orderId: string) => `order:${orderId}`,
};

const kindOf = (k: string): StudioFeedMethod['kind'] => (k === 'cash' || k === 'ewallet' || k === 'bank' || k === 'card' ? k : 'other');

/**
 * Sales by payment method, adding up to the sales total. A pickup's "order
 * deposit" part is traced back to how the deposit was paid; whatever can't be
 * traced shows as "Order deposit".
 */
export function revenueByMethod(sales: readonly Sale[], depositSales: readonly Sale[]): StudioFeedMethod[] {
  const out = new Map<string, StudioFeedMethod>();
  const add = (methodId: string, name: string, kind: string, amount: Cents) => {
    if (!amount) return;
    const m = out.get(methodId) ?? { methodId, name, kind: kindOf(kind), amount: 0 };
    m.amount += amount;
    out.set(methodId, m);
  };
  // What each order's deposits were paid with, used up as pickups draw on them.
  const pools = new Map<string, { methodId: string; name: string; kind: string; left: Cents }[]>();
  for (const d of depositSales) {
    if (d.kind !== 'deposit' || d.status !== 'completed' || d.deleted === 1 || !d.orderId) continue;
    const pool = pools.get(d.orderId) ?? [];
    for (const p of d.payments) if (p.kind !== 'deposit') pool.push({ methodId: p.methodId, name: p.name, kind: p.kind, left: p.amount });
    pools.set(d.orderId, pool);
  }
  for (const s of sales) {
    if (!isRevenueSale(s)) continue;
    for (const p of s.payments) {
      if (p.kind !== 'deposit') {
        add(p.methodId, p.name, p.kind, p.amount);
        continue;
      }
      let need = p.amount;
      for (const src of pools.get(s.orderId ?? '') ?? []) {
        const take = Math.min(src.left, need);
        if (take <= 0) continue;
        add(src.methodId, src.name, src.kind, take);
        src.left -= take;
        need -= take;
      }
      add('deposit', 'Order deposit', 'other', need);
    }
  }
  return [...out.values()].filter((m) => m.amount !== 0).sort((a, b) => b.amount - a.amount);
}

function paidPart(payouts: readonly Payout[], memberId: string, kind: Payout['kind']) {
  const paid = payouts.filter((p) => p.deleted !== 1 && p.memberId === memberId && p.kind === kind && p.status === 'paid');
  return {
    paid: sum(paid.map((p) => p.amount)),
    paidAt: paid.length ? Math.max(...paid.map((p) => p.paidAt ?? 0)) || null : null,
    method: paid.find((p) => p.method)?.method ?? '',
  };
}

/** Everyone the event pays, one line per person and kind (two shifts make one line). */
export function feedPeople(i: Pick<ReportInput, 'share' | 'members' | 'payouts'>): StudioFeedPerson[] {
  const lines = new Map<string, StudioFeedPerson>();
  const add = (memberId: string, name: string, kind: StudioFeedPerson['kind'], role: string, amount: Cents) => {
    const key = `${kind}:${memberId}`;
    const cur = lines.get(key);
    if (cur) {
      cur.amount += amount;
      return;
    }
    const m: Member | undefined = i.members.get(memberId);
    lines.set(key, { memberId, name: m?.name ?? name, email: m?.email ?? '', kind, role, amount, ...paidPart(i.payouts, memberId, kind) });
  };
  for (const s of i.share.staff) add(s.memberId, s.name, 'staff', s.roleLabel, s.amount);
  for (const r of i.share.royalties) add(r.memberId, r.name, 'royalty', 'Design royalty', r.amount);
  for (const p of i.share.partners) add(p.partnerId, p.partnerName, 'partner', p.dealName, p.amount);
  return [...lines.values()].filter((p) => p.amount > 0 || p.paid > 0);
}

export function buildEventFeed(i: ReportInput, depositSales: readonly Sale[], depositsHeld: Cents): StudioEventFeed {
  const { ev, share, metrics } = i;
  return {
    type: 'event',
    v: 1,
    eventId: ev.id,
    name: ev.name,
    venue: ev.venue,
    startDate: ev.startDate,
    endDate: ev.endDate || ev.startDate,
    status: ev.status,
    business: i.business,
    gross: metrics.gross,
    transactions: metrics.transactions,
    itemsSold: metrics.itemsSold,
    discounts: metrics.discounts,
    methods: revenueByMethod(i.sales, depositSales),
    cogs: share.cogs,
    cogsMissing: share.cogsMissing.length,
    boothFee: share.costs.boothFee,
    supplies: share.costs.consumables + share.costs.assets,
    people: feedPeople(i),
    tradingProfit: share.tradingProfit,
    joshworksNet: share.joshworksNet,
    depositsHeld,
  };
}

/** A commission order for Studio: the customer, who makes it, the price, and every payment toward it. */
export function buildOrderFeed(o: {
  order: Order;
  eventName: string;
  customer: Customer | undefined;
  designer: Member | undefined;
  sales: readonly Sale[];
}): StudioOrderFeed {
  const { order } = o;
  const payments: StudioOrderPayment[] = [];
  const paidSales = o.sales
    .filter((s) => s.orderId === order.id && s.status === 'completed' && s.deleted !== 1)
    .sort((a, b) => a.at - b.at);
  for (const s of paidSales) {
    const stage = s.id === order.pickupSaleId ? 'pickup' : 'deposit';
    for (const p of s.payments) {
      if (p.kind === 'deposit' || !p.amount) continue;
      payments.push({ saleId: s.id, date: isoDate(s.at), name: p.name, kind: kindOf(p.kind), amount: p.amount, stage });
    }
  }
  const c = o.customer;
  return {
    type: 'order',
    v: 1,
    orderId: order.id,
    number: order.number,
    eventId: order.eventId,
    eventName: o.eventName,
    customer: { name: c?.name || order.customerName, email: c?.email ?? '', phone: c?.phone || order.contact, handle: c?.handle ?? '' },
    designer: o.designer ? { memberId: o.designer.id, name: o.designer.name, email: o.designer.email } : null,
    lines: order.lines.map((l) => ({ name: l.name, qty: l.qty, unitPrice: l.unitPrice })),
    total: orderTotal(order),
    dueAt: order.dueAt,
    status: order.status,
    createdAt: order.createdAt,
    payments,
    notes: order.notes,
  };
}

/** Same numbers? Used to say "changed since you sent it". */
export const sameFeed = (a: StudioFeed | undefined, b: StudioFeed | undefined) => !!a && !!b && JSON.stringify(a) === JSON.stringify(b);

/** The file another device's Studio opens. */
export interface StudioFile {
  app: 'jworks-pos';
  kind: 'studio-feed';
  v: 1;
  exportedAt: number;
  feeds: StudioFeed[];
}

export const studioFile = (feeds: StudioFeed[], at = Date.now()): StudioFile => ({ app: 'jworks-pos', kind: 'studio-feed', v: 1, exportedAt: at, feeds });
