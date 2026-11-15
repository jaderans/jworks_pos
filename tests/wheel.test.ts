import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { alive, db } from '../src/db/db';
import { ensureDevice } from '../src/db/local';
import { setWriterDevice } from '../src/db/write';
import { toCents } from '../src/lib/money';
import { priceCart } from '../src/domain/cart';
import { onHandByProduct } from '../src/domain/stock';
import { eventMetrics } from '../src/domain/summary';
import { landingTurn, pickPrize, pickText, spinsFor, spinsLeft, spinsText, tryAgainChance, wheelProblem, wheelQualifies, wheelRuleText, wheelSlices, winsToday, type WheelConfig, type WheelPrize } from '../src/domain/wheel';
import { createProduct } from '../src/services/catalog';
import { createEvent, updateEvent } from '../src/services/events';
import { completeSale, openSession } from '../src/services/sales';
import { adjustStock } from '../src/services/production';
import { spinWheel } from '../src/services/wheel';
import type { Sale } from '../src/db/types';

const P = toCents;
const couple: WheelPrize = { id: 'couple', label: 'Free Couple Pack', kind: 'item', productId: 'p-couple', voucher: null, chance: 10, perDay: 5 };
const off20: WheelPrize = { id: 'off20', label: '₱20 off', kind: 'voucher', productId: null, voucher: { kind: 'amount', value: P(20) }, chance: 30, perDay: null };
const cfg = (over: Partial<WheelConfig> = {}): WheelConfig => ({ on: true, minSpend: P(250), minItems: { count: 15, categoryId: 'sticker' }, prizes: [couple, off20], ...over });
const sale = (over: Partial<Sale>): Sale => ({ id: 's', status: 'completed', deleted: 0, total: 0, lines: [], ...over }) as Sale;
const line = (qty: number, categoryId: string | null, free = false) => ({ productId: 'x', name: 'x', categoryId, qty, unitPrice: P(10), gross: P(10) * qty, bundleOff: 0, free: (free ? 1 : 0) as 0 | 1, freeReason: '', designerId: null });

