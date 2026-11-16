import { roundUpTo, sum, toCents, type Cents } from '../lib/money';
import { addDays } from '../lib/time';
import type { CutArea, IllustrationTier, PackSize, PrintLine, PrintOrder, PrintRates, PrintStatus, StickerPreset } from '../db/types';

/**
 * The sticker printing service: prices from the rate card (per A4 sheet,
 * cutting add-ons, peel-off sheets, packaging), the 50% down payment, the
 * printer's share, and the ready-by date.
 */

const P = toCents;

/** JoshWorks Sticker Printing · Rates 2026. */
export const DEFAULT_PRINT_RATES: PrintRates = {
  ratesVersion: 2,
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
  // The rate sheet's size guide. Its inch column had two typos ("2 × 1.5" and "2.5 × 3"); the cm column and the
  // counts are for 2 × 2.5 in and 2 × 3 in. Counts are worked out from the cut area, never typed.
  stickerSizes: [
    { name: '1 × 1 in', w: 1, h: 1 },
    { name: '1.5 × 1.5 in', w: 1.5, h: 1.5 },
    { name: '2 × 2 in', w: 2, h: 2 },
    { name: '2.5 × 2.5 in', w: 2.5, h: 2.5 },
    { name: '3 × 3 in', w: 3, h: 3 },
    { name: '3.5 × 3.5 in', w: 3.5, h: 3.5 },
    { name: '4 × 4 in', w: 4, h: 4 },
    { name: '2 × 2.5 in', w: 2, h: 2.5 },
    { name: '2 × 3 in', w: 2, h: 3 },
    { name: '3 × 4 in', w: 3, h: 4 },
    { name: '1 × 3 in strip', w: 1, h: 3 },
  ],
  // Cricut Print Then Cut on A4: its largest design is 7.2 × 10.62 in, inside the registration marks.
  cutArea: { w: 7.2, h: 10.62, gapMm: 3 },
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
        price: P(130),
        // Each set saves ₱20, ₱50 and ₱150 off ₱130 a design.
        sets: [{ designs: 2, price: P(240) }, { designs: 5, price: P(600) }, { designs: 10, price: P(1150) }],
      },
      {
        key: 'detailed',
        name: 'Detailed',
        note: 'Full illustration with shading, texture, props, hand lettering or a character in a scene. Portraits and pet stickers.',
        price: P(250),
        // Each set saves what the rate sheet says (₱50, ₱150, ₱500) off ₱250 a design.
        sets: [{ designs: 2, price: P(450) }, { designs: 5, price: P(1100) }, { designs: 10, price: P(2000) }],
      },
    ],
  },
};

/** November 2026 illustration prices: [tier, designs (1 = one design), old price, new price]. */
const ILLUSTRATION_CHANGES: [string, number, number, number][] = [
  ['simple', 1, 100, 130], ['simple', 2, 180, 240], ['simple', 5, 450, 600], ['simple', 10, 850, 1150],
  ['detailed', 1, 220, 250], ['detailed', 2, 390, 450], ['detailed', 5, 950, 1100], ['detailed', 10, 1700, 2000],
];
/** The size guide before sizes had inches: the rate sheet's list, typos and all. */
const OLD_SIZE_NAMES = ['1 × 1 in', '1.5 × 1.5 in', '2 × 2 in', '2.5 × 2.5 in', '3 × 3 in', '3.5 × 3.5 in', '4 × 4 in', '2 × 1.5 in', '2.5 × 3 in', '3 × 4 in', '1 × 3 in strip'];

/** "2 × 1.5 in", "2x3", "1 × 3 in strip" → inches; null when it isn't a size. */
export function parseSize(text: string): { w: number; h: number } | null {
  const m = /(\d+(?:\.\d+)?)\s*[×x*]\s*(\d+(?:\.\d+)?)/i.exec(text);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  return w > 0 && h > 0 ? { w, h } : null;
}

/**
 * A rate card saved before version 2: sizes get inches (the untouched rate-sheet
 * list becomes the corrected one), the cut area is added, and illustration
 * prices still at the old rate take the new ones. Prices the owner changed stay.
 */
export function upgradePrintRates<T extends Partial<PrintRates>>(stored: T): T {
  if (!stored || typeof stored !== 'object' || (stored.ratesVersion ?? 1) >= 2) return stored;
  const out: Partial<PrintRates> = { ...stored, ratesVersion: 2, cutArea: stored.cutArea ?? DEFAULT_PRINT_RATES.cutArea };
  const sizes = stored.stickerSizes as ({ name: string } & Partial<StickerPreset>)[] | undefined;
  if (Array.isArray(sizes)) {
    const untouched = sizes.length === OLD_SIZE_NAMES.length && sizes.every((s, i) => s?.name === OLD_SIZE_NAMES[i]);
    out.stickerSizes = untouched
      ? DEFAULT_PRINT_RATES.stickerSizes
      : sizes.flatMap((s) => {
          const wh = s.w && s.h ? { w: s.w, h: s.h } : parseSize(s.name ?? '');
          return wh ? [{ name: s.name, ...wh }] : [];
        });
  }
  const tiers = stored.illustration?.tiers;
  if (Array.isArray(tiers)) {
    const was = (key: string, designs: number, price: Cents) => {
      const c = ILLUSTRATION_CHANGES.find(([k, d, from]) => k === key && d === designs && P(from) === price);
      return c ? P(c[3]) : price;
    };
    out.illustration = {
      ...stored.illustration!,
      tiers: tiers.map((t) => ({ ...t, price: was(t.key, 1, t.price), sets: (t.sets ?? []).map((s) => ({ ...s, price: was(t.key, s.designs, s.price) })) })),
    };
  }
  return out as T;
}

