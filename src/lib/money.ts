/**
 * Money is stored as whole centavos (integers) everywhere, so sums never
 * drift the way floating-point pesos do. Format only at the edges.
 */
export type Cents = number;

export const toCents = (pesos: number): Cents => Math.round(pesos * 100);
export const toPesos = (c: Cents): number => c / 100;

const fmt0 = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmt2 = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num0 = new Intl.NumberFormat('en-PH', { maximumFractionDigits: 0 });
const num2 = new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface FormatOptions {
  /** 'auto' drops .00 on whole pesos (default); 2 always shows centavos. */
  decimals?: 'auto' | 0 | 2;
  /** Show a leading + on positive values. */
  plus?: boolean;
}

/** ₱1,250 · ₱1,250.50 · −₱600 · "—" for null. */
export function peso(c: Cents | null | undefined, opts: FormatOptions = {}): string {
  if (c === null || c === undefined || Number.isNaN(c)) return '—';
  const decimals = opts.decimals ?? 'auto';
  const abs = Math.abs(Math.round(c));
  const whole = abs % 100 === 0;
  const f = decimals === 0 || (decimals === 'auto' && whole) ? fmt0 : fmt2;
  const body = f.format(abs / 100);
  if (c < 0 && abs !== 0) return '−' + body;
  if (opts.plus && c > 0) return '+' + body;
  return body;
}

/** Number without the ₱ sign: 1,250 or 1,250.50. */
export function pesoNumber(c: Cents | null | undefined, decimals: 'auto' | 0 | 2 = 'auto'): string {
  if (c === null || c === undefined || Number.isNaN(c)) return '';
  const abs = Math.abs(Math.round(c));
  const f = decimals === 0 || (decimals === 'auto' && abs % 100 === 0) ? num0 : num2;
  return (c < 0 ? '-' : '') + f.format(abs / 100);
}

/**
 * Parse what a person types into a money field: "1,250.5", "₱ 20", " 30 ".
 * Returns null for empty or invalid input.
 */
export function parseMoney(input: string | number | null | undefined): Cents | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') return Number.isFinite(input) ? toCents(input) : null;
  const cleaned = input.replace(/[₱,\s]/g, '').replace(/^php/i, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  if (!/^-?\d*(\.\d*)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? toCents(n) : null;
}

export const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);

/** Round up to the nearest step in pesos (₱5 → 500 centavos). */
export function roundUpTo(c: Cents, stepPesos: number): Cents {
  const step = Math.max(1, Math.round(stepPesos * 100));
  return Math.ceil(c / step - 1e-9) * step;
}

/** Round to nearest step in pesos. */
export function roundTo(c: Cents, stepPesos: number): Cents {
  const step = Math.max(1, Math.round(stepPesos * 100));
  return Math.round(c / step) * step;
}

/** Percentage of a centavo amount, rounded to the centavo. pct = 12.5 means 12.5%. */
export const percentOf = (c: Cents, pct: number): Cents => Math.round((c * pct) / 100);

/**
 * Split a total into parts proportional to weights so the parts add up to
 * the total exactly (largest-remainder method). Zero or negative total → zeros.
 */
export function allocate(total: Cents, weights: readonly number[]): Cents[] {
  const n = weights.length;
  if (n === 0) return [];
  const wsum = sum(weights.map((w) => Math.max(0, w)));
  if (total <= 0 || wsum <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * Math.max(0, w)) / wsum);
  const floors = raw.map((r) => Math.floor(r));
  let rest = total - sum(floors);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; k < order.length && rest > 0; k++) {
    floors[order[k].i] += 1;
    rest -= 1;
  }
  return floors;
}

export function formatPct(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value.toFixed(digits)}%`;
}

export const formatCount = (n: number): string => num0.format(n);