describe('the prize wheel', () => {
  it('spins after ₱250, or after 15 items of the category; never for deposits, prizes or twice', () => {
    expect(wheelQualifies(sale({ total: P(250) }), cfg())).toBe(true);
    expect(wheelQualifies(sale({ total: P(249) }), cfg())).toBe(false);
    expect(wheelQualifies(sale({ total: P(150), lines: [line(15, 'sticker')] }), cfg())).toBe(true);
    expect(wheelQualifies(sale({ total: P(150), lines: [line(14, 'sticker'), line(5, 'pins')] }), cfg())).toBe(false);
    expect(wheelQualifies(sale({ total: P(150), lines: [line(10, 'sticker'), line(5, 'sticker', true)] }), cfg())).toBe(false);
    expect(wheelQualifies(sale({ total: P(300), kind: 'deposit' }), cfg())).toBe(false);
    expect(wheelQualifies(sale({ total: P(300), prizeFor: 'other' }), cfg())).toBe(false);
    expect(wheelQualifies(sale({ total: P(300), wheel: { prizeId: null, label: 'Try again', at: 1 } }), cfg())).toBe(false);
    expect(wheelQualifies(sale({ total: P(300) }), cfg({ on: false }))).toBe(false);
    expect(wheelRuleText(cfg(), [{ id: 'sticker', name: 'Sticker' }])).toBe('Spend ₱250 or buy 15 Sticker items');
  });

  it('each prize owns a band as wide as its chance; a prize at its daily limit is "Try again"', () => {
    expect(pickPrize(cfg(), new Map(), 0.05)?.id).toBe('couple');
    expect(pickPrize(cfg(), new Map(), 0.1)?.id).toBe('off20');
    expect(pickPrize(cfg(), new Map(), 0.39)?.id).toBe('off20');
    expect(pickPrize(cfg(), new Map(), 0.4)).toBeNull();
    // The 5 free Couple Packs are gone today: its band is "Try again", and ₱20 off keeps its 30%.
    expect(pickPrize(cfg(), new Map([['couple', 5]]), 0.05)).toBeNull();
    expect(pickPrize(cfg(), new Map([['couple', 5]]), 0.2)?.id).toBe('off20');
    expect(tryAgainChance(cfg())).toBe(60);
    const today = new Date('2026-11-14T15:00:00').getTime();
    const wins = winsToday([sale({ wheel: { prizeId: 'couple', label: '', at: today } }), sale({ wheel: { prizeId: 'couple', label: '', at: today - 86_400_000 } })], '2026-11-14');
    expect(wins.get('couple')).toBe(1);
  });

  it('draws slices as wide as their chances, and stops inside the slice won', () => {
    const slices = wheelSlices(cfg());
    expect(slices.map((s) => [s.label, s.from, s.to])).toEqual([['Free Couple Pack', 0, 36], ['₱20 off', 36, 144], ['Try again', 144, 360]]);
    for (const [id, r] of [['couple', 0], ['couple', 0.99], ['off20', 0.5], [null, 0.3]] as const) {
      const turn = landingTurn(slices, id, r);
      const atTop = (360 - (turn % 360)) % 360;
      const s = slices.find((x) => x.id === id)!;
      expect(atTop).toBeGreaterThanOrEqual(s.from);
      expect(atTop).toBeLessThanOrEqual(s.to);
      expect(turn).toBeGreaterThan(6 * 360 - 1);
    }
  });

  it('says what’s wrong with a setup', () => {
    expect(wheelProblem(cfg())).toBeNull();
    expect(wheelProblem(cfg({ minSpend: null, minItems: null }))).toMatch(/when the wheel spins/);
    expect(wheelProblem(cfg({ prizes: [{ ...couple, chance: 80 }, off20] }))).toMatch(/add up to 110%/);
    expect(wheelProblem(cfg({ prizes: [{ ...couple, productId: null }] }))).toMatch(/Pick the product/);
    expect(wheelProblem(cfg({ spins: { per: 'sale', count: 0 } }))).toMatch(/Spins: from 1/);
    expect(wheelProblem(cfg({ prizes: [{ ...pile, pick: { count: 0, what: 'sticker' } }] }))).toMatch(/how many Free sticker lets them pick/);
  });
});

const spinAgain: WheelPrize = { id: 'again', label: 'Free spin', kind: 'spin', productId: null, voucher: null, chance: 20, perDay: null };
const pile: WheelPrize = { id: 'pile', label: 'Free sticker', kind: 'pick', productId: null, voucher: null, pick: { count: 1, what: 'sticker' }, chance: 30, perDay: null };

