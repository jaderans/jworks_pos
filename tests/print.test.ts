import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { alive, db } from '../src/db/db';
import { ensureDevice } from '../src/db/local';
import { setWriterDevice } from '../src/db/write';
import { toCents } from '../src/lib/money';
import {
  DEFAULT_PRINT_RATES as R, addWorkingDays, customLine, illustrationLine, illustrationPrice, packLine, peelLine, perSheet, printTotals, printWarnings, sheetsForStickers, sheetsLine, stickerFit, upgradePrintRates,
} from '../src/domain/print';
import { buildPrintFeed } from '../src/domain/studioFeed';
import { getSetting, setSetting } from '../src/db/settings';
import { blankDelivery, createPrintOrder, deletePrintOrder, setPrintStatus, takePrintPayment, updatePrintOrder } from '../src/services/print';
import type { Member, PrintRates } from '../src/db/types';

const P = toCents;

beforeEach(async () => {
  await db.delete();
  await db.open();
  setWriterDevice((await ensureDevice()).deviceId);
});

describe('the sticker printing rate card', () => {
  it('prices sheets like the rate sheet’s sample: 5 × (₱80 + ₱10) = ₱450', () => {
    const l = sheetsLine(R, 'prem-matte-glossy', 'die', 5);
    expect([l.unitPrice, l.qty, l.a4]).toEqual([P(90), 5, 5]);
    expect(printTotals({ lines: [l], delivery: blankDelivery(), payments: [], printerPct: 20 }, 50)).toMatchObject({ subtotal: P(450), total: P(450), down: P(225), printerShare: P(90), a4: 5 });
    // A size shows how many stickers that is
    expect(sheetsLine(R, 'std-matte-glossy', 'kiss', 3, '2 × 2 in').label).toContain('about 45 stickers');
  });

  it('peel-off sheets share one A4 and its peel-off cut: (₱80 + ₱17) ÷ 4', () => {
    const l = peelLine(R, 'prem-matte-glossy', '3.5x5', 20);
    expect(l.unitPrice).toBe(P(24.25));
    expect(l.a4).toBe(5);
    expect(l.packSize).toBe('small');
    expect(packLine(R, 'full-lam', 'small', 20).unitPrice).toBe(P(20));
  });

  it('adds the courier fee, rounds the down payment up to ₱5, and keeps the printer’s share off the delivery fee', () => {
    const t = printTotals({ lines: [sheetsLine(R, 'prem-holo', 'kiss', 3), customLine('Label layout', 1, P(217))], delivery: { ...blankDelivery(), method: 'courier', fee: P(120), address: 'Jaro' }, payments: [], printerPct: 20 }, 50);
    expect(t).toMatchObject({ subtotal: P(487), delivery: P(120), total: P(607), down: P(305), printerShare: P(97.4) });
  });

  it('warns about the minimums', () => {
    expect(printWarnings({ lines: [sheetsLine(R, 'std-matte-glossy', 'kiss', 2)] }, R)).toEqual(['The minimum order is 3 A4 sheets; this is 2.']);
    expect(printWarnings({ lines: [sheetsLine(R, 'std-matte-glossy', 'kiss', 3), packLine(R, 'sleeve', 'small', 10)] }, R)[0]).toMatch(/at least 20 packs/);
  });

  it('counts working days, skipping weekends', () => {
    // Friday + 7 working days = Tuesday the week after next
    expect(addWorkingDays('2026-11-06', 7)).toBe('2026-11-17');
    expect(addWorkingDays('2026-11-09', 4)).toBe('2026-11-13');
  });
});

