import { allocate, percentOf, sum, type Cents } from '../lib/money';
import { shiftHours } from '../lib/time';
import { lineRevenue } from './cart';
import type { CostLookup } from './cost';
import type { EventProduct, JWEvent, Member, PartnerDeal, Product, RosterEntry, Sale, SpendItem } from '../db/types';

export interface ShareInput {
  event: JWEvent;
  sales: readonly Sale[];
  products: ReadonlyMap<string, Product>;
  costOf: (productId: string, at: number) => CostLookup;
  roster: readonly RosterEntry[];
  members: ReadonlyMap<string, Member>;
  deals: readonly PartnerDeal[];
  eventProducts: readonly EventProduct[];
  spend: readonly SpendItem[];
}

export interface PartnerLine {
  dealId: string;
  partnerId: string;
  partnerName: string;
  dealName: string;
  units: number;
  revenue: Cents;
  cogs: Cents;
  base: Cents;
  sellThroughPct: number | null;
  pct: number;
  amount: Cents;
}

export interface RoyaltyLine {
  memberId: string;
  name: string;
  units: number;
  revenue: Cents;
  amount: Cents;
}

export interface StaffLine {
  rosterId: string;
  memberId: string;
  name: string;
  roleLabel: string;
  weight: number;
  hours: number;
  points: number;
  amount: Cents;
  belowMin: boolean;
  topUp: Cents;
}

export interface EventCosts {
  boothFee: Cents;
  consumables: Cents;
  assets: Cents;
  /** Materials bought for this event (they go to stock; counted through production cost). */
  materialsBought: Cents;
  /** Old-sheet mode only: materials bought × % used. */
  materialsUsed: Cents;
  /** Items still marked To buy (not counted). */
  planned: Cents;
  total: Cents;
}

export interface ShareResult {
  gross: Cents;
  itemsSold: number;
  cogs: Cents;
  cogsMissing: { productId: string; name: string; qty: number }[];
  cogsBackfilled: string[];
  partners: PartnerLine[];
  partnerTotal: Cents;
  royalties: RoyaltyLine[];
  royaltyTotal: Cents;
  tradingProfit: Cents;
  costs: EventCosts;
  pool: Cents;
  joshworks: Cents;
  staffPool: Cents;
  staff: StaffLine[];
  topUpTotal: Cents;
  /** What JoshWorks keeps after top-ups and anything this mode charges to its share. */
  joshworksNet: Cents;
  warnings: string[];
}

export function rosterHours(r: RosterEntry): number {
  if (r.hoursOverride !== null && r.hoursOverride !== undefined) return Math.max(0, r.hoursOverride);
  return Math.round(sum(r.shifts.map((s) => shiftHours(s.start, s.end))) * 100) / 100;
}

export function eventCosts(spend: readonly SpendItem[], poolMode: JWEvent['share']['poolMode']): EventCosts {
  const live = spend.filter((s) => s.deleted !== 1);
  const bought = live.filter((s) => s.status === 'bought');
  const line = (s: SpendItem) => Math.round(s.qty * s.unitCost);
  const boothFee = sum(bought.filter((s) => s.type === 'booth_fee').map(line));
  const consumables = sum(bought.filter((s) => s.type === 'consumable').map(line));
  const assets = sum(bought.filter((s) => s.type === 'asset').map((s) => Math.round(line(s) / Math.max(1, s.amortizeEvents || 1))));
  const materialsBought = sum(bought.filter((s) => s.type === 'material').map(line));
  const materialsUsed = sum(bought.filter((s) => s.type === 'material').map((s) => Math.round((line(s) * Math.max(0, Math.min(100, s.pctUsed))) / 100)));
  const planned = sum(live.filter((s) => s.status === 'to_buy').map(line));
  const total = poolMode === 'supplies' ? boothFee + consumables + assets + materialsUsed : boothFee + consumables + assets;
  return { boothFee, consumables, assets, materialsBought, materialsUsed, planned, total };
}

