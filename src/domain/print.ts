import { roundUpTo, sum, toCents, type Cents } from '../lib/money';
import { addDays } from '../lib/time';
import type { IllustrationTier, PackSize, PrintLine, PrintOrder, PrintRates, PrintStatus } from '../db/types';

/**
 * The sticker printing service: prices from the rate card (per A4 sheet,
 * cutting add-ons, peel-off sheets, packaging), the 50% down payment, the
 * printer's share, and the ready-by date.
 */

const P = toCents;

/** JoshWorks Sticker Printing · Rates 2026. */
export const DEFAULT_PRINT_RATES: PrintRates = {
  materials: [
    { key: 'std-matte-glossy', group: 'Standard', name: 'Matte or Glossy', price: P(60), cost: null },
    { key: 'prem-matte-glossy', group: 'Premium', name: 'Matte or Glossy', price: P(80), cost: null },
    { key: 'prem-satin', group: 'Premium', name: 'Satin, Glitter or Prismatic', price: P(85), cost: null },
    { key: 'prem-holo', group: 'Premium', name: 'Holo Rainbow or Holo Broken Glass', price: P(90), cost: null },
    { key: 'prem-holo-stars', group: 'Premium', name: 'Holo Stars, Hearts or Sparkle', price: P(95), cost: null },
    { key: 'prem-clear', group: 'Premium', name: 'Transparent (clear)', price: P(100), cost: null },
    { key: 'paper-photo', group: 'Paper', name: 'Photo Paper, Glossy', price: P(50), cost: null },
    { key: 'paper-kraft', group: 'Paper', name: 'Kraft Paper (no white ink)', price: P(50), cost: null },
    { key: 'paper-label', group: 'Paper', name: 'Label Paper, Matte or Glossy (food labels)', price: P(60), cost: null },
  ],
  cuts: [
    { key: 'kiss', name: 'Kiss cut', price: 0 },
    { key: 'die', name: 'Die cut', price: P(10) },
    { key: 'peel', name: 'Peel-off sheet (kiss + die cut)', price: P(17) },
  ],
  peelSizes: [
    { key: '7x10', name: '7 × 10 in', perA4: 1, pack: null },
    { key: '5x7', name: '5 × 7 in', perA4: 2, pack: 'large' },
    { key: '4x6', name: '4 × 6 in', perA4: 2, pack: 'medium' },
    { key: '3.5x5', name: '3.5 × 5 in', perA4: 4, pack: 'small' },
    { key: '2.5x7', name: '2.5 × 7 in', perA4: 4, pack: 'small' },
  ],
  packs: [
    { key: 'sleeve', name: 'Clear sleeve only', small: P(5), medium: P(6), large: P(7) },
    { key: 'backing', name: 'Backing card + sleeve', small: P(12), medium: P(14), large: P(16) },
    { key: 'backing-lam', name: 'Backing card + sleeve, laminated card', small: P(14), medium: P(16), large: P(19) },
    { key: 'header', name: 'Header card + sleeve', small: P(11), medium: P(13), large: P(16) },
    { key: 'header-lam', name: 'Header card + sleeve, laminated card', small: P(12), medium: P(14), large: P(17) },
    { key: 'full', name: 'Full pack: header + backing + sleeve', small: P(17), medium: P(19), large: P(23) },
    { key: 'full-lam', name: 'Full pack, laminated card', small: P(20), medium: P(23), large: P(27) },
  ],
  stickerSizes: [
    { name: '1 × 1 in', perA4: 54 },
    { name: '1.5 × 1.5 in', perA4: 24 },
    { name: '2 × 2 in', perA4: 15 },
    { name: '2.5 × 2.5 in', perA4: 8 },
    { name: '3 × 3 in', perA4: 6 },
    { name: '3.5 × 3.5 in', perA4: 4 },
    { name: '4 × 4 in', perA4: 2 },
    { name: '2 × 1.5 in', perA4: 12 },
    { name: '2.5 × 3 in', perA4: 10 },
    { name: '3 × 4 in', perA4: 4 },
    { name: '1 × 3 in strip', perA4: 18 },
  ],
  minSheets: 3,
  minPacks: 20,
  leadDays: { min: 4, max: 7 },
  downPct: 50,
  printerPct: 20,
  // JoshWorks Sticker Illustration rates. The illustrator's share is set on the rate card.
  illustration: {
    artistPct: 0,
    tiers: [
      {
        key: 'simple',
        name: 'Small / simple',
        note: 'One subject, flat colours, light shading, little or no lettering. Mascots, icons and small doodles.',
        price: P(100),
        sets: [{ designs: 2, price: P(180) }, { designs: 5, price: P(450) }, { designs: 10, price: P(850) }],
      },
      {
        key: 'detailed',
        name: 'Detailed',
        note: 'Full illustration with shading, texture, props, hand lettering or a character in a scene. Portraits and pet stickers.',
        price: P(220),
        // Each set saves what the rate sheet says (₱50, ₱150, ₱500) off ₱220 a design.
        sets: [{ designs: 2, price: P(390) }, { designs: 5, price: P(950) }, { designs: 10, price: P(1700) }],
      },
    ],
  },
};