describe('sticker sizes inside the Cricut cut area', () => {
  it('counts the rate sheet’s size guide from Cricut’s A4 area (7.2 × 10.62 in, 3 mm apart)', () => {
    const counts = Object.fromEntries(R.stickerSizes.map((s) => [s.name, perSheet(R, s.w, s.h)]));
    // The rate sheet's own numbers, with its two inch typos read from the cm column (5.1 × 6.4 and 5.1 × 7.6 cm).
    expect(counts).toEqual({
      '1 × 1 in': 54, '1.5 × 1.5 in': 24, '2 × 2 in': 15, '2.5 × 2.5 in': 8, '3 × 3 in': 6, '3.5 × 3.5 in': 4, '4 × 4 in': 2,
      '2 × 2.5 in': 12, '2 × 3 in': 10, '3 × 4 in': 4, '1 × 3 in strip': 18,
    });
  });

  it('is the STICKER JOB formula, trying the sticker both ways round', () => {
    // The spreadsheet's plain A4 with 5 mm margins: 200 × 287 mm usable, 3 mm gutter → 70 of 1 × 1, 6 of the 4 × 2 base.
    const plain = { w: 200 / 25.4, h: 287 / 25.4, gapMm: 3 };
    expect(stickerFit(plain, 1, 1).perA4).toBe(70);
    expect(stickerFit(plain, 4, 2).perA4).toBe(6);
    // A customer's 2.3 × 1.7 in fits 15 upright but 16 turned sideways.
    expect(stickerFit(R.cutArea, 2.3, 1.7)).toEqual({ perA4: 16, across: 4, down: 4, rotated: true });
    // Too big, or no size: none.
    expect(perSheet(R, 8, 8)).toBe(0);
    expect(perSheet(R, 0, 2)).toBe(0);
    // The Cricut border costs stickers: the older 6.75 × 9.25 in area fits 12 of 2 × 2, not 15.
    expect(stickerFit({ w: 6.75, h: 9.25, gapMm: 3 }, 2, 2).perA4).toBe(12);
  });

  it('works out the sheets from a sticker count, with the spares', () => {
    expect(sheetsForStickers(50, 16)).toEqual({ sheets: 4, made: 64, spare: 14 });
    expect(sheetsForStickers(45, 15)).toEqual({ sheets: 3, made: 45, spare: 0 });
    const l = sheetsLine(R, 'prem-matte-glossy', 'kiss', 1, { w: 2.3, h: 1.7 }, 50);
    expect(l).toMatchObject({ qty: 4, a4: 4, unitPrice: P(80), size: '2.3 × 1.7 in', w: 2.3, h: 1.7, stickers: 50 });
    expect(l.label).toBe('Premium Matte or Glossy, kiss cut · 2.3 × 1.7 in: 50 stickers, 64 fit on 4 sheets');
    // By sheets, a custom size says about how many.
    expect(sheetsLine(R, 'std-matte-glossy', 'kiss', 3, { w: 2.3, h: 1.7 }).label).toContain('2.3 × 1.7 in, about 48 stickers');
    expect(sheetsLine(R, 'std-matte-glossy', 'kiss', 3, { w: 9, h: 9 }).label).toContain('too big for one sheet');
  });

  it('upgrades a rate card saved before sizes had inches, keeping what the owner changed', async () => {
    const old = {
      ...R,
      ratesVersion: undefined,
      cutArea: undefined,
      stickerSizes: ['1 × 1 in', '1.5 × 1.5 in', '2 × 2 in', '2.5 × 2.5 in', '3 × 3 in', '3.5 × 3.5 in', '4 × 4 in', '2 × 1.5 in', '2.5 × 3 in', '3 × 4 in', '1 × 3 in strip'].map((name) => ({ name, perA4: 1 })),
      illustration: {
        artistPct: 30,
        tiers: [
          { ...R.illustration.tiers[0], price: P(100), sets: [{ designs: 2, price: P(180) }, { designs: 5, price: P(450) }, { designs: 10, price: P(850) }] },
          // The owner had set the detailed design to ₱240: it stays.
          { ...R.illustration.tiers[1], price: P(240), sets: [{ designs: 2, price: P(390) }, { designs: 5, price: P(950) }, { designs: 10, price: P(1700) }] },
        ],
      },
    } as unknown as PrintRates;
    await setSetting('printRates', old);
    const r = await getSetting<PrintRates>('printRates');
    expect(r.ratesVersion).toBe(2);
    expect(r.cutArea).toEqual({ w: 7.2, h: 10.62, gapMm: 3 });
    expect(r.stickerSizes.map((s) => s.name)).toContain('2 × 2.5 in');
    expect(r.stickerSizes.every((s) => s.w > 0 && s.h > 0)).toBe(true);
    expect(r.illustration.artistPct).toBe(30);
    expect(r.illustration.tiers.map((t) => [t.price, ...t.sets.map((s) => s.price)])).toEqual([
      [P(130), P(240), P(600), P(1150)],
      [P(240), P(450), P(1100), P(2000)],
    ]);
    // An edited size list keeps its sizes, now with inches; a saved version 2 card is left alone.
    expect(upgradePrintRates({ stickerSizes: [{ name: '2 × 1.5 in', perA4: 9 }] } as never)).toMatchObject({ stickerSizes: [{ name: '2 × 1.5 in', w: 2, h: 1.5 }] });
    const v2 = { ...R, illustration: { ...R.illustration, tiers: [{ ...R.illustration.tiers[0], price: P(100) }] } };
    expect(upgradePrintRates(v2).illustration.tiers[0].price).toBe(P(100));
  });
});

