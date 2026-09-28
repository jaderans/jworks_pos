import { describe, expect, it } from 'vitest';
import { allocate, parseMoney, peso, roundUpTo, toCents } from '../src/lib/money';
import { checkPayments, lineRevenue, priceCart, type CartItem } from '../src/domain/cart';
import { batchCost, costAt, recipeCost, weightedAverage } from '../src/domain/cost';
import { computeShare, eventCosts } from '../src/domain/share';
import { DEFAULT_SIZES, SHEETS, fitsPerSheet, quoteStickerOrder, stickerCostPerPiece, stickerPriceList, type StickerJobInput } from '../src/domain/sticker';
import { boothPricing, computeServiceQuote, reverseCheck } from '../src/domain/quote';
import { drawerState, countTotal } from '../src/domain/summary';
import type { CostPoint, JWEvent, Material, Member, Product, RosterEntry, Sale, Session, SpendItem } from '../src/db/types';

const P = (n: number) => toCents(n);

describe('money', () => {
  it('formats pesos', () => {
    expect(peso(P(1250))).toBe('₱1,250');
    expect(peso(P(1250.5))).toBe('₱1,250.50');
    expect(peso(-P(600))).toBe('−₱600');
    expect(peso(null)).toBe('—');
  });
  it('parses typed amounts', () => {
    expect(parseMoney('₱1,250.5')).toBe(125050);
    expect(parseMoney(' 30 ')).toBe(3000);
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('abc')).toBeNull();
  });
  it('rounds up to ₱5', () => {
    expect(roundUpTo(P(26), 5)).toBe(P(30));
    expect(roundUpTo(P(25), 5)).toBe(P(25));
  });
  it('allocates exactly', () => {
    const parts = allocate(240000, [24, 24, 16, 8]);
    expect(parts).toEqual([80000, 80000, 53333, 26667]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(240000);
  });
});

const item = (productId: string, price: number, qty: number, extra: Partial<CartItem> = {}): CartItem => ({
  key: productId + qty,
  productId,
  name: productId,
  categoryId: null,
  unitPrice: P(price),
  qty,
  free: false,
  freeReason: '',
  designerId: null,
  ...extra,
});

describe('cart', () => {
  it('applies a 4-for bundle automatically', () => {
    const cart = priceCart([item('cat', 20, 4), item('couple', 200, 2), item('pin', 30, 1)], [{ id: 'b', name: 'Cat Meme 4 for ₱75', productIds: ['cat'], qty: 4, price: P(75) }], []);
    expect(cart.subtotal).toBe(P(510));
    expect(cart.bundleTotal).toBe(P(5));
    expect(cart.total).toBe(P(505));
    expect(cart.lines[0].bundleOff).toBe(P(5));
  });
  it('applies the bundle as many times as it fits', () => {
    const cart = priceCart([item('cat', 20, 9)], [{ id: 'b', name: '4 for 75', productIds: ['cat'], qty: 4, price: P(75) }], []);
    expect(cart.bundles[0].times).toBe(2);
    expect(cart.total).toBe(P(75 * 2 + 20));
  });
  it('never applies a bundle that costs the customer more', () => {
    const cart = priceCart([item('cat', 10, 4)], [{ id: 'b', name: 'bad', productIds: ['cat'], qty: 4, price: P(75) }], []);
    expect(cart.bundleTotal).toBe(0);
    expect(cart.total).toBe(P(40));
  });
  it('applies discounts after bundles and never below zero', () => {
    const cart = priceCart([item('a', 100, 1)], [], [
      { id: 'p', label: 'Passport', kind: 'amount', value: P(30) },
      { id: 'x', label: '10%', kind: 'percent', value: 10 },
    ]);
    expect(cart.discountTotal).toBe(P(40));
    expect(cart.total).toBe(P(60));
    const big = priceCart([item('a', 20, 1)], [], [{ id: 'p', label: 'Big', kind: 'amount', value: P(50) }]);
    expect(big.total).toBe(0);
  });
  it('free items cost nothing', () => {
    const cart = priceCart([item('a', 100, 2, { free: true, freeReason: 'Giveaway' })], [], []);
    expect(cart.total).toBe(0);
    expect(cart.itemCount).toBe(2);
  });
  it('checks payments and change', () => {
    const cash = { methodId: 'c', name: 'Cash', kind: 'cash' as const, amount: P(475), tendered: P(500), ref: '' };
    expect(checkPayments(P(475), [cash])).toMatchObject({ ok: true, change: P(25) });
    const split = [
      { ...cash, amount: P(200), tendered: P(200) },
      { methodId: 'g', name: 'GCash', kind: 'ewallet' as const, amount: P(275), tendered: null, ref: '123' },
    ];
    expect(checkPayments(P(475), split).ok).toBe(true);
    expect(checkPayments(P(475), [{ ...cash, amount: P(400), tendered: P(400) }]).ok).toBe(false);
  });
  it('spreads sale discounts across lines so they add up to the total', () => {
    const cart = priceCart([item('a', 100, 1), item('b', 50, 1)], [], [{ id: 'd', label: 'x', kind: 'amount', value: P(30) }]);
    const sale = {
      lines: cart.lines.map((l) => ({ ...l, free: 0 as const, freeReason: '' })),
      total: cart.total,
    };
    const rev = lineRevenue(sale);
    expect(rev.reduce((a, b) => a + b, 0)).toBe(P(120));
    expect(rev).toEqual([P(80), P(40)]);
  });
});