/**
 * The profit-share waterfall:
 * gross sales − production cost − partner shares − royalties = trading profit;
 * − event costs = profit pool; pool → JoshWorks % and a staff pool split by
 * role weight × hours on duty (or the mode the event picks).
 */
export function computeShare(input: ShareInput): ShareResult {
  const { event } = input;
  const cfg = event.share;
  const warnings: string[] = [];
  const completed = input.sales.filter((s) => s.status === 'completed' && s.deleted !== 1);

  let gross = 0;
  let itemsSold = 0;
  let cogs = 0;
  const missing = new Map<string, { productId: string; name: string; qty: number }>();
  const backfilled = new Set<string>();
  const byProduct = new Map<string, { units: number; revenue: Cents; cogs: Cents }>();
  const royaltyBy = new Map<string, { units: number; revenue: Cents; amount: Cents }>();

  for (const sale of completed) {
    gross += sale.total;
    const rev = lineRevenue(sale);
    sale.lines.forEach((line, i) => {
      itemsSold += line.qty;
      const { cost, backfilled: bf } = input.costOf(line.productId, sale.at);
      let lineCogs = 0;
      if (cost === null) {
        const m = missing.get(line.productId) ?? { productId: line.productId, name: line.name, qty: 0 };
        m.qty += line.qty;
        missing.set(line.productId, m);
      } else {
        lineCogs = cost * line.qty;
        if (bf) backfilled.add(line.name);
      }
      cogs += lineCogs;
      const p = byProduct.get(line.productId) ?? { units: 0, revenue: 0, cogs: 0 };
      p.units += line.qty;
      p.revenue += rev[i];
      p.cogs += lineCogs;
      byProduct.set(line.productId, p);

      const product = input.products.get(line.productId);
      const designerId = line.designerId ?? product?.designerId ?? null;
      const royalty = product?.royalty;
      if (designerId && royalty && royalty.value > 0) {
        const amount = royalty.mode === 'percent' ? percentOf(rev[i], royalty.value) : Math.round(royalty.value) * line.qty;
        const r = royaltyBy.get(designerId) ?? { units: 0, revenue: 0, amount: 0 };
        r.units += line.qty;
        r.revenue += rev[i];
        r.amount += amount;
        royaltyBy.set(designerId, r);
      }
    });
  }

  const nameOf = (id: string) => input.members.get(id)?.name ?? 'Unknown member';

  // Partner shares
  const brought = new Map(input.eventProducts.filter((e) => e.deleted !== 1).map((e) => [e.productId, e.stockBrought]));
  const partners: PartnerLine[] = input.deals
    .filter((d) => d.deleted !== 1)
    .map((d) => {
      let units = 0;
      let revenue = 0;
      let dcogs = 0;
      let broughtTotal = 0;
      let broughtKnown = true;
      for (const pid of d.productIds) {
        const p = byProduct.get(pid);
        if (p) {
          units += p.units;
          revenue += p.revenue;
          dcogs += p.cogs;
        }
        const b = brought.get(pid);
        if (b === null || b === undefined) broughtKnown = false;
        else broughtTotal += b;
      }
      const base = Math.max(0, d.basis === 'net' ? revenue - dcogs : revenue);
      const sellThroughPct = broughtKnown && broughtTotal > 0 ? (units / broughtTotal) * 100 : null;
      let pct = d.fixedPct;
      if (d.mode === 'tiered') {
        const tiers = [...d.tiers].sort((a, b) => a.minPct - b.minPct);
        if (sellThroughPct === null) {
          pct = tiers[0]?.partnerPct ?? 0;
          warnings.push(`${d.name}: stock brought is missing, so the lowest tier was used.`);
        } else {
          pct = tiers.filter((t) => t.minPct <= sellThroughPct + 1e-9).pop()?.partnerPct ?? tiers[0]?.partnerPct ?? 0;
        }
      }
      return {
        dealId: d.id,
        partnerId: d.partnerId,
        partnerName: nameOf(d.partnerId),
        dealName: d.name,
        units,
        revenue,
        cogs: dcogs,
        base,
        sellThroughPct,
        pct,
        amount: percentOf(base, pct),
      };
    });
  const partnerTotal = sum(partners.map((p) => p.amount));

  const royalties: RoyaltyLine[] = [...royaltyBy.entries()].map(([memberId, r]) => ({ memberId, name: nameOf(memberId), ...r }));
  const royaltyTotal = sum(royalties.map((r) => r.amount));

  const costs = eventCosts(input.spend, cfg.poolMode);
  // In old-sheet mode the materials used stand in for production cost.
  const productionCost = cfg.poolMode === 'supplies' ? costs.materialsUsed : cogs;
  const beforePool = cfg.royaltiesBeforePool ? partnerTotal + royaltyTotal : 0;
  const tradingProfit = gross - productionCost - beforePool;

  let pool: Cents;
  let chargedToJoshworks = cfg.royaltiesBeforePool ? 0 : partnerTotal + royaltyTotal;
  if (cfg.poolMode === 'all') {
    pool = gross - cogs - beforePool - costs.total;
  } else if (cfg.poolMode === 'cogs') {
    pool = gross - cogs - beforePool;
    chargedToJoshworks += costs.total;
  } else {
    // Old sheet: sales − materials used; booth costs are JoshWorks' own.
    pool = gross - costs.materialsUsed - beforePool;
    chargedToJoshworks += costs.boothFee + costs.consumables + costs.assets;
  }

  const inPool = input.roster.filter((r) => r.deleted !== 1 && r.inPool === 1);
  const staffPct = Math.max(0, Math.min(100, 100 - cfg.joshworksPct));
  // With nobody on the roster there is no one to pay, so JoshWorks holds the whole pool for now.
  const staffPool = pool > 0 && inPool.length > 0 ? percentOf(pool, staffPct) : 0;
  const joshworks = pool - staffPool;
  const hours = inPool.map(rosterHours);
  let mode = cfg.weightMode;
  if (mode === 'weighthours' && inPool.length > 0 && hours.every((h) => h <= 0)) {
    mode = 'weight';
    warnings.push('No hours entered on the roster yet, so the staff pool is split by role weight only.');
  }
  const points = inPool.map((r, i) => (mode === 'equal' ? 1 : mode === 'weight' ? Math.max(0, r.weight) : Math.max(0, r.weight) * hours[i]));
  const amounts = allocate(staffPool, points);
  const min = cfg.minGuarantee;
  const staff: StaffLine[] = inPool.map((r, i) => {
    const belowMin = min !== null && min > 0 && amounts[i] < min;
    const topUp = belowMin && cfg.topUp && min !== null ? min - amounts[i] : 0;
    return {
      rosterId: r.id,
      memberId: r.memberId,
      name: nameOf(r.memberId),
      roleLabel: r.roleLabel,
      weight: r.weight,
      hours: hours[i],
      points: Math.round(points[i] * 100) / 100,
      amount: amounts[i] + topUp,
      belowMin,
      topUp,
    };
  });
  const topUpTotal = sum(staff.map((s) => s.topUp));

  if (missing.size > 0) warnings.push(`${missing.size} product${missing.size === 1 ? '' : 's'} sold without a production cost, so profit is overstated.`);
  if (pool < 0) warnings.push('The pool is negative: costs are higher than what the sales earned, so the staff pool is zero.');
  if (inPool.length === 0 && pool > 0) warnings.push('Nobody is on the roster yet, so JoshWorks holds the whole pool. Add the team in Team & payouts to split it.');

  return {
    gross,
    itemsSold,
    cogs,
    cogsMissing: [...missing.values()],
    cogsBackfilled: [...backfilled],
    partners,
    partnerTotal,
    royalties,
    royaltyTotal,
    tradingProfit,
    costs,
    pool,
    joshworks,
    staffPool,
    staff,
    topUpTotal,
    joshworksNet: joshworks - topUpTotal - chargedToJoshworks,
    warnings,
  };
}
