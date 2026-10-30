import { useMemo } from 'react';
import {
  useAssetSpend, useCategories, useCostPoints, useDeals, useEventProducts, useEvents, useMembers, useProducts, useRoster, useSales, useSessions, useSpend,
} from '../../hooks/data';
import { eventMetrics } from '../../domain/summary';
import { computeShare } from '../../domain/share';
import { makeCostIndex } from '../../domain/cost';
import { assetCharges } from '../../domain/assets';
import type { JWEvent } from '../../db/types';

/** Everything an event's screens and reports need, computed once. */
export function useEventData(ev: JWEvent) {
  const sales = useSales(ev.id);
  const sessions = useSessions(ev.id);
  const products = useProducts();
  const categories = useCategories();
  const eventProducts = useEventProducts(ev.id);
  const roster = useRoster(ev.id);
  const members = useMembers();
  const deals = useDeals(ev.id);
  const spend = useSpend(ev.id);
  const costPoints = useCostPoints();
  const events = useEvents();
  const assetSpend = useAssetSpend();

  const loading = !sales || !sessions || !products || !categories || !eventProducts || !roster || !members || !deals || !spend || !costPoints || !events || !assetSpend;

  const productMap = useMemo(() => new Map((products ?? []).map((p) => [p.id, p])), [products]);
  const memberMap = useMemo(() => new Map((members ?? []).map((m) => [m.id, m])), [members]);
  const metrics = useMemo(() => eventMetrics(sales ?? [], categories ?? []), [sales, categories]);
  const costOf = useMemo(() => makeCostIndex(costPoints ?? []), [costPoints]);
  // Its own reusable assets and those bought for earlier events still being paid off.
  const charges = useMemo(() => assetCharges(ev.id, events ?? [], assetSpend ?? []), [ev.id, events, assetSpend]);
  const share = useMemo(
    () =>
      computeShare({
        event: ev,
        sales: sales ?? [],
        products: productMap,
        costOf,
        roster: roster ?? [],
        members: memberMap,
        deals: deals ?? [],
        eventProducts: eventProducts ?? [],
        spend: spend ?? [],
        assetCharges: charges,
      }),
    [ev, sales, productMap, costOf, roster, memberMap, deals, eventProducts, spend, charges],
  );

  return {
    loading,
    sales: sales ?? [],
    sessions: sessions ?? [],
    products: products ?? [],
    productMap,
    categories: categories ?? [],
    eventProducts: eventProducts ?? [],
    roster: roster ?? [],
    members: members ?? [],
    memberMap,
    deals: deals ?? [],
    spend: spend ?? [],
    assetCharges: charges,
    metrics,
    share,
    costOf,
  };
}

export type EventData = ReturnType<typeof useEventData>;