const material = (id: string, packCost: number | null, packQty: number): Material => ({
  id, code: id, name: id, category: '', unit: 'sheet', packQty, packCost: packCost === null ? null : P(packCost), onHand: 0, reorderAt: 0, supplier: '', notes: '', createdAt: 0, updatedAt: 0,
});

describe('production cost', () => {
  const mats = new Map([
    ['vinyl', material('vinyl', 280, 20)], // ₱14/sheet
    ['lam', material('lam', 170, 20)], // ₱8.50/sheet
    ['ink', material('ink', 8, 1)], // ₱8/print
    ['none', material('none', null, 1)],
  ]);
  it('costs a batch like the plan example (₱465 for 55 good stickers)', () => {
    const c = batchCost(
      {
        qtyMade: 60, qtySpoiled: 5,
        materials: [{ materialId: 'vinyl', qty: 4 }, { materialId: 'lam', qty: 4 }, { materialId: 'ink', qty: 4 }],
        laborMinutes: 40, laborRate: P(150), oneTime: P(150), other: 0, overheadPct: 25,
      },
      mats,
    );
    expect(c.total).toBe(P(465));
    expect(c.good).toBe(55);
    expect(c.unit).toBe(845);
  });
  it('costs a recipe and reports missing material costs', () => {
    const r = recipeCost({ items: [{ materialId: 'vinyl', qty: 1 / 15 }, { materialId: 'none', qty: 1 }], laborMinutes: 1, laborRate: P(150), packaging: P(4), spoilagePct: 10, overheadPct: 25 }, mats);
    expect(r.missing).toEqual(['none']);
    expect(Math.round(r.total)).toBe(Math.round(((P(14) / 15 + P(150) / 60) * 1.1 + P(4)) * 1.25));
  });
  it('weights new stock into the average cost', () => {
    expect(weightedAverage(10, P(10), 10, P(20))).toBe(P(15));
    expect(weightedAverage(0, null, 5, P(12))).toBe(P(12));
  });
  it('uses the cost in force at the time of the sale', () => {
    const pts: CostPoint[] = [
      { id: '1', productId: 'x', unitCost: P(10), effectiveFrom: 100, source: 'manual', note: '', createdAt: 0, updatedAt: 0 },
      { id: '2', productId: 'x', unitCost: P(12), effectiveFrom: 200, source: 'batch', note: '', createdAt: 0, updatedAt: 0 },
    ];
    expect(costAt(pts, 150).cost).toBe(P(10));
    expect(costAt(pts, 250).cost).toBe(P(12));
    expect(costAt(pts, 50)).toEqual({ cost: P(10), backfilled: true });
  });
});

