import { sum, type Cents } from '../lib/money';
import { isRevenueSale } from './orders';
import type { EventTask, TaskSection } from '../db/types';
import type { ReportInput } from '../reports/eventReport';

/** Event planning: the checklist and packing list, and how past events compare. */

export const SECTION_LABEL: Record<TaskSection, string> = {
  before: 'Before the event',
  pack: 'Pack',
  day: 'On the day',
  after: 'After',
};
export const SECTIONS: readonly TaskSection[] = ['before', 'pack', 'day', 'after'];

/** The JoshWorks booth starter list. Every new event gets it; edit it per event. */
export const STARTER_TASKS: readonly { section: TaskSection; text: string; qty?: number }[] = [
  { section: 'before', text: 'Pay the booth fee and keep the receipt' },
  { section: 'before', text: 'Set this event’s prices (Edit prices)' },
  { section: 'before', text: 'Count the stock you’re bringing (Stock)' },
  { section: 'before', text: 'Print or restock what’s running low (Production)' },
  { section: 'before', text: 'Add the team on duty and their shifts' },
  { section: 'before', text: 'Post the booth number and date on socials' },
  { section: 'before', text: 'Charge phones and power banks; load the GCash and Maribank QR' },
  { section: 'before', text: 'Get the cash float in small bills and coins' },
  { section: 'pack', text: 'Table cloth' },
  { section: 'pack', text: 'Display stands and acrylics' },
  { section: 'pack', text: 'Tarpaulin / banner' },
  { section: 'pack', text: 'Price tags, QR stand and signage' },
  { section: 'pack', text: 'Stickers, pins and merch (see Stock to bring)' },
  { section: 'pack', text: 'Paper bags and sleeves' },
  { section: 'pack', text: 'Business cards' },
  { section: 'pack', text: 'Cash box and coins' },
  { section: 'pack', text: 'Extension cord' },
  { section: 'pack', text: 'Tape, scissors, pens, cutter' },
  { section: 'pack', text: 'Phone stand and power banks' },
  { section: 'day', text: 'Open the register with the float' },
  { section: 'day', text: 'Post a “we’re here” story with the booth photo' },
  { section: 'day', text: 'Restock the table after the lunch rush' },
  { section: 'day', text: 'Take photos and short videos of the booth' },
  { section: 'after', text: 'Close the register and count the drawer' },
  { section: 'after', text: 'Merge the second phone’s sales' },
  { section: 'after', text: 'Save payouts and mark them paid' },
  { section: 'after', text: 'Send the summary and report to the team' },
  { section: 'after', text: 'Post a thank-you and tag the organizer' },
  { section: 'after', text: 'Mark the event as reported' },
];

export interface Readiness {
  done: number;
  total: number;
  pct: number;
  bySection: Record<TaskSection, { done: number; total: number }>;
}

export function readiness(tasks: readonly EventTask[]): Readiness {
  const live = tasks.filter((t) => t.deleted !== 1);
  const bySection = Object.fromEntries(SECTIONS.map((s) => [s, { done: 0, total: 0 }])) as Readiness['bySection'];
  for (const t of live) {
    bySection[t.section].total++;
    if (t.done) bySection[t.section].done++;
  }
  const done = live.filter((t) => t.done).length;
  return { done, total: live.length, pct: live.length ? Math.round((done / live.length) * 100) : 0, bySection };
}

/** Total time with at least one register open; two phones open at once count once. */
export function openHours(intervals: readonly [number, number][]): number {
  const sorted = intervals.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  let total = 0;
  let cur: [number, number] | null = null;
  for (const [a, b] of sorted) {
    if (!cur || a > cur[1]) {
      if (cur) total += cur[1] - cur[0];
      cur = [a, b];
    } else cur[1] = Math.max(cur[1], b);
  }
  if (cur) total += cur[1] - cur[0];
  return Math.round((total / 3_600_000) * 10) / 10;
}

export interface EventComparison {
  eventId: string;
  name: string;
  startDate: string;
  gross: Cents;
  transactions: number;
  avgSale: Cents;
  items: number;
  hours: number | null;
  perHour: Cents | null;
  boothFee: Cents;
  /** Sales for every peso of booth fee. */
  perBoothPeso: number | null;
  tradingProfit: Cents;
  /** After booth fee and other event costs. */
  eventResult: Cents;
  cashPct: number | null;
  sellThrough: number | null;
  discounts: Cents;
  top: { name: string; qty: number; revenue: Cents }[];
}

export function compareEvent(i: ReportInput): EventComparison {
  const sales = i.sales.filter(isRevenueSale);
  const intervals = i.sessions.map((s) => {
    const mine = i.sales.filter((x) => x.sessionId === s.id);
    const end = s.closedAt ?? Math.max(s.openedAt, ...mine.map((x) => x.at));
    return [s.openedAt, end] as [number, number];
  });
  const hours = intervals.length ? openHours(intervals) : null;
  const gross = i.metrics.gross;
  const boothFee = i.share.costs.boothFee;
  const cash = sum(i.metrics.byMethod.filter((m) => m.kind === 'cash').map((m) => m.amount));
  const money = sum(i.metrics.byMethod.map((m) => m.amount));
  const brought = i.eventProducts.filter((e) => e.deleted !== 1 && e.stockBrought !== null && e.stockBrought > 0);
  const broughtTotal = sum(brought.map((e) => e.stockBrought ?? 0));
  const soldOfBrought = sum(brought.map((e) => Math.min(e.stockBrought ?? 0, i.metrics.byProduct.find((p) => p.productId === e.productId)?.qty ?? 0)));
  return {
    eventId: i.ev.id,
    name: i.ev.name,
    startDate: i.ev.startDate,
    gross,
    transactions: sales.length,
    avgSale: i.metrics.avgSale,
    items: i.metrics.itemsSold,
    hours,
    perHour: hours ? Math.round(gross / hours) : null,
    boothFee,
    perBoothPeso: boothFee > 0 ? Math.round((gross / boothFee) * 10) / 10 : null,
    tradingProfit: i.share.tradingProfit,
    eventResult: i.share.pool,
    cashPct: money > 0 ? Math.round((cash / money) * 100) : null,
    sellThrough: broughtTotal > 0 ? Math.round((soldOfBrought / broughtTotal) * 100) : null,
    discounts: i.metrics.discounts,
    top: i.metrics.byProduct.slice(0, 3).map((p) => ({ name: p.name, qty: p.qty, revenue: p.revenue })),
  };
}
