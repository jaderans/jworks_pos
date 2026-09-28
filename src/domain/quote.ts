import { roundUpTo, sum, type Cents } from '../lib/money';

/**
 * Service quotes (logo, branding, shirt design, tarpaulin, layout...),
 * ported from the old CALCULATOR tab.
 */

export interface MaterialLine {
  name: string;
  qtyPerPc: number;
  unitCost: number;
}
export interface OutsourcedLine {
  desc: string;
  qty: number;
  unitCost: Cents;
  supplier: string;
}
export interface LaborLine {
  role: string;
  hours: number;
  rate: Cents;
}
export interface OtherLine {
  desc: string;
  amount: Cents;
}

export type PricingMethod = 'markup' | 'margin' | 'manual';

export interface ServiceQuoteInput {
  qty: number;
  materials: MaterialLine[];
  outsourced: OutsourcedLine[];
  labor: LaborLine[];
  other: OtherLine[];
  overheadPct: number;
  method: PricingMethod;
  markupPct: number;
  marginPct: number;
  manualPrice: Cents | null;
  roundTo: number;
  addons: { rush: boolean; revision: number; sourceFiles: boolean; ipBuyout: boolean };
  addonPcts: { rush: number; revision: number; sourceFiles: number; ipBuyout: number };
  vatRegistered: boolean;
  vatPct: number;
  ewt: boolean;
  ewtPct: number;
  minMarginPct: number;
}

export interface ServiceQuoteResult {
  materials: number;
  outsourced: number;
  labor: number;
  other: number;
  direct: number;
  overhead: number;
  totalCost: number;
  costPerPc: number;
  pricePerPc: Cents;
  totalPrice: Cents;
  profitPerPc: number;
  profit: number;
  marginPct: number | null;
  markupPct: number | null;
  addons: { label: string; pct: number; amount: Cents }[];
  addonsTotal: Cents;
  subtotal: Cents;
  vat: Cents;
  invoice: Cents;
  ewt: Cents;
  cashReceived: Cents;
  health: 'empty' | 'healthy' | 'thin' | 'loss';
  breakEvenQty: number | null;
  ladder: { factor: number; price: Cents; marginPct: number | null; profit: number }[];
}