describe('sticker job (matches the old STICKER JOB tab)', () => {
  const input: StickerJobInput = {
    sheet: SHEETS[0].spec,
    sheetCost: P(14 + 8.5 + 8),
    refQty: 30,
    spoilagePct: 10,
    designHours: 1,
    designRate: P(150),
    minutesPerSheet: 10,
    productionRate: P(150),
    overheadPct: 25,
    targetMarginPct: 45,
    roundTo: 5,
    baseW: 2,
    baseH: 2,
    manualBasePrice: null,
    sizes: DEFAULT_SIZES,
  };
  it('fits the same number per sheet', () => {
    expect(fitsPerSheet(input.sheet, 2, 2)).toBe(15);
    expect(fitsPerSheet(input.sheet, 1, 1)).toBe(70);
    expect(fitsPerSheet(input.sheet, 3, 3)).toBe(6);
    expect(fitsPerSheet(input.sheet, 4, 4)).toBe(2);
    expect(fitsPerSheet(input.sheet, 6, 6)).toBe(1);
  });
  it('costs ₱13.19 per 2 × 2 at 30 pieces and prices it at ₱25', () => {
    expect(stickerCostPerPiece(input, 15, 30)! / 100).toBeCloseTo(13.1875, 4);
    const list = stickerPriceList(input);
    expect(list.baseAuto).toBe(P(25));
    expect(list.rows.find((r) => r.label === '3 × 3 in')!.price).toBe(P(50));
    expect(list.rows.find((r) => r.label === '1 × 1 in')!.price).toBe(P(15));
  });
  it('quotes a 50-piece order like the sheet (₱465 cost, ₱1,250 price)', () => {
    const list = stickerPriceList(input);
    const q = quoteStickerOrder(input, list.rows.find((r) => r.label === '2 × 2 in')!, 50)!;
    expect(q.sheets).toBe(4);
    expect(Math.round(q.totalCost)).toBe(P(465));
    expect(q.totalPrice).toBe(P(1250));
    expect(q.marginPct!).toBeCloseTo(62.8, 1);
  });
});

describe('service quote (matches the old CALCULATOR tab)', () => {
  it('prices 5 h director + 5 h illustrator at a 45% target margin', () => {
    const r = computeServiceQuote({
      qty: 1, materials: [], outsourced: [], other: [],
      labor: [{ role: 'CD', hours: 5, rate: P(500) }, { role: 'Illustrator', hours: 5, rate: P(350) }],
      overheadPct: 25, method: 'margin', markupPct: 60, marginPct: 45, manualPrice: null, roundTo: 5,
      addons: { rush: false, revision: 0, sourceFiles: false, ipBuyout: false },
      addonPcts: { rush: 25, revision: 15, sourceFiles: 20, ipBuyout: 60 },
      vatRegistered: false, vatPct: 12, ewt: true, ewtPct: 2, minMarginPct: 30,
    });
    expect(r.totalCost).toBe(P(5312.5));
    expect(r.pricePerPc).toBe(P(9660));
    expect(r.ewt).toBe(P(193.2));
    expect(r.health).toBe('healthy');
  });
  it('judges a client-named price', () => {
    expect(reverseCheck(P(250), P(150), 30).verdict).toBe('ok');
    expect(reverseCheck(P(160), P(150), 30).verdict).toBe('thin');
    expect(reverseCheck(P(140), P(150), 30).verdict).toBe('loss');
  });
  it('booth pricing matches the plan page example', () => {
    const b = boothPricing({ fixedCosts: P(3000), unitCost: P(9), price: P(25), expectedQty: 150, targetProfit: P(1500), roundTo: 5 });
    expect(b.breakEven).toBe(188);
    expect(b.floor).toBe(P(29));
    expect(b.floorRounded).toBe(P(30));
    expect(b.targetPrice).toBe(P(40));
    expect(b.projected).toBe(-P(600));
  });
});

