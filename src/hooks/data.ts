import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { alive, db } from '../db/db';
import type { SettingRow } from '../db/types';

/** Live queries: components re-render whenever the underlying rows change. */

const bySort = <T extends { sort: number; name: string }>(a: T, b: T) => a.sort - b.sort || a.name.localeCompare(b.name);
const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);

export const useProducts = () => useLiveQuery(async () => alive(await db.products.toArray()).sort(bySort), []);
export const useCategories = () => useLiveQuery(async () => alive(await db.categories.toArray()).sort(bySort), []);
export const useMembers = () => useLiveQuery(async () => alive(await db.members.toArray()).sort(byName), []);
export const usePaymentMethods = () => useLiveQuery(async () => alive(await db.paymentMethods.toArray()).sort(bySort), []);
export const useEvents = () =>
  useLiveQuery(async () => alive(await db.events.toArray()).sort((a, b) => (b.startDate || '').localeCompare(a.startDate || '') || b.createdAt - a.createdAt), []);
/** undefined while loading (including right after the id changes), null if there is no such event. */
export function useEvent(id: string | null | undefined) {
  const r = useLiveQuery(async () => ({ id, ev: id ? ((await db.events.get(id)) ?? null) : null }), [id]);
  if (!r || r.id !== id) return undefined;
  return r.ev;
}
export const useEventProducts = (eventId: string | null | undefined) =>
  useLiveQuery(async () => (eventId ? alive(await db.eventProducts.where('eventId').equals(eventId).toArray()) : []), [eventId]);
export const useSales = (eventId: string | null | undefined) =>
  useLiveQuery(async () => (eventId ? alive(await db.sales.where('eventId').equals(eventId).toArray()).sort((a, b) => b.at - a.at) : []), [eventId]);
export const useSessions = (eventId: string | null | undefined) =>
  useLiveQuery(async () => (eventId ? alive(await db.sessions.where('eventId').equals(eventId).toArray()).sort((a, b) => b.openedAt - a.openedAt) : []), [eventId]);
export const useBundleRules = () => useLiveQuery(async () => alive(await db.bundleRules.toArray()), []);
export const useMaterials = () => useLiveQuery(async () => alive(await db.materials.toArray()).sort((a, b) => a.code.localeCompare(b.code) || a.name.localeCompare(b.name)), []);
export const useProductCosts = () => useLiveQuery(async () => new Map(alive(await db.productCosts.toArray()).map((c) => [c.id, c])), []);
export const useCostPoints = () => useLiveQuery(async () => alive(await db.costPoints.toArray()), []);
export const useStockMoves = () => useLiveQuery(async () => alive(await db.stockMoves.toArray()), []);
export const useBatches = () => useLiveQuery(async () => alive(await db.batches.toArray()).sort((a, b) => b.at - a.at), []);
export const useSpend = (eventId: string | null | undefined) =>
  useLiveQuery(async () => (eventId ? alive(await db.spend.where('eventId').equals(eventId).toArray()).sort((a, b) => a.createdAt - b.createdAt) : []), [eventId]);
export const useRoster = (eventId: string | null | undefined) =>
  useLiveQuery(async () => (eventId ? alive(await db.roster.where('eventId').equals(eventId).toArray()).sort((a, b) => a.createdAt - b.createdAt) : []), [eventId]);
export const useDeals = (eventId: string | null | undefined) =>
  useLiveQuery(async () => (eventId ? alive(await db.partnerDeals.where('eventId').equals(eventId).toArray()) : []), [eventId]);
export const usePayouts = (eventId?: string | null) =>
  useLiveQuery(async () => (eventId ? alive(await db.payouts.where('eventId').equals(eventId).toArray()) : alive(await db.payouts.toArray())), [eventId]);
export const useQuotes = () => useLiveQuery(async () => alive(await db.quotes.toArray()).sort((a, b) => b.createdAt - a.createdAt), []);
export const useAudit = (limit = 300) => useLiveQuery(async () => (await db.audit.orderBy('at').reverse().limit(limit).toArray()).filter((a) => a.deleted !== 1), [limit]);
export const useSettingRows = () => useLiveQuery(async () => (await db.settings.toArray()) as SettingRow[], []);
export const useLocal = <T,>(key: string, fallback: T) =>
  useLiveQuery(async () => {
    const row = await db.local.get(key);
    return row === undefined ? fallback : (row.value as T);
  }, [key]);

/** Number of records changed on this device and not uploaded yet. */
export const usePendingCount = () =>
  useLiveQuery(async () => {
    let n = 0;
    for (const t of ['sales', 'sessions', 'stockMoves', 'products', 'events', 'eventProducts', 'spend', 'payouts', 'audit'] as const) {
      n += await (db[t] as any).where('_sync').equals(1).count();
    }
    return n;
  }, []);

export function useOnline(): boolean {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}