export const PACK_SIZE_LABEL: Record<PackSize, string> = { small: 'Small (3.5 × 5 | 2.5 × 7 in)', medium: 'Medium (4 × 6 in)', large: 'Large (5 × 7 in)' };

export const PRINT_STATUS_LABEL: Record<PrintStatus, string> = {
  quote: 'Quote and proof',
  printing: 'Printing',
  ready: 'Ready',
  done: 'Done',
  cancelled: 'Cancelled',
};

export const isOpenPrint = (o: Pick<PrintOrder, 'status'>) => o.status !== 'done' && o.status !== 'cancelled';

const materialName = (m: PrintRates['materials'][number]) => `${m.group} ${m.name}`;

/** A4 sheets of one material and cut; the size (optional) shows how many stickers that is. */
export function sheetsLine(r: PrintRates, materialKey: string, cutKey: string, sheets: number, size?: string): PrintLine {
  const m = r.materials.find((x) => x.key === materialKey) ?? r.materials[0];
  const c = r.cuts.find((x) => x.key === cutKey) ?? r.cuts[0];
  const fit = size ? r.stickerSizes.find((s) => s.name === size) : undefined;
  return {
    kind: 'sheets',
    label: `${materialName(m)}, ${c.name.toLowerCase()}${fit ? ` · ${fit.name}, about ${fit.perA4 * sheets} stickers` : ''}`,
    qty: sheets,
    unitPrice: m.price + c.price,
    unitCost: m.cost,
    a4: sheets,
    material: m.key,
    cut: c.key,
    size: fit?.name,
  };
}

/** Peel-off sheets: the A4 rate plus the peel-off cut, shared by the sheets cut from one A4. */
export function peelLine(r: PrintRates, materialKey: string, sizeKey: string, count: number): PrintLine {
  const m = r.materials.find((x) => x.key === materialKey) ?? r.materials[0];
  const s = r.peelSizes.find((x) => x.key === sizeKey) ?? r.peelSizes[0];
  const peel = r.cuts.find((x) => x.key === 'peel')?.price ?? 0;
  const a4 = Math.ceil(count / s.perA4);
  return {
    kind: 'peel',
    label: `Peel-off sheets ${s.name}, ${materialName(m)}`,
    qty: count,
    unitPrice: Math.round((m.price + peel) / s.perA4),
    unitCost: m.cost === null ? null : Math.round(m.cost / s.perA4),
    a4,
    material: m.key,
    size: s.key,
    packSize: s.pack ?? undefined,
  };
}

export function packLine(r: PrintRates, packKey: string, size: PackSize, packs: number): PrintLine {
  const p = r.packs.find((x) => x.key === packKey) ?? r.packs[0];
  return { kind: 'pack', label: `Packaging: ${p.name}, ${size}`, qty: packs, unitPrice: p[size], unitCost: null, a4: 0, pack: p.key, packSize: size };
}

export const customLine = (label: string, qty: number, unitPrice: Cents): PrintLine => ({ kind: 'custom', label, qty, unitPrice, unitCost: null, a4: 0 });

/**
 * The cheapest way to price this many designs in a tier: sets and single
 * designs mixed, so a set never costs more than buying the designs one by one.
 */
export function illustrationPrice(t: Pick<IllustrationTier, 'price' | 'sets'>, designs: number): { total: Cents; singles: Cents; saved: Cents } {
  const n = Math.max(0, Math.floor(designs));
  const best: Cents[] = [0];
  for (let k = 1; k <= n; k++) {
    let c = best[k - 1] + t.price;
    for (const s of t.sets) if (s.designs > 0 && s.designs <= k) c = Math.min(c, best[k - s.designs] + s.price);
    best.push(c);
  }
  const singles = n * t.price;
  return { total: best[n], singles, saved: singles - best[n] };
}