describe('how many spins', () => {
  it('a set number a sale, or one for every mark reached up to the most', () => {
    expect(spinsFor(cfg(), sale({ total: P(800) }))).toBe(1);
    expect(spinsFor(cfg({ spins: { per: 'sale', count: 2 } }), sale({ total: P(260) }))).toBe(2);
    expect(spinsFor(cfg({ spins: { per: 'sale', count: 2 } }), sale({ total: P(200) }))).toBe(0);
    const marks = cfg({ spins: { per: 'mark', count: 3 } });
    expect(spinsFor(marks, sale({ total: P(249) }))).toBe(0);
    expect(spinsFor(marks, sale({ total: P(250) }))).toBe(1);
    expect(spinsFor(marks, sale({ total: P(510) }))).toBe(2);
    expect(spinsFor(marks, sale({ total: P(2000) }))).toBe(3);
    // By items too: whichever mark gives more.
    expect(spinsFor(marks, sale({ total: P(300), lines: [line(30, 'sticker')] }))).toBe(2);
    expect(spinsText(marks)).toBe('One spin for every ₱250 or 15 items, up to 3');
    expect(spinsText(cfg())).toBe('');
    expect(spinsText(cfg({ spins: { per: 'sale', count: 2 } }))).toBe('2 spins a sale');
  });

  it('counts down as they spin; a free spin adds one; what it earned stays fixed', () => {
    const marks = cfg({ spins: { per: 'mark', count: 3 } });
    const r = (prizeId: string | null, again = false) => ({ prizeId, label: '', at: 1, ...(again ? { again } : {}) });
    expect(spinsLeft(sale({ total: P(510) }), marks)).toBe(2);
    expect(spinsLeft(sale({ total: P(510), wheelSpins: { earned: 2, results: [r(null)] } }), marks)).toBe(1);
    expect(spinsLeft(sale({ total: P(510), wheelSpins: { earned: 2, results: [r('again', true), r(null)] } }), marks)).toBe(1);
    expect(spinsLeft(sale({ total: P(510), wheelSpins: { earned: 2, results: [r(null), r(null)] } }), marks)).toBe(0);
    // The wheel changed after the first spin: the sale keeps what it earned.
    expect(spinsLeft(sale({ total: P(510), wheelSpins: { earned: 2, results: [r(null)] } }), cfg())).toBe(1);
    // Every spin's wins count toward the daily limits.
    const today = new Date('2026-11-14T15:00:00').getTime();
    const two = sale({ wheelSpins: { earned: 2, results: [{ prizeId: 'pile', label: '', at: today }, { prizeId: 'pile', label: '', at: today }] } });
    expect(winsToday([two], '2026-11-14').get('pile')).toBe(2);
  });

  it('a pick from the pile says how many', () => {
    expect(pickText(pile)).toBe('1 sticker');
    expect(pickText({ pick: { count: 3, what: 'stickers' } })).toBe('3 stickers');
    expect(pickText({ pick: { count: 2, what: '' } })).toBe('2 stickers');
  });
});