export function computeServiceQuote(q: ServiceQuoteInput): ServiceQuoteResult {
  const qty = Math.max(1, Math.round(q.qty || 1));
  const materials = sum(q.materials.map((m) => m.unitCost * m.qtyPerPc * qty));
  const outsourced = sum(q.outsourced.map((o) => o.unitCost * o.qty));
  const labor = sum(q.labor.map((l) => l.hours * l.rate));
  const other = sum(q.other.map((o) => o.amount));
  const direct = materials + outsourced + labor + other;
  const overhead = direct * (q.overheadPct / 100);
  const totalCost = direct + overhead;
  const costPerPc = totalCost / qty;

  let raw: number;
  if (q.method === 'manual') raw = q.manualPrice ?? 0;
  else if (q.method === 'markup') raw = costPerPc * (1 + q.markupPct / 100);
  else raw = q.marginPct >= 100 ? 0 : costPerPc / (1 - q.marginPct / 100);
  const pricePerPc = q.method === 'manual' ? Math.round(raw) : roundUpTo(Math.round(raw), q.roundTo);
  const totalPrice = pricePerPc * qty;
  const profit = totalPrice - totalCost;

  const addons: { label: string; pct: number; amount: Cents }[] = [];
  if (q.addons.rush) addons.push({ label: 'Rush job', pct: q.addonPcts.rush, amount: Math.round((totalPrice * q.addonPcts.rush) / 100) });
  if (q.addons.revision > 0)
    addons.push({
      label: q.addons.revision > 1 ? `Extra revision rounds ×${q.addons.revision}` : 'Extra revision round',
      pct: q.addonPcts.revision * q.addons.revision,
      amount: Math.round((totalPrice * q.addonPcts.revision * q.addons.revision) / 100),
    });
  if (q.addons.sourceFiles) addons.push({ label: 'Source files', pct: q.addonPcts.sourceFiles, amount: Math.round((totalPrice * q.addonPcts.sourceFiles) / 100) });
  if (q.addons.ipBuyout) addons.push({ label: 'Full IP buy-out', pct: q.addonPcts.ipBuyout, amount: Math.round((totalPrice * q.addonPcts.ipBuyout) / 100) });
  const addonsTotal = sum(addons.map((a) => a.amount));
  const subtotal = totalPrice + addonsTotal;
  const vat = q.vatRegistered ? Math.round((subtotal * q.vatPct) / 100) : 0;
  const invoice = subtotal + vat;
  const ewt = q.ewt ? Math.round((subtotal * q.ewtPct) / 100) : 0;
  const marginPct = totalPrice > 0 ? (profit / totalPrice) * 100 : null;
  const health: ServiceQuoteResult['health'] =
    totalPrice <= 0 ? 'empty' : profit < 0 ? 'loss' : marginPct !== null && marginPct < q.minMarginPct ? 'thin' : 'healthy';
  const variablePerPc = (materials + outsourced + other) / qty;
  const breakEvenQty = pricePerPc - variablePerPc > 0 && overhead > 0 ? Math.ceil(overhead / (pricePerPc - variablePerPc)) : null;
  const ladder = [0.8, 0.9, 1, 1.1, 1.2, 1.3].map((factor) => {
    const price = Math.round(pricePerPc * factor);
    return { factor, price, marginPct: price > 0 ? ((price - costPerPc) / price) * 100 : null, profit: (price - costPerPc) * qty };
  });

  return {
    materials,
    outsourced,
    labor,
    other,
    direct,
    overhead,
    totalCost,
    costPerPc,
    pricePerPc,
    totalPrice,
    profitPerPc: pricePerPc - costPerPc,
    profit,
    marginPct,
    markupPct: totalCost > 0 ? (profit / totalCost) * 100 : null,
    addons,
    addonsTotal,
    subtotal,
    vat,
    invoice,
    ewt,
    cashReceived: invoice - ewt,
    health,
    breakEvenQty,
    ladder,
  };
}

/** QUICK LOOKUP: a client named a price first; is it worth taking? */
export function reverseCheck(offered: Cents, cost: Cents, minMarginPct: number) {
  const profit = offered - cost;
  const margin = offered > 0 ? (profit / offered) * 100 : null;
  const markup = cost > 0 ? (profit / cost) * 100 : null;
  const verdict: 'loss' | 'thin' | 'ok' | 'empty' =
    offered <= 0 ? 'empty' : offered <= cost ? 'loss' : margin !== null && margin < minMarginPct ? 'thin' : 'ok';
  return { profit, margin, markup, verdict };
}

export const markupToMargin = (markupPct: number) => (markupPct > -100 ? (markupPct / (100 + markupPct)) * 100 : null);
export const marginToMarkup = (marginPct: number) => (marginPct < 100 ? (marginPct / (100 - marginPct)) * 100 : null);

/** Booth-aware event pricing, from the plan: what a booth fee means for a price. */
export interface BoothPricingInput {
  fixedCosts: Cents;
  unitCost: Cents;
  price: Cents;
  expectedQty: number;
  targetProfit: Cents;
  roundTo: number;
}

export function boothPricing(i: BoothPricingInput) {
  const perItemProfit = i.price - i.unitCost;
  const breakEven = perItemProfit > 0 ? Math.ceil(i.fixedCosts / perItemProfit - 1e-9) : null;
  const q = Math.max(0, Math.round(i.expectedQty));
  const boothPerItem = q > 0 ? i.fixedCosts / q : null;
  const floor = boothPerItem === null ? null : i.unitCost + boothPerItem;
  const floorRounded = floor === null ? null : roundUpTo(Math.round(floor), i.roundTo);
  const targetPrice = q > 0 ? roundUpTo(Math.round(i.unitCost + (i.fixedCosts + i.targetProfit) / q), i.roundTo) : null;
  const projected = q * perItemProfit - i.fixedCosts;
  return { perItemProfit, breakEven, boothPerItem, floor, floorRounded, targetPrice, projected, covers: breakEven !== null && q >= breakEven };
}