const base = { createdAt: 0, updatedAt: 0 };
const event: JWEvent = {
  ...base, id: 'e', name: 'Test', organizer: '', venue: '', boothNo: '', startDate: '2026-10-01', endDate: '2026-10-01', status: 'live',
  paymentMethodIds: [], openingFloat: P(2000), discounts: [], cashierDiscountLimitPct: 10,
  targets: { sales: null, items: null, leads: null },
  share: { joshworksPct: 40, poolMode: 'all', weightMode: 'weighthours', minGuarantee: null, topUp: false, royaltiesBeforePool: true },
  counters: { leads: 0, orgOfficers: 0 }, notes: '',
};

const sale = (id: string, lines: [string, number, number][], at = 1000): Sale => {
  const ls = lines.map(([productId, price, qty]) => ({ productId, name: productId, categoryId: null, qty, unitPrice: P(price), gross: P(price) * qty, bundleOff: 0, free: 0 as const, freeReason: '', designerId: null }));
  const total = ls.reduce((a, l) => a + l.gross, 0);
  return {
    ...base, id, eventId: 'e', sessionId: 's', deviceId: 'd', receiptNo: id, at, cashierId: null, lines: ls, subtotal: total, discountTotal: 0, discounts: [], total,
    payments: [{ methodId: 'cash', name: 'Cash', kind: 'cash', amount: total, tendered: total, ref: '' }], change: 0, note: '', status: 'completed', voidedAt: null, voidedBy: null, voidReason: '',
  };
};

