import { describe, expect, it } from 'vitest';
import { toCents } from '../src/lib/money';
import { DEFAULT_PRINT_RATES } from '../src/domain/print';
import { ROWS_PER_SLIDE, buildSlides, mixSlides, type SlideInput } from '../src/display/slides';
import type { BundleRule, Category, CouponBatch, EventProduct, Product, Sale } from '../src/db/types';

const P = toCents;
const sync = { createdAt: 0, updatedAt: 0, deleted: 0 as const };
const cat = (id: string, name: string, sort: number) => ({ ...sync, id, name, sort }) as Category;
const product = (id: string, name: string, categoryId: string, price: number) => ({ ...sync, id, name, categoryId, price: P(price), sku: '', barcode: '', active: 1, trackStock: 0 }) as unknown as Product;
const priceAt = (productId: string, price: number) => ({ ...sync, id: `ep-${productId}`, eventId: 'ev', productId, price: P(price), active: 1, stockBrought: null }) as unknown as EventProduct;
const sale = (productId: string, name: string, qty: number, at = Date.now()) =>
  ({ ...sync, id: Math.random().toString(36), eventId: 'ev', status: 'completed', at, lines: [{ productId, name, qty }], total: 0, payments: [] }) as unknown as Sale;

const input = (over: Partial<SlideInput> = {}): SlideInput => ({
  eventId: 'ev',
  products: [product('cat', 'Cat Meme (Solo)', 's', 20), product('couple', 'Couple Pack (live)', 's', 200), product('pin', 'Enamel Pins', 'p', 40)],
  categories: [cat('p', 'Pins', 2), cat('s', 'Sticker', 1)],
  eventProducts: [priceAt('cat', 25), priceAt('couple', 240)],
  rules: [{ ...sync, id: 'r', name: 'Sticker trio', productIds: ['cat'], qty: 3, price: P(60), active: 1, eventId: null } as BundleRule],
  rates: DEFAULT_PRINT_RATES,
  batches: [],
  sales: [],
  business: 'JoshWorks',
  today: '2026-11-14',
  settings: { priceSlides: true, bestSellers: true },
  ...over,
});

describe('the customer screen’s slides', () => {
  it('lists this event’s prices by category, the regular price crossed out when the event changes it', () => {
    const slides = buildSlides(input());
    expect(slides[0].kind).toBe('brand');
    const prices = slides.filter((s) => s.kind === 'prices');
    expect(prices.map((s) => s.kind === 'prices' && s.title)).toEqual(['Sticker', 'Pins']);
    expect(prices[0].kind === 'prices' && prices[0].rows).toEqual([
      { name: 'Cat Meme (Solo)', price: P(25), was: P(20) },
      { name: 'Couple Pack (live)', price: P(240), was: P(200) },
    ]);
    expect(prices[1].kind === 'prices' && prices[1].rows).toEqual([{ name: 'Enamel Pins', price: P(40), was: null }]);
  });

  it('splits a long category over slides, and adds deals, printing and illustration rates', () => {
    const many = Array.from({ length: ROWS_PER_SLIDE + 2 }, (_, k) => product(`s${k}`, `Sticker ${k}`, 's', 20));
    const slides = buildSlides(input({ products: many, eventProducts: [] }));
    expect(slides.filter((s) => s.kind === 'prices').map((s) => s.kind === 'prices' && s.part)).toEqual(['1 of 2', '2 of 2']);
    expect(slides.find((s) => s.kind === 'deals')).toMatchObject({ rows: [{ name: 'Sticker trio', text: '3 for ₱60' }] });
    expect(slides.find((s) => s.kind === 'printing')).toMatchObject({ rows: [{ name: 'Standard', price: P(60) }, { name: 'Premium', price: P(80) }, expect.anything()] });
    const art = slides.find((s) => s.kind === 'illustration');
    expect(art?.kind === 'illustration' && art.tiers.map((t) => [t.name, t.price, t.sets.map((x) => x.price)])).toEqual([
      ['Small / simple', P(100), [P(180), P(450), P(850)]],
      ['Detailed', P(220), [P(390), P(950), P(1700)]],
    ]);
  });

  it('shows the booth coupon, and best sellers once 3 products have sold today', () => {
    const batch = { ...sync, id: 'b', eventId: 'ev', name: 'Spend ₱500', kind: 'amount', value: P(300), maxOff: 0, minSpend: P(2500), validFrom: '2026-11-06', validTo: '2027-01-07', mode: 'unique', maxUses: null, earnMin: P(500), prefix: 'HW26', active: 1 } as CouponBatch;
    const today = new Date('2026-11-14T15:00:00').getTime();
    const sales = [sale('cat', 'Cat Meme (Solo)', 5, today), sale('pin', 'Enamel Pins', 2, today), sale('couple', 'Couple Pack (live)', 1, today), sale('pin', 'Enamel Pins', 9, today - 86_400_000)];
    const slides = buildSlides(input({ batches: [batch], sales }));
    expect(slides.find((s) => s.kind === 'coupon')).toMatchObject({ head: 'Spend ₱500 today, get ₱300 off a JoshWorks service' });
    expect(slides.find((s) => s.kind === 'best')).toMatchObject({ rows: [{ name: 'Cat Meme (Solo)', qty: 5 }, { name: 'Enamel Pins', qty: 2 }, { name: 'Couple Pack (live)', qty: 1 }] });
    expect(buildSlides(input({ sales: sales.slice(0, 2) })).some((s) => s.kind === 'best')).toBe(false);
  });

  it('turned off, only the brand slide is left; the owner’s ads go between the slides', () => {
    const off = buildSlides(input({ settings: { priceSlides: false, bestSellers: false } }));
    expect(off.map((s) => s.kind)).toEqual(['brand']);
    const ads = [{ id: 'a1', kind: 'image' as const, seconds: 8, on: 1 as const }, { id: 'a2', kind: 'video' as const, seconds: 8, on: 1 as const }, { id: 'a3', kind: 'image' as const, seconds: 8, on: 0 as const }];
    expect(mixSlides(off, ads).map((s) => s.key)).toEqual(['brand', 'media:a1', 'media:a2']);
    const made = buildSlides(input({ settings: { priceSlides: true, bestSellers: false } }));
    const mixed = mixSlides(made, ads);
    expect(mixed.filter((s) => s.kind === 'media').length).toBe(made.length);
    expect(mixed[1].kind).toBe('media');
  });
});
