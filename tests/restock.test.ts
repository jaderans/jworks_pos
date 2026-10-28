import { describe, expect, it } from 'vitest';
import { toCents } from '../src/lib/money';
import { materialsFor, restockPlan, type PastEvent } from '../src/domain/restock';
import type { Material, Recipe } from '../src/db/types';

const P = toCents;
const product = (id: string, trackStock: 0 | 1 = 1) => ({ id, name: id, active: 1 as const, trackStock, deleted: undefined });
const past = (eventId: string, hours: number, sold: Record<string, number>, offered: string[]): PastEvent => ({
  eventId, name: eventId, hours, sold: new Map(Object.entries(sold)), offered: new Set(offered),
});

describe('restock plan', () => {
  it('weights recent events more and ignores events where a product was not on the table', () => {
    const rows = restockPlan({
      products: [product('pin'), product('sticker')],
      // newest first: pin sold 20 in 10h (2/h) then 10 in 10h (1/h); sticker only offered at the older one
      past: [past('new', 10, { pin: 20 }, ['pin']), past('old', 10, { pin: 10, sticker: 30 }, ['pin', 'sticker'])],
      plannedHours: 8,
      safetyPct: 25,
      onHand: new Map([['pin', 5]]),
    });
    const pin = rows.find((r) => r.productId === 'pin')!;
    // (2×2 + 1×1) / 3 = 1.67 per hour → 13.4 expected → 17 with 25% safety → make 12 after 5 in studio
    expect(pin).toMatchObject({ perHour: 1.67, expected: 13.4, target: 17, inStudio: 5, make: 12, basedOn: 2 });
    const sticker = rows.find((r) => r.productId === 'sticker')!;
    expect(sticker).toMatchObject({ perHour: 3, target: 30, make: 30, basedOn: 1 });
  });

  it('skips products with no history and untracked stock counts as zero', () => {
    const rows = restockPlan({
      products: [product('pin', 0), product('new-design')],
      past: [past('e', 8, { pin: 8 }, ['pin'])],
      plannedHours: 8,
      safetyPct: 0,
      onHand: new Map([['pin', 100]]),
    });
    expect(rows.map((r) => r.productId)).toEqual(['pin']);
    expect(rows[0]).toMatchObject({ target: 8, inStudio: 0, make: 8 });
  });
});

describe('materials to buy', () => {
  it('adds up recipes and rounds to whole packs', () => {
    const vinyl = { id: 'vinyl', name: 'Vinyl A4', unit: 'sheet', packQty: 20, packCost: P(280), onHand: 3 } as Material;
    const ink = { id: 'ink', name: 'Ink', unit: 'print', packQty: 1, packCost: null, onHand: 0 } as Material;
    const recipe = (items: [string, number][]): Recipe => ({ items: items.map(([materialId, qty]) => ({ materialId, qty })), laborMinutes: 0, laborRate: 0, packaging: 0, spoilagePct: 0, overheadPct: 0 });
    const needs = materialsFor(
      [{ productId: 'sticker', qty: 60 }, { productId: 'pin', qty: 10 }],
      new Map([
        ['sticker', recipe([['vinyl', 1 / 15], ['ink', 1 / 15]])],
        ['pin', recipe([['vinyl', 0.5]])],
      ]),
      new Map([['vinyl', vinyl], ['ink', ink]]),
    );
    const v = needs.find((n) => n.materialId === 'vinyl')!;
    // 60/15 + 10×0.5 = 9 sheets, 3 on hand → 6 short → 1 pack of 20 → ₱280
    expect(v).toMatchObject({ need: 9, onHand: 3, short: 6, packs: 1, cost: P(280) });
    expect(needs.find((n) => n.materialId === 'ink')).toMatchObject({ need: 4, packs: 4, cost: null });
  });
});
