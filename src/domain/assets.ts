import type { Cents } from '../lib/money';
import type { JWEvent, SpendItem } from '../db/types';

/**
 * Reusable assets (stands, grids, fences, hooks) are bought once and paid off
 * over several events. An asset is recorded on the event it was bought for;
 * that event and the next ones in date order each carry an equal share until
 * it is paid off. The last share takes the rounding, so the shares add up to
 * the price exactly.
 */

export interface AssetCharge {
  item: SpendItem;
  /** The event it was bought for. */
  boughtFor: string;
  boughtForName: string;
  /** This event's place in the run: 1 = the event it was bought for. */
  index: number;
  of: number;
  /** This event's share. */
  amount: Cents;
  /** Charged so far, this event included. */
  paidOff: Cents;
  /** What it cost. */
  total: Cents;
  /** Bought for an earlier event. */
  carried: boolean;
}

const lineTotal = (s: Pick<SpendItem, 'qty' | 'unitCost'>): Cents => Math.round(s.qty * s.unitCost);

/** Events oldest first: by start date, then when they were made. */
export function eventsInOrder<T extends Pick<JWEvent, 'id' | 'startDate' | 'createdAt' | 'deleted'>>(events: readonly T[]): T[] {
  return events.filter((e) => e.deleted !== 1).sort((a, b) => (a.startDate || '9999').localeCompare(b.startDate || '9999') || a.createdAt - b.createdAt);
}

/** Each event's share of an asset: equal parts, the last one takes the rounding. */
export function assetShare(total: Cents, of: number, index: number): Cents {
  const n = Math.max(1, Math.round(of) || 1);
  const each = Math.round(total / n);
  return index < n ? each : total - each * (n - 1);
}

/** The reusable assets an event pays toward: its own, and those bought for earlier events still being paid off. */
export function assetCharges(eventId: string, events: readonly Pick<JWEvent, 'id' | 'name' | 'startDate' | 'createdAt' | 'deleted'>[], spend: readonly SpendItem[]): AssetCharge[] {
  const order = eventsInOrder(events);
  const at = order.findIndex((e) => e.id === eventId);
  if (at < 0) return [];
  const out: AssetCharge[] = [];
  for (const item of spend) {
    if (item.deleted === 1 || item.type !== 'asset' || item.status !== 'bought') continue;
    const home = order.findIndex((e) => e.id === item.eventId);
    const of = Math.max(1, Math.round(item.amortizeEvents) || 1);
    const index = at - home + 1;
    if (home < 0 || index < 1 || index > of) continue;
    const total = lineTotal(item);
    const amount = assetShare(total, of, index);
    out.push({
      item,
      boughtFor: item.eventId,
      boughtForName: order[home].name,
      index,
      of,
      amount,
      paidOff: index < of ? Math.round(total / of) * index : total,
      total,
      carried: index > 1,
    });
  }
  return out.sort((a, b) => Number(a.carried) - Number(b.carried) || a.item.createdAt - b.item.createdAt);
}

/** "Event 2 of 6 · ₱104 of ₱312 paid off", or "Paid off" on its last event. */
export function payoffText(c: Pick<AssetCharge, 'index' | 'of' | 'paidOff' | 'total'>, peso: (n: Cents) => string): string {
  if (c.paidOff >= c.total) return c.of > 1 ? `Event ${c.index} of ${c.of} · paid off` : 'Paid off';
  return `Event ${c.index} of ${c.of} · ${peso(c.paidOff)} of ${peso(c.total)} paid off`;
}