describe('sticker illustration', () => {
  const [simple, detailed] = R.illustration.tiers;

  it('prices designs from the rate card: ₱130 simple, ₱250 detailed, cheaper in sets', () => {
    expect([1, 2, 5, 10].map((n) => illustrationPrice(simple, n).total)).toEqual([P(130), P(240), P(600), P(1150)]);
    expect([1, 2, 5, 10].map((n) => illustrationPrice(detailed, n).total)).toEqual([P(250), P(450), P(1100), P(2000)]);
    // Each set saves what the rate sheet says.
    expect([2, 5, 10].map((n) => illustrationPrice(detailed, n).saved)).toEqual([P(50), P(150), P(500)]);
  });

  it('mixes sets and single designs for the lowest price, and never charges more than singles', () => {
    expect(illustrationPrice(simple, 7).total).toBe(P(840));
    expect(illustrationPrice(detailed, 3).total).toBe(P(700));
    expect(illustrationPrice(detailed, 12).total).toBe(P(2450));
    // A set priced above its singles is skipped.
    expect(illustrationPrice({ price: P(220), sets: [{ designs: 2, price: P(450) }] }, 2).total).toBe(P(440));
  });

  it('is one line per tier, with the price changeable on the order', () => {
    expect(illustrationLine(R, 'detailed', 5)).toMatchObject({ kind: 'illustration', label: 'Sticker illustration, detailed: 5 designs', qty: 1, unitPrice: P(1100), tier: 'detailed', designs: 5 });
    expect(illustrationLine(R, 'simple', 1, P(80)).unitPrice).toBe(P(80));
  });

  it('the illustrator’s share is of the illustration, the printer’s of the print work, both after their part of the coupon', () => {
    const t = printTotals(
      { lines: [customLine('Print', 1, P(1000)), illustrationLine(R, 'simple', 1, P(500))], delivery: blankDelivery(), payments: [], printerPct: 20, illustratorPct: 40, coupon: { couponId: 'c', code: 'X', discount: P(300) } },
      50,
    );
    expect([t.subtotal, t.illustration, t.discount, t.total]).toEqual([P(1500), P(500), P(300), P(1200)]);
    // The coupon comes off in proportion: ₱200 off the print work, ₱100 off the illustration.
    expect([t.printerShare, t.illustratorShare]).toEqual([P(160), P(160)]);
  });

  it('goes to Studio with who drew it and their share', () => {
    const order = { id: 'o', number: 'PA-002', customerId: null, customerName: 'Mira', contact: '', lines: [illustrationLine(R, 'detailed', 2)], delivery: blankDelivery(), status: 'quote', statusAt: 0, proofAt: null, approvedAt: null, dueDate: '', printerId: null, printerPct: 20, illustratorId: 'm2', illustratorPct: 50, payments: [], files: '', notes: '', doneAt: null, createdAt: 0, updatedAt: 0 } as never;
    const artist = { id: 'm2', name: 'Ian', email: 'ian@example.com' } as Member;
    expect(buildPrintFeed({ order, downPct: 50, customer: undefined, printer: undefined, illustrator: artist })).toMatchObject({ illustrator: { memberId: 'm2', name: 'Ian' }, illustratorPct: 50, illustratorShare: P(225), printerShare: 0 });
  });
});