describe('profit share (plan example)', () => {
  const members = new Map<string, Member>(
    ['prod', 'ill', 'cash', 'float', 'partner'].map((id) => [id, { ...base, id, name: id, email: '', appRole: 'designer', roleLabel: id, weight: 1, active: 1, phone: '', payoutInfo: '', notes: '' }]),
  );
  const roster: RosterEntry[] = [
    ['prod', 3, '09:00', '17:00'], ['ill', 3, '09:00', '17:00'], ['cash', 2, '09:00', '17:00'], ['float', 2, '13:00', '17:00'],
  ].map(([memberId, weight, start, end]) => ({ ...base, id: 'r' + memberId, eventId: 'e', memberId: memberId as string, roleLabel: memberId as string, weight: weight as number, shifts: [{ date: '2026-10-01', start: start as string, end: end as string }], hoursOverride: null, inPool: 1 }));
  const products = new Map<string, Product>();
  // ₱10,000 gross: 400 × ₱25 items costing ₱6.50 → ₱2,600 production cost
  const sales = [sale('s1', [['item', 25, 400]])];
  const spend: SpendItem[] = [
    { ...base, id: 'fee', eventId: 'e', type: 'booth_fee', name: 'Booth', qty: 1, unitCost: P(2000), status: 'bought', amortizeEvents: 1, materialId: null, stocked: 0, pctUsed: 0, paidBy: null, reimbursed: 0, photoId: null, notes: '' },
    { ...base, id: 'tr', eventId: 'e', type: 'consumable', name: 'Transport', qty: 1, unitCost: P(600), status: 'bought', amortizeEvents: 1, materialId: null, stocked: 0, pctUsed: 0, paidBy: null, reimbursed: 0, photoId: null, notes: '' },
    { ...base, id: 'st', eventId: 'e', type: 'asset', name: 'Stands', qty: 2, unitCost: P(1000), status: 'bought', amortizeEvents: 5, materialId: null, stocked: 0, pctUsed: 0, paidBy: null, reimbursed: 0, photoId: null, notes: '' },
    { ...base, id: 'vi', eventId: 'e', type: 'material', name: 'Vinyl', qty: 3, unitCost: P(280), status: 'bought', amortizeEvents: 1, materialId: null, stocked: 0, pctUsed: 40, paidBy: null, reimbursed: 0, photoId: null, notes: '' },
    { ...base, id: 'tb', eventId: 'e', type: 'consumable', name: 'Tarp', qty: 1, unitCost: P(150), status: 'to_buy', amortizeEvents: 1, materialId: null, stocked: 0, pctUsed: 0, paidBy: null, reimbursed: 0, photoId: null, notes: '' },
  ];
  it('computes event costs by type', () => {
    const c = eventCosts(spend, 'all');
    expect(c.boothFee).toBe(P(2000));
    expect(c.consumables).toBe(P(600));
    expect(c.assets).toBe(P(400));
    expect(c.total).toBe(P(3000));
    expect(c.materialsBought).toBe(P(840));
    expect(c.planned).toBe(P(150));
  });
  it('runs the waterfall and splits by weight × hours', () => {
    const r = computeShare({
      event, sales, products, members, roster, spend,
      costOf: () => ({ cost: 650, backfilled: false }),
      deals: [{ ...base, id: 'd', eventId: 'e', partnerId: 'partner', name: 'Co-brand', productIds: ['item'], basis: 'gross', mode: 'fixed', fixedPct: 4, tiers: [] }],
      eventProducts: [],
    });
    expect(r.gross).toBe(P(10000));
    expect(r.cogs).toBe(P(2600));
    expect(r.partnerTotal).toBe(P(400));
    expect(r.tradingProfit).toBe(P(7000));
    expect(r.pool).toBe(P(4000));
    expect(r.joshworks).toBe(P(1600));
    expect(r.staffPool).toBe(P(2400));
    expect(r.staff.map((s) => s.amount)).toEqual([P(800), P(800), 53333, 26667]);
  });
  it('flags products sold without a cost', () => {
    const r = computeShare({ event, sales, products, members, roster: [], spend: [], costOf: () => ({ cost: null, backfilled: false }), deals: [], eventProducts: [] });
    expect(r.cogsMissing).toHaveLength(1);
    expect(r.warnings.join(' ')).toMatch(/without a production cost/);
  });
  it('uses tiered partner shares by sell-through (Westival style)', () => {
    const r = computeShare({
      event, sales: [sale('s', [['pin', 30, 26]])], products, members, roster: [], spend: [],
      costOf: () => ({ cost: P(24), backfilled: false }),
      deals: [{ ...base, id: 'd', eventId: 'e', partnerId: 'partner', name: 'Pins', productIds: ['pin'], basis: 'net', mode: 'tiered', fixedPct: 0, tiers: [{ minPct: 0, partnerPct: 15 }, { minPct: 26, partnerPct: 25 }, { minPct: 40, partnerPct: 40 }, { minPct: 70, partnerPct: 55 }] }],
      eventProducts: [{ ...base, id: 'ep', eventId: 'e', productId: 'pin', price: null, active: 1, stockBrought: 30 }],
    });
    // 26 of 30 sold = 86.7% → 55% of net (26 × ₱6 = ₱156) = ₱85.80, like the tracker
    expect(r.partners[0].pct).toBe(55);
    expect(r.partners[0].amount).toBe(8580);
  });
  it('tops up anyone below the minimum guarantee from the JoshWorks share', () => {
    const r = computeShare({
      event: { ...event, share: { ...event.share, minGuarantee: P(500), topUp: true } },
      sales, products, members, roster, spend,
      costOf: () => ({ cost: 650, backfilled: false }), deals: [], eventProducts: [],
    });
    const floater = r.staff.find((s) => s.memberId === 'float')!;
    expect(floater.belowMin).toBe(true);
    expect(floater.amount).toBe(P(500));
    expect(r.joshworksNet).toBe(r.joshworks - r.topUpTotal);
  });
});

describe('cash drawer', () => {
  it('expects float + cash sales + cash in − cash out', () => {
    const session: Session = { ...base, id: 's', eventId: 'e', deviceId: 'd', letter: 'A', openedAt: 0, openedBy: null, openingFloat: P(2000), cashMoves: [{ id: 'm', at: 1, kind: 'out', amount: P(100), reason: 'Water', by: null }], closedAt: null, closedBy: null, counted: null, countedTotal: null, expected: null, notes: '' };
    const d = drawerState(session, [sale('a', [['x', 100, 2]]), { ...sale('b', [['x', 50, 1]]), status: 'voided' }]);
    expect(d.expected).toBe(P(2100));
  });
  it('counts denominations', () => {
    expect(countTotal({ '1000': 2, '100': 3, '1': 4, '0.25': 2 })).toBe(P(2304.5));
  });
});
