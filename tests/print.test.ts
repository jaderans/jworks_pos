import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { alive, db } from '../src/db/db';
import { ensureDevice } from '../src/db/local';
import { setWriterDevice } from '../src/db/write';
import { toCents } from '../src/lib/money';
import { DEFAULT_PRINT_RATES as R, addWorkingDays, customLine, illustrationLine, illustrationPrice, packLine, peelLine, printTotals, printWarnings, sheetsLine } from '../src/domain/print';
import { buildPrintFeed } from '../src/domain/studioFeed';
import { blankDelivery, createPrintOrder, deletePrintOrder, setPrintStatus, takePrintPayment, updatePrintOrder } from '../src/services/print';
import type { Member } from '../src/db/types';

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

describe('sticker illustration', () => {
  const [simple, detailed] = R.illustration.tiers;

  it('prices designs from the rate card: ₱100 simple, ₱220 detailed, cheaper in sets', () => {
    expect([1, 2, 5, 10].map((n) => illustrationPrice(simple, n).total)).toEqual([P(100), P(180), P(450), P(850)]);
    expect([1, 2, 5, 10].map((n) => illustrationPrice(detailed, n).total)).toEqual([P(220), P(390), P(950), P(1700)]);
    // Each set saves what the rate sheet says.
    expect([2, 5, 10].map((n) => illustrationPrice(detailed, n).saved)).toEqual([P(50), P(150), P(500)]);
  });

  it('mixes sets and single designs for the lowest price, and never charges more than singles', () => {
    expect(illustrationPrice(simple, 7).total).toBe(P(630));
    expect(illustrationPrice(detailed, 3).total).toBe(P(610));
    expect(illustrationPrice(detailed, 12).total).toBe(P(2090));
    // A set priced above its singles is skipped.
    expect(illustrationPrice({ price: P(220), sets: [{ designs: 2, price: P(450) }] }, 2).total).toBe(P(440));
  });

  it('is one line per tier, with the price changeable on the order', () => {
    expect(illustrationLine(R, 'detailed', 5)).toMatchObject({ kind: 'illustration', label: 'Sticker illustration, detailed: 5 designs', qty: 1, unitPrice: P(950), tier: 'detailed', designs: 5 });
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
    expect(buildPrintFeed({ order, downPct: 50, customer: undefined, printer: undefined, illustrator: artist })).toMatchObject({ illustrator: { memberId: 'm2', name: 'Ian' }, illustratorPct: 50, illustratorShare: P(195), printerShare: 0 });
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
