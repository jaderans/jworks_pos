import { roundUpTo, type Cents } from '../lib/money';

/**
 * Sticker jobs priced by size, ported from the old STICKER JOB tab:
 * work out how many stickers fit on a sheet, cost a reference run,
 * set a base price for 2 × 2 in and scale every other size by a multiplier.
 */

export interface SheetSpec {
  widthMm: number;
  heightMm: number;
  marginMm: number;
  gutterMm: number;
}

export const SHEETS: { key: string; label: string; spec: SheetSpec }[] = [
  { key: 'A4', label: 'A4 (210 × 297 mm)', spec: { widthMm: 210, heightMm: 297, marginMm: 5, gutterMm: 3 } },
  { key: 'A3', label: 'A3 (297 × 420 mm)', spec: { widthMm: 297, heightMm: 420, marginMm: 5, gutterMm: 3 } },
  { key: 'Letter', label: 'Letter (216 × 279 mm)', spec: { widthMm: 216, heightMm: 279, marginMm: 5, gutterMm: 3 } },
];

const MM_PER_IN = 25.4;

/** Pieces that fit on one sheet, trying both orientations. */
export function fitsPerSheet(sheet: SheetSpec, wIn: number, hIn: number): number {
  if (!(wIn > 0) || !(hIn > 0)) return 0;
  const usableW = sheet.widthMm - 2 * sheet.marginMm;
  const usableH = sheet.heightMm - 2 * sheet.marginMm;
  const g = Math.max(0, sheet.gutterMm);
  const fit = (w: number, h: number) =>
    Math.max(0, Math.floor((usableW + g) / (w * MM_PER_IN + g))) * Math.max(0, Math.floor((usableH + g) / (h * MM_PER_IN + g)));
  return Math.max(fit(wIn, hIn), fit(hIn, wIn));
}

export interface StickerSize {
  label: string;
  w: number;
  h: number;
  multiplier: number;
}

export const DEFAULT_SIZES: StickerSize[] = [
  { label: '1 × 1 in', w: 1, h: 1, multiplier: 0.5 },
  { label: '1.5 × 1.5 in', w: 1.5, h: 1.5, multiplier: 0.7 },
  { label: '2 × 2 in', w: 2, h: 2, multiplier: 1 },
  { label: '2 × 3 in', w: 2, h: 3, multiplier: 1.4 },
  { label: '3 × 3 in', w: 3, h: 3, multiplier: 2 },
  { label: '3 × 4 in', w: 3, h: 4, multiplier: 2.6 },
  { label: '4 × 4 in', w: 4, h: 4, multiplier: 3.3 },
  { label: '4 × 5 in', w: 4, h: 5, multiplier: 4 },
  { label: '5 × 5 in', w: 5, h: 5, multiplier: 5 },
  { label: '6 × 6 in', w: 6, h: 6, multiplier: 7 },
];

export interface StickerJobInput {
  sheet: SheetSpec;
  /** Vinyl + laminate + ink per sheet. */
  sheetCost: Cents;
  refQty: number;
  spoilagePct: number;
  designHours: number;
  designRate: Cents;
  minutesPerSheet: number;
  productionRate: Cents;
  overheadPct: number;
  targetMarginPct: number;
  roundTo: number;
  baseW: number;
  baseH: number;
  manualBasePrice: Cents | null;
  sizes: StickerSize[];
}

/** Sheets needed for a quantity including spoilage. */
export function sheetsFor(qty: number, perSheet: number, spoilagePct: number): number {
  if (perSheet <= 0 || qty <= 0) return 0;
  const withSpoilage = Math.ceil(qty * (1 + Math.max(0, spoilagePct) / 100) - 1e-9);
  return Math.ceil(withSpoilage / perSheet);
}

/** Cost per piece when producing `qty` pieces of a size that fits `perSheet` per sheet. */
export function stickerCostPerPiece(input: StickerJobInput, perSheet: number, qty: number): number | null {
  if (perSheet <= 0 || qty <= 0) return null;
  const sheets = sheetsFor(qty, perSheet, input.spoilagePct);
  const design = input.designHours * input.designRate;
  const labor = sheets * (input.minutesPerSheet / 60) * input.productionRate;
  const total = (sheets * input.sheetCost + design + labor) * (1 + input.overheadPct / 100);
  return total / qty;
}

export interface PriceListRow extends StickerSize {
  perSheet: number;
  sheets: number;
  costPerPc: number | null;
  price: Cents;
  marginPct: number | null;
}

export interface PriceList {
  basePerSheet: number;
  baseCost: number | null;
  baseAuto: Cents;
  baseInUse: Cents;
  rows: PriceListRow[];
}

export function stickerPriceList(input: StickerJobInput): PriceList {
  const basePerSheet = fitsPerSheet(input.sheet, input.baseW, input.baseH);
  const baseCost = stickerCostPerPiece(input, basePerSheet, input.refQty);
  const target = Math.min(0.95, Math.max(0, input.targetMarginPct / 100));
  const baseAuto = baseCost === null ? 0 : roundUpTo(Math.round(baseCost / (1 - target)), input.roundTo);
  const baseInUse = input.manualBasePrice ?? baseAuto;
  const rows = input.sizes.map((s) => {
    const perSheet = fitsPerSheet(input.sheet, s.w, s.h);
    const costPerPc = stickerCostPerPiece(input, perSheet, input.refQty);
    const price = roundUpTo(Math.round(baseInUse * s.multiplier), input.roundTo);
    return {
      ...s,
      perSheet,
      sheets: sheetsFor(input.refQty, perSheet, input.spoilagePct),
      costPerPc,
      price,
      marginPct: costPerPc !== null && price > 0 ? ((price - costPerPc) / price) * 100 : null,
    };
  });
  return { basePerSheet, baseCost, baseAuto, baseInUse, rows };
}

export interface OrderQuote {
  perSheet: number;
  piecesNeeded: number;
  sheets: number;
  piecesMade: number;
  spare: number;
  materials: number;
  labor: number;
  totalCost: number;
  costPerPc: number;
  pricePerPc: Cents;
  totalPrice: Cents;
  profit: number;
  marginPct: number | null;
}

export function quoteStickerOrder(input: StickerJobInput, row: PriceListRow, qty: number): OrderQuote | null {
  if (row.perSheet <= 0 || qty <= 0) return null;
  const piecesNeeded = Math.ceil(qty * (1 + input.spoilagePct / 100) - 1e-9);
  const sheets = Math.ceil(piecesNeeded / row.perSheet);
  const piecesMade = sheets * row.perSheet;
  const materials = sheets * input.sheetCost;
  const labor = input.designHours * input.designRate + sheets * (input.minutesPerSheet / 60) * input.productionRate;
  const totalCost = (materials + labor) * (1 + input.overheadPct / 100);
  const totalPrice = row.price * qty;
  const profit = totalPrice - totalCost;
  return {
    perSheet: row.perSheet,
    piecesNeeded,
    sheets,
    piecesMade,
    spare: piecesMade - qty,
    materials,
    labor,
    totalCost,
    costPerPc: totalCost / qty,
    pricePerPc: row.price,
    totalPrice,
    profit,
    marginPct: totalPrice > 0 ? (profit / totalPrice) * 100 : null,
  };
}

export const BREAK_QTYS = [5, 10, 25, 50, 100, 250, 500];