const MM_PER_IN = 25.4;

export interface StickerFit {
  /** Stickers on one sheet. */
  perA4: number;
  /** How they're laid out: across × down, and whether the sticker is turned sideways to fit more. */
  across: number;
  down: number;
  rotated: boolean;
}

/**
 * How many stickers of w × h inches fit in the cut area, trying the sticker both
 * ways round (the STICKER JOB tab's formula): ⌊(area + gap) ÷ (size + gap)⌋ each way.
 */
export function stickerFit(area: CutArea, w: number, h: number): StickerFit {
  const none = { perA4: 0, across: 0, down: 0, rotated: false };
  if (!(w > 0) || !(h > 0) || !(area?.w > 0) || !(area?.h > 0)) return none;
  const g = Math.max(0, area.gapMm || 0);
  const count = (len: number, size: number) => Math.max(0, Math.floor((len * MM_PER_IN + g) / (size * MM_PER_IN + g) + 1e-9));
  const upright = { across: count(area.w, w), down: count(area.h, h), rotated: false };
  const sideways = { across: count(area.w, h), down: count(area.h, w), rotated: true };
  const best = sideways.across * sideways.down > upright.across * upright.down ? sideways : upright;
  return { ...best, perA4: best.across * best.down };
}

/** Stickers of this size on one sheet of this rate card. */
export const perSheet = (r: Pick<PrintRates, 'cutArea'>, w: number, h: number) => stickerFit(r.cutArea ?? DEFAULT_PRINT_RATES.cutArea, w, h).perA4;

/** 2.25 → "2.25", 2 → "2" */
const inches = (n: number) => String(Math.round(n * 100) / 100);
export const sizeName = (w: number, h: number) => `${inches(w)} × ${inches(h)} in`;

/** Sheets for this many stickers, and the spares those sheets make. */
export function sheetsForStickers(stickers: number, fit: number): { sheets: number; made: number; spare: number } {
  if (!(fit > 0) || !(stickers > 0)) return { sheets: 0, made: 0, spare: 0 };
  const sheets = Math.ceil(stickers / fit);
  return { sheets, made: sheets * fit, spare: sheets * fit - stickers };
}

/** The sticker size on a sheets line: a size-guide name, or the customer's own inches. */
export type SheetSize = string | { w: number; h: number; name?: string };

export const PACK_SIZE_LABEL: Record<PackSize, string> = { small: 'Small (3.5 × 5 | 2.5 × 7 in)', medium: 'Medium (4 × 6 in)', large: 'Large (5 × 7 in)' };

export const PRINT_STATUS_LABEL: Record<PrintStatus, string> = {
  quote: 'Quote and proof',
  printing: 'Making',
  ready: 'Ready',
  done: 'Done',
  cancelled: 'Cancelled',
};

export const isOpenPrint = (o: Pick<PrintOrder, 'status'>) => o.status !== 'done' && o.status !== 'cancelled';

const materialName = (m: PrintRates['materials'][number]) => `${m.group} ${m.name}`;

/** A size-guide name or the customer's own inches, as a named size; undefined when there's none. */
function resolveSize(r: PrintRates, size: SheetSize | undefined): StickerPreset | undefined {
  if (!size) return undefined;
  if (typeof size === 'string') {
    const preset = r.stickerSizes.find((s) => s.name === size);
    if (preset) return preset;
    const wh = parseSize(size);
    return wh ? { name: sizeName(wh.w, wh.h), ...wh } : undefined;
  }
  return size.w > 0 && size.h > 0 ? { name: size.name || sizeName(size.w, size.h), w: size.w, h: size.h } : undefined;
}

/**
 * A4 sheets of one material and cut. With a sticker size it says about how many
 * stickers that is; with a sticker count the sheets are worked out from it.
 */
export function sheetsLine(r: PrintRates, materialKey: string, cutKey: string, sheets: number, size?: SheetSize, stickers?: number): PrintLine {
  const m = r.materials.find((x) => x.key === materialKey) ?? r.materials[0];
  const c = r.cuts.find((x) => x.key === cutKey) ?? r.cuts[0];
  const s = resolveSize(r, size);
  const fit = s ? perSheet(r, s.w, s.h) : 0;
  const byCount = s && fit > 0 && stickers && stickers > 0 ? sheetsForStickers(stickers, fit) : null;
  const n = byCount ? byCount.sheets : sheets;
  const about = s ? (byCount ? ` · ${s.name}: ${stickers} stickers, ${byCount.made} fit on ${n} sheet${n === 1 ? '' : 's'}` : fit > 0 ? ` · ${s.name}, about ${fit * n} stickers` : ` · ${s.name}, too big for one sheet`) : '';
  return {
    kind: 'sheets',
    label: `${materialName(m)}, ${c.name.toLowerCase()}${about}`,
    qty: n,
    unitPrice: m.price + c.price,
    unitCost: m.cost,
    a4: n,
    material: m.key,
    cut: c.key,
    ...(s ? { size: s.name, w: s.w, h: s.h } : {}),
    ...(byCount ? { stickers } : {}),
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
