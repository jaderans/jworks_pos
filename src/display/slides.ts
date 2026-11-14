import { peso, type Cents } from '../lib/money';
import { fmtIsoDate, isoDate } from '../lib/time';
import { effectivePrice, isOnSale } from '../services/catalog';
import { isOrderLine, isRevenueSale } from '../domain/orders';
import { illustrationPrice } from '../domain/print';
import { offText } from '../domain/coupons';
import type { BundleRule, Category, CouponBatch, EventProduct, PrintRates, Product, Sale } from '../db/types';

/**
 * The customer screen's slides, made from the POS itself so they change the
 * moment a price does: this event's prices by category, bundle deals, the
 * sticker printing and illustration rates, a coupon the booth gives out, and
 * today's best sellers. The owner's own images and videos go between them.
 */

/** How the customer screen behaves on this device (kept on the device, like its register letter). */
export interface DisplaySettings {
  /** Seconds with nothing rung up before the idle slides start. */
  idleSeconds: number;
  /** Seconds each made slide shows; an image ad has its own. */
  slideSeconds: number;
  /** While buying: slides beside the cart, or just the brand. */
  sideAds: boolean;
  priceSlides: boolean;
  bestSellers: boolean;
  ownAds: boolean;
  /** Custom sticker designs from the Drive folder. */
  driveStickers: boolean;
  /** Call ready orders out loud: a chime, then the number. */
  callOut: boolean;
  /** The voice that calls them, by name; '' for the best woman's voice on the laptop. */
  voice: string;
}

export const DEFAULT_DISPLAY: DisplaySettings = { idleSeconds: 20, slideSeconds: 8, sideAds: true, priceSlides: true, bestSellers: true, ownAds: true, driveStickers: true, callOut: true, voice: '' };

export type Slide =
  | { kind: 'brand'; key: string }
  | { kind: 'prices'; key: string; title: string; part: string; rows: { name: string; price: Cents; was: Cents | null }[] }
  | { kind: 'deals'; key: string; rows: { name: string; text: string }[] }
  | { kind: 'printing'; key: string; rows: { name: string; price: Cents; note: string }[]; extras: string[] }
  | { kind: 'illustration'; key: string; tiers: { name: string; note: string; price: Cents; sets: { designs: number; price: Cents; saved: Cents }[] }[] }
  | { kind: 'coupon'; key: string; head: string; detail: string }
  | { kind: 'best'; key: string; rows: { name: string; qty: number }[] }
  | { kind: 'ready'; key: string; rows: { number: string; name: string }[] }
  | { kind: 'wheel'; key: string; rule: string; prizes: string[] }
  | { kind: 'sticker'; key: string; id: string; code: string; label: string; status: string | null }
  | { kind: 'media'; key: string; id: string; media: 'image' | 'video'; seconds: number };

export interface SlideInput {
  eventId: string;
  products: readonly Product[];
  categories: readonly Category[];
  eventProducts: readonly EventProduct[];
  rules: readonly BundleRule[];
  rates: PrintRates;
  batches: readonly CouponBatch[];
  sales: readonly Sale[];
  business: string;
  today?: string;
  settings: Pick<DisplaySettings, 'priceSlides' | 'bestSellers'>;
  /** Orders waiting at the counter: commission and print orders marked Ready. */
  ready?: { number: string; name: string }[];
  /** The event's prize wheel, when it's on: "Spend ₱250 or buy 15 Sticker items". */
  wheel?: { rule: string; prizes: string[] } | null;
  /** Custom sticker designs from Drive, each with the status of the order its number matches, if any. */
  stickers?: { id: string; code: string; label: string; status: string | null }[];
}

/** Products per price slide: readable from across the booth. */
export const ROWS_PER_SLIDE = 6;

const chunk = <T,>(xs: readonly T[], n: number): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