describe('print orders', () => {
  async function order() {
    const device = await ensureDevice();
    return { device, o: await createPrintOrder({ customerId: null, customerName: 'Mira Bakeshop', contact: '0917', lines: [sheetsLine(R, 'paper-label', 'kiss', 10, '2 × 2 in')], delivery: blankDelivery(), printerId: null, files: '', notes: '' }, device) };
  }
  const gcash = { methodId: 'gcash', name: 'GCash', kind: 'ewallet' as const, ref: '1234', by: null };

  it('numbers orders with the register letter and takes the down payment, then the balance', async () => {
    const { o, device } = await order();
    expect(o.number).toBe(`P${device.letter}-001`);
    expect(o.status).toBe('quote');
    await takePrintPayment(o.id, { ...gcash, amount: P(300) }, null);
    await expect(takePrintPayment(o.id, { ...gcash, amount: P(301) }, null)).rejects.toThrow(/more than the ₱300/);
    await takePrintPayment(o.id, { ...gcash, amount: P(300) }, null);
    const after = (await db.printOrders.get(o.id))!;
    expect(after.payments.map((p) => [p.stage, p.amount])).toEqual([['down', P(300)], ['balance', P(300)]]);
    await setPrintStatus(o.id, 'done');
    expect((await db.printOrders.get(o.id))?.doneAt).toBeTypeOf('number');
  });

  it('deletes an order, with the payments on it', async () => {
    const { o } = await order();
    await takePrintPayment(o.id, { ...gcash, amount: P(100) }, null);
    await deletePrintOrder(o.id);
    expect(alive(await db.printOrders.toArray())).toEqual([]);
  });

  it('a closed order keeps what was printed and its price; who printed it can still be set', async () => {
    const { o } = await order();
    await setPrintStatus(o.id, 'done');
    await updatePrintOrder(o.id, { ...o, customerName: 'Mira’s Bakeshop', printerId: 'm1', notes: 'Fixed', lines: [], delivery: { ...blankDelivery(), method: 'courier', address: 'Iloilo', fee: P(100) } });
    const saved = await db.printOrders.get(o.id);
    expect(saved).toMatchObject({ customerName: 'Mira’s Bakeshop', printerId: 'm1', notes: 'Fixed', status: 'done' });
    expect(saved?.lines).toEqual(o.lines);
    expect(saved?.delivery).toEqual(o.delivery);
  });

  it('goes to Studio with the printer’s share and every payment', async () => {
    const { o } = await order();
    await takePrintPayment(o.id, { ...gcash, amount: P(300) }, null);
    const fresh = (await db.printOrders.get(o.id))!;
    const printer = { id: 'm1', name: 'Kaye', email: 'kaye@example.com' } as Member;
    const feed = buildPrintFeed({ order: { ...fresh, printerId: 'm1' }, downPct: 50, customer: undefined, printer });
    expect(feed).toMatchObject({ type: 'print', number: o.number, total: P(600), printerShare: P(120), printer: { name: 'Kaye' }, customer: { name: 'Mira Bakeshop', phone: '0917' } });
    expect(feed.payments.map((p) => [p.stage, p.name, p.amount])).toEqual([['down', 'GCash', P(300)]]);
    // No printer yet: no share
    expect(buildPrintFeed({ order: fresh, downPct: 50, customer: undefined, printer: undefined }).printerShare).toBe(0);
  });
});