describe('spinning at the register', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    setWriterDevice((await ensureDevice()).deviceId);
  });

  async function setup(prizes: WheelPrize[], more: Partial<WheelConfig> = {}) {
    const device = await ensureDevice();
    const ev = await createEvent({ name: 'Hilway' });
    const pack = await createProduct({ name: 'Couple Pack (live)', price: P(240), trackStock: 1 });
    await adjustStock(pack.id, 10, 'Counted');
    const session = await openSession(ev.id, device, P(2000), null);
    await updateEvent(ev.id, { wheel: { on: true, minSpend: P(250), minItems: null, prizes: prizes.map((p) => (p.kind === 'item' ? { ...p, productId: pack.id } : p)), ...more } });
    const sell = (total: number) =>
      completeSale({
        eventId: ev.id, session, device, cashierId: null, note: '',
        priced: priceCart([{ key: 'k', productId: pack.id, name: 'Couple Pack (live)', categoryId: null, unitPrice: P(total), qty: 1, free: false, freeReason: '', designerId: null }], [], []),
        payments: [{ methodId: 'cash', name: 'Cash', kind: 'cash', amount: P(total), tendered: P(total), ref: '' }],
      });
    return { device, session, pack, sell, ev: async () => (await db.events.get(ev.id))! };
  }

  it('a product prize is a ₱0 sale that takes it out of stock; it spins once, and stops at its daily limit', async () => {
    const { device, session, pack, sell, ev } = await setup([{ ...couple, chance: 100, perDay: 1 }]);
    const first = await sell(300);
    const spin = await spinWheel({ ev: await ev(), saleId: first.id, session, device, by: null });
    expect(spin.label).toBe('Free Couple Pack');
    expect(spin.prizeSale).toMatchObject({ total: 0, prizeFor: first.id, lines: [expect.objectContaining({ productId: pack.id, free: 1, gross: 0 })] });
    expect((await db.sales.get(first.id))?.wheel).toMatchObject({ prizeId: 'couple', label: 'Free Couple Pack' });
    expect(onHandByProduct(alive(await db.stockMoves.toArray())).get(pack.id)).toBe(8);
    await expect(spinWheel({ ev: await ev(), saleId: first.id, session, device, by: null })).rejects.toThrow(/used all its spins/);

    const second = await sell(300);
    const again = await spinWheel({ ev: await ev(), saleId: second.id, session, device, by: null });
    expect(again.prize).toBeNull();
    expect(again.label).toBe('Try again');
    const m = eventMetrics(alive(await db.sales.toArray()), []);
    expect([m.gross, m.freeItems]).toEqual([P(600), 1]);
  });

  it('a service prize is a free service order to make, and a ₱0 Services sale in the log; nothing comes out of stock', async () => {
    const svc: WheelPrize = { id: 'art', label: 'Free illustration', kind: 'service', productId: null, voucher: null, service: { label: 'Sticker illustration, simple (1 design)', value: P(100) }, chance: 100, perDay: null };
    const { device, session, pack, sell, ev } = await setup([svc]);
    const s = await sell(300);
    const spin = await spinWheel({ ev: await ev(), saleId: s.id, session, device, by: null });
    const orders = alive(await db.printOrders.toArray());
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ customerName: `Wheel winner (${s.receiptNo})`, lines:[expect.objectContaining({ unitPrice: 0, label: 'Sticker illustration, simple (1 design) · wheel prize, worth ₱100' })] });
    expect(spin.prizeSale).toMatchObject({ total: 0, kind: 'service', prizeFor: s.id, printOrderId: orders[0].id });
    expect(spin.detail).toContain(orders[0].number);
    expect(onHandByProduct(alive(await db.stockMoves.toArray())).get(pack.id)).toBe(9);
  });

  it('a discount prize is a one-time voucher code for this event', async () => {
    const { device, session, sell, ev } = await setup([{ ...off20, chance: 100 }]);
    const s = await sell(260);
    const spin = await spinWheel({ ev: await ev(), saleId: s.id, session, device, by: null });
    expect(spin.voucher).toMatchObject({ kind: 'amount', value: P(20), maxUses: 1, eventId: (await ev()).id });
    expect(spin.voucher?.code).toMatch(/^WIN-[A-Z2-9]{5}$/);
    expect(spin.detail).toContain(spin.voucher!.code);
    await expect(spinWheel({ ev: await ev(), saleId: (await sell(100)).id, session, device, by: null })).rejects.toThrow(/doesn’t qualify/);
  });

  it('spins as many times as the sale earned, plus a free spin it lands on; then no more', async () => {
    const { device, session, sell, ev } = await setup([{ ...spinAgain, chance: 100, perDay: 1 }], { spins: { per: 'mark', count: 3 } });
    const s = await sell(520);
    const one = await spinWheel({ ev: await ev(), saleId: s.id, session, device, by: null });
    expect([one.label, one.nth, one.left]).toEqual(['Free spin', 1, 2]);
    expect(one.detail).toMatch(/Another spin/);
    // The one free spin today is gone: these land on Try again.
    const two = await spinWheel({ ev: await ev(), saleId: s.id, session, device, by: null });
    const three = await spinWheel({ ev: await ev(), saleId: s.id, session, device, by: null });
    expect([two.label, two.left, three.nth, three.left]).toEqual(['Try again', 1, 3, 0]);
    await expect(spinWheel({ ev: await ev(), saleId: s.id, session, device, by: null })).rejects.toThrow(/used all its spins/);
    const saved = await db.sales.get(s.id);
    expect(saved?.wheelSpins?.earned).toBe(2);
    expect(saved?.wheelSpins?.results.map((x) => x.label)).toEqual(['Free spin', 'Try again', 'Try again']);
    expect(saved?.wheel?.label).toBe('Free spin');
  });

  it('a pick from the pile tells the cashier how many; nothing comes out of stock', async () => {
    const { device, session, pack, sell, ev } = await setup([{ ...pile, chance: 100, pick: { count: 2, what: 'sticker' } }]);
    const s = await sell(300);
    const spin = await spinWheel({ ev: await ev(), saleId: s.id, session, device, by: null });
    expect(spin.detail).toBe('Let them pick 2 stickers from the prize pile.');
    expect(spin.prizeSale).toBeUndefined();
    expect(spin.won).toEqual(['Free sticker']);
    expect(onHandByProduct(alive(await db.stockMoves.toArray())).get(pack.id)).toBe(9);
  });
});