/** Drawing the sticker art: one line for the designs in a tier. The price comes from the rate card and can be changed on the order. */
export function illustrationLine(r: PrintRates, tierKey: string, designs: number, price?: Cents): PrintLine {
  const t = r.illustration.tiers.find((x) => x.key === tierKey) ?? r.illustration.tiers[0];
  const n = Math.max(1, Math.floor(designs));
  return {
    kind: 'illustration',
    label: `Sticker illustration, ${t.name.toLowerCase()}: ${n} design${n === 1 ? '' : 's'}`,
    qty: 1,
    unitPrice: price ?? illustrationPrice(t, n).total,
    unitCost: null,
    a4: 0,
    tier: t.key,
    designs: n,
  };
}

export const lineTotal = (l: Pick<PrintLine, 'qty' | 'unitPrice'>): Cents => Math.round(l.qty * l.unitPrice);

export interface PrintTotals {
  /** The print work: sheets, peel-off sheets, packaging and extras. */
  subtotal: Cents;
  /** A service coupon, off the print work. */
  discount: Cents;
  delivery: Cents;
  total: Cents;
  paid: Cents;
  balance: Cents;
  /** The down payment to start. */
  down: Cents;
  downPaid: boolean;
  /** A4 sheets to print. */
  a4: number;
  /** What the materials cost the studio, where the rate card has costs. */
  materialCost: Cents;
  /** The printer's share of the print work (not the illustration) after its part of the coupon. */
  printerShare: Cents;
  /** The illustration lines, before the coupon. */
  illustration: Cents;
  /** The illustrator's share of the illustration after its part of the coupon. */
  illustratorShare: Cents;
}

export function printTotals(o: Pick<PrintOrder, 'lines' | 'delivery' | 'payments' | 'printerPct' | 'illustratorPct' | 'coupon'>, downPct: number): PrintTotals {
  const subtotal = sum(o.lines.map(lineTotal));
  const discount = Math.min(subtotal, Math.max(0, o.coupon?.discount ?? 0));
  // Everyone shares the coupon: it comes off the print work and the illustration in proportion.
  const illustration = sum(o.lines.filter((l) => l.kind === 'illustration').map(lineTotal));
  const artOff = subtotal ? Math.round((discount * illustration) / subtotal) : 0;
  const delivery = o.delivery.method === 'courier' ? Math.max(0, o.delivery.fee) : 0;
  const total = subtotal - discount + delivery;
  const paid = sum(o.payments.map((p) => p.amount));
  // Half, rounded up to the next ₱5 (never more than the total).
  const down = total > 0 ? Math.min(total, roundUpTo(Math.round((total * downPct) / 100), 5)) : 0;
  return {
    subtotal,
    discount,
    delivery,
    total,
    paid,
    balance: Math.max(0, total - paid),
    down,
    downPaid: paid >= down,
    a4: sum(o.lines.map((l) => l.a4)),
    materialCost: sum(o.lines.map((l) => (l.unitCost === null ? 0 : Math.round(l.unitCost * (l.kind === 'peel' ? l.qty : l.a4 || l.qty))))),
    printerShare: Math.round(((subtotal - illustration - (discount - artOff)) * Math.max(0, o.printerPct)) / 100),
    illustration,
    illustratorShare: Math.round(((illustration - artOff) * Math.max(0, o.illustratorPct ?? 0)) / 100),
  };
}

/** Things to tell the customer before they pay: the rate sheet's minimums. */
export function printWarnings(o: Pick<PrintOrder, 'lines'>, r: PrintRates): string[] {
  const out: string[] = [];
  const a4 = sum(o.lines.map((l) => l.a4));
  if (a4 > 0 && a4 < r.minSheets) out.push(`The minimum order is ${r.minSheets} A4 sheets; this is ${a4}.`);
  for (const l of o.lines) if (l.kind === 'pack' && l.qty < r.minPacks) out.push(`Packaging needs at least ${r.minPacks} packs per design (${l.label}: ${l.qty}).`);
  return out;
}

/** The date after this many working days (Monday to Friday). */
export function addWorkingDays(iso: string, days: number): string {
  let d = iso;
  let left = days;
  while (left > 0) {
    d = addDays(d, 1);
    const dow = new Date(`${d}T12:00:00`).getDay();
    if (dow !== 0 && dow !== 6) left--;
  }
  return d;
}