export function buildSlides(i: SlideInput): Slide[] {
  const out: Slide[] = [{ kind: 'brand', key: 'brand' }];
  const today = i.today ?? isoDate();
  if (i.settings.priceSlides) {
    const ep = new Map(i.eventProducts.filter((e) => e.eventId === i.eventId).map((e) => [e.productId, e]));
    const priced = i.products
      .filter((p) => p.deleted !== 1 && isOnSale(p, ep.get(p.id)))
      .map((p) => ({ p, price: effectivePrice(p, ep.get(p.id)) }))
      .filter((x): x is { p: Product; price: Cents } => x.price !== null);
    const cats = [...i.categories].filter((c) => c.deleted !== 1).sort((a, b) => a.sort - b.sort);
    const groups = [...cats.map((c) => ({ id: c.id as string | null, name: c.name })), { id: null, name: 'More' }];
    for (const g of groups) {
      const rows = priced
        .filter((x) => (g.id === null ? !cats.some((c) => c.id === x.p.categoryId) : x.p.categoryId === g.id))
        .map((x) => ({ name: x.p.name, price: x.price, was: x.p.price !== null && x.p.price !== x.price ? x.p.price : null }));
      const parts = chunk(rows, ROWS_PER_SLIDE);
      parts.forEach((part, k) => out.push({ kind: 'prices', key: `prices:${g.id ?? 'more'}:${k}`, title: g.name, part: parts.length > 1 ? `${k + 1} of ${parts.length}` : '', rows: part }));
    }
    const deals = i.rules.filter((r) => r.active === 1 && r.deleted !== 1 && (r.eventId === null || r.eventId === i.eventId));
    chunk(deals, ROWS_PER_SLIDE).forEach((part, k) => out.push({ kind: 'deals', key: `deals:${k}`, rows: part.map((r) => ({ name: r.name, text: `${r.qty} for ${peso(r.price)}` })) }));

    const r = i.rates;
    const byGroup = new Map<string, { price: Cents; count: number }>();
    for (const m of r.materials) {
      const g = byGroup.get(m.group) ?? { price: m.price, count: 0 };
      g.price = Math.min(g.price, m.price);
      g.count += 1;
      byGroup.set(m.group, g);
    }
    if (byGroup.size) {
      const die = r.cuts.find((c) => c.key === 'die');
      out.push({
        kind: 'printing',
        key: 'printing',
        rows: [...byGroup].map(([name, g]) => ({ name, price: g.price, note: g.count > 1 ? `${g.count} finishes, from` : 'per A4 sheet' })),
        extras: [...(die && die.price ? [`Die cut +${peso(die.price)} a sheet`] : []), `Minimum ${r.minSheets} A4 sheets`, 'Packaging and peel-off sheets too'],
      });
    }
    const tiers = r.illustration?.tiers ?? [];
    if (tiers.some((t) => t.price > 0)) {
      out.push({
        kind: 'illustration',
        key: 'illustration',
        tiers: tiers.map((t) => ({ name: t.name, note: t.note, price: t.price, sets: t.sets.map((s) => ({ designs: s.designs, price: illustrationPrice(t, s.designs).total, saved: illustrationPrice(t, s.designs).saved })) })),
      });
    }
    const earn = i.batches
      .filter((b) => b.eventId === i.eventId && b.active === 1 && b.deleted !== 1 && b.earnMin > 0 && (!b.validTo || b.validTo >= today))
      .sort((a, b) => a.earnMin - b.earnMin)[0];
    if (earn)
      out.push({
        kind: 'coupon',
        key: `coupon:${earn.id}`,
        head: `Spend ${peso(earn.earnMin)} today, get ${offText(earn)} a ${i.business} service`,
        detail: `For services of ${peso(earn.minSpend)} or more: sticker printing, illustration, commissions${earn.validTo ? `. Good until ${fmtIsoDate(earn.validTo)}` : ''}.`,
      });
  }
  if (i.ready?.length) chunk(i.ready, 8).forEach((part, k) => out.push({ kind: 'ready', key: `ready:${k}`, rows: part }));
  if (i.wheel?.rule) out.push({ kind: 'wheel', key: 'wheel', rule: i.wheel.rule, prizes: i.wheel.prizes });
  for (const s of i.stickers ?? []) out.push({ kind: 'sticker', key: `sticker:${s.id}`, ...s });
  if (i.settings.bestSellers) {
    const sold = new Map<string, { name: string; qty: number }>();
    for (const s of i.sales) {
      if (s.eventId !== i.eventId || !isRevenueSale(s) || isoDate(s.at) !== today) continue;
      for (const l of s.lines) {
        if (isOrderLine(l.productId)) continue;
        const v = sold.get(l.productId) ?? { name: l.name, qty: 0 };
        v.qty += l.qty;
        sold.set(l.productId, v);
      }
    }
    const rows = [...sold.values()].sort((a, b) => b.qty - a.qty).slice(0, 5);
    if (rows.length >= 3) out.push({ kind: 'best', key: 'best', rows });
  }
  return out;
}

export interface AdMedia {
  id: string;
  kind: 'image' | 'video';
  seconds: number;
  on: 0 | 1;
}

/** The owner's ads between the made slides: one ad after each made slide, round and round. */
export function mixSlides(made: readonly Slide[], ads: readonly AdMedia[]): Slide[] {
  const media: Slide[] = ads.filter((a) => a.on === 1).map((a) => ({ kind: 'media', key: `media:${a.id}`, id: a.id, media: a.kind, seconds: a.seconds }));
  if (!media.length) return [...made];
  if (!made.length) return media;
  const out: Slide[] = [];
  const n = Math.max(made.length, media.length);
  for (let k = 0; k < n; k++) {
    if (k < made.length) out.push(made[k]);
    out.push(media[k % media.length]);
  }
  return out;
}
