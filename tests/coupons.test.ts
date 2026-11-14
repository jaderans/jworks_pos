import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { alive, db } from '../src/db/db';
import { ensureDevice } from '../src/db/local';
import { setWriterDevice } from '../src/db/write';
import { toCents } from '../src/lib/money';
import { addDays, todayISO } from '../src/lib/time';
import {
  checkCoupon, claimId, couponOff, couponPrefix, couponStats, earnBatchFor, expiringSoon, generateCodes, randomCode, termsText,
} from '../src/domain/coupons';
import { DEFAULT_PRINT_RATES as R, printTotals, sheetsLine } from '../src/domain/print';
import { orderTotal } from '../src/domain/orders';
import { computeServiceQuote } from '../src/domain/quote';
import { priceCart } from '../src/domain/cart';
import { buildPrintFeed } from '../src/domain/studioFeed';
import { createEvent } from '../src/services/events';
import { createProduct } from '../src/services/catalog';
import { completeSale, openSession, voidSale } from '../src/services/sales';
import { blankDelivery, cancelPrint, createPrintOrder, updatePrintOrder } from '../src/services/print';
import { createOrder, pickUpOrder, takeDeposit } from '../src/services/orders';
import { saveQuote, setQuoteStatus } from '../src/services/quotes';
import { issueEarnedCoupon, readStudioClaims, recordClaim, saveBatch, type BatchInput } from '../src/services/coupons';
import type { Coupon, CouponBatch, CouponClaim, SalePayment } from '../src/db/types';

const P = toCents;
const today = todayISO();
const cash = (amount: number): SalePayment => ({ methodId: 'cash', name: 'Cash', kind: 'cash', amount: P(amount), tendered: P(amount), ref: '' });

beforeEach(async () => {
  await db.delete();
  await db.open();
  setWriterDevice((await ensureDevice()).deviceId);
});

const batch = (b: Partial<CouponBatch> = {}): CouponBatch => ({
  id: 'b1', createdAt: 1, updatedAt: 1, eventId: 'e1', name: 'Booth handout', kind: 'amount', value: P(300), maxOff: 0, minSpend: P(2500),
  validFrom: '2026-11-01', validTo: '2026-12-31', mode: 'unique', maxUses: 1, earnMin: 0, prefix: 'KI26', active: 1, notes: '', ...b,
});
const coupon = (c: Partial<Coupon> = {}): Coupon => ({ id: 'c1', createdAt: 1, updatedAt: 1, code: 'KI26-AAAAA', batchId: 'b1', eventId: 'e1', customerId: null, saleId: null, givenAt: null, remindedAt: null, void: 0, ...c });
const claim = (c: Partial<CouponClaim> = {}): CouponClaim => ({
  id: 'print:p1', createdAt: 1, updatedAt: 1, couponId: 'c1', code: 'KI26-AAAAA', batchId: 'b1', eventId: 'e1', source: 'print', sourceId: 'p1',
  service: 'Service order PA-001', customerId: null, customerName: 'Mira', price: P(3000), discount: P(300), at: 1, by: null, ...c,
});

describe('coupon codes', () => {
  it('start with the event’s initials and year, and never repeat or use look-alike characters', () => {
    expect(couponPrefix('Komiket Iloilo 2026', '2026-11-14')).toBe('KI26');
    expect(couponPrefix('Komiket', '2026-11-14')).toBe('KOMI26');
    const taken = new Set(['KI26-AAAAA']);
    const codes = generateCodes('KI26', 200, taken);
    expect(codes).toHaveLength(200);
    expect(new Set(codes).size).toBe(200);
    for (const c of codes) expect(c).toMatch(/^KI26-[A-HJ-NP-Z2-9]{5}$/);
    // A random source that only ever gives the taken code can't make a new one.
    expect(generateCodes('KI26', 1, taken, (n) => new Uint8Array(n))).toEqual([]);
    expect(randomCode('KI26', (n) => new Uint8Array(n))).toBe('KI26-AAAAA');
  });

  it('take pesos or a capped percent off, never more than the price', () => {
    expect(couponOff(batch(), P(3000))).toBe(P(300));
    expect(couponOff(batch({ value: P(5000) }), P(3000))).toBe(P(3000));
    expect(couponOff(batch({ kind: 'percent', value: 10, maxOff: P(250) }), P(3000))).toBe(P(250));
    expect(couponOff(batch({ kind: 'percent', value: 10, maxOff: 0 }), P(3000))).toBe(P(300));
    expect(termsText(batch())).toBe('₱300 off any JoshWorks service of ₱2,500 or more, until Dec 31, 2026.');
  });

  it('check the dates, the minimum and single use', () => {
    const data = { coupons: [coupon()], batches: [batch()], claims: [] as CouponClaim[] };
    const ctx = { today: '2026-11-20', price: P(3000), claimId: null };
    expect(checkCoupon('ki26-aaaaa', data, ctx)).toMatchObject({ ok: true, discount: P(300) });
    expect(checkCoupon('KI26-ZZZZZ', data, ctx)).toMatchObject({ ok: false, reason: expect.stringMatching(/no coupon/) });
    expect(checkCoupon('KI26-AAAAA', data, { ...ctx, today: '2026-10-30' })).toMatchObject({ ok: false, reason: expect.stringMatching(/can be used from/) });
    expect(checkCoupon('KI26-AAAAA', data, { ...ctx, today: '2027-01-01' })).toMatchObject({ ok: false, reason: expect.stringMatching(/expired/) });
    expect(checkCoupon('KI26-AAAAA', data, { ...ctx, price: P(2499) })).toMatchObject({ ok: false, reason: expect.stringMatching(/₱2,500 or more/) });
    expect(checkCoupon('KI26-AAAAA', { ...data, coupons: [coupon({ void: 1 })] }, ctx)).toMatchObject({ ok: false, reason: expect.stringMatching(/turned off/) });

    const used = { ...data, claims: [claim()] };
    expect(checkCoupon('KI26-AAAAA', used, ctx)).toMatchObject({ ok: false, reason: 'KI26-AAAAA was already used by Mira (Service order PA-001).' });
    // The service holding it can still be edited, even after the code runs out.
    expect(checkCoupon('KI26-AAAAA', used, { ...ctx, claimId: 'print:p1', today: '2027-02-01' })).toMatchObject({ ok: true });
    // Shared codes count up to their limit.
    const shared = { coupons: [coupon()], batches: [batch({ mode: 'shared', maxUses: 2 })], claims: [claim()] };
    expect(checkCoupon('KI26-AAAAA', shared, ctx).ok).toBe(true);
    expect(checkCoupon('KI26-AAAAA', { ...shared, claims: [claim(), claim({ id: 'order:o1' })] }, ctx)).toMatchObject({ ok: false, reason: 'KI26-AAAAA is used up (2 of 2).' });
  });

  it('add up per event, flag codes used twice, and list who to remind', () => {
    const coupons = [coupon(), coupon({ id: 'c2', code: 'KI26-BBBBB', customerId: 'kaye' }), coupon({ id: 'c3', code: 'KI26-CCCCC', void: 1 })];
    const claims = [claim(), claim({ id: 'order:o1', price: P(4000), discount: P(300) })];
    const s = couponStats({ coupons, batches: [batch()], claims }, '2026-11-20');
    expect(s).toMatchObject({ codes: 3, claims: 2, claimedCodes: 1, open: 1, off: 1, given: 1, price: P(7000), discount: P(600), net: P(6400), claimRate: 50, doubles: ['KI26-AAAAA'] });
    expect(expiringSoon({ coupons, batches: [batch()], claims }, '2026-11-20')).toEqual([]);
    expect(expiringSoon({ coupons, batches: [batch()], claims }, '2026-12-25').map((x) => [x.coupon.code, x.daysLeft])).toEqual([['KI26-BBBBB', 6]]);
  });

  it('booth sales earn from the highest set they reach', () => {
    const sets = [batch({ id: 'small', earnMin: P(500) }), batch({ id: 'big', earnMin: P(1500) }), batch({ id: 'handout' })];
    expect(earnBatchFor(sets, 'e1', P(400), '2026-11-20')).toBeNull();
    expect(earnBatchFor(sets, 'e1', P(800), '2026-11-20')?.id).toBe('small');
    expect(earnBatchFor(sets, 'e1', P(2000), '2026-11-20')?.id).toBe('big');
    expect(earnBatchFor(sets, 'e2', P(2000), '2026-11-20')).toBeNull();
  });
});

describe('coupons on service prices (everyone shares the discount)', () => {
  it('print orders: off the print work, not the delivery fee; the printer’s share is of the work after it', () => {
    const t = printTotals(
      { lines: [sheetsLine(R, 'prem-matte-glossy', 'die', 30)], delivery: { ...blankDelivery(), method: 'courier', fee: P(120), address: 'Jaro' }, payments: [], printerPct: 20, coupon: { couponId: 'c1', code: 'KI26-AAAAA', discount: P(300) } },
      50,
    );
    expect(t).toMatchObject({ subtotal: P(2700), discount: P(300), delivery: P(120), total: P(2520), down: P(1260), printerShare: P(480) });
  });

  it('orders: off the commission pieces only', () => {
    const lines = [
      { productId: null, name: 'Portrait commission', categoryId: null, designerId: null, qty: 1, unitPrice: P(3000) },
      { productId: 'pin', name: 'Pin', categoryId: null, designerId: null, qty: 2, unitPrice: P(100) },
    ];
    expect(orderTotal({ lines, coupon: { couponId: 'c1', code: 'X', discount: P(300) } })).toBe(P(2900));
    // Never more than the commission pieces.
    expect(orderTotal({ lines, coupon: { couponId: 'c1', code: 'X', discount: P(5000) } })).toBe(P(200));
  });

  it('service quotes: off the price before VAT; VAT, profit and margin are after it', () => {
    const input = {
      qty: 1, materials: [], outsourced: [], other: [],
      labor: [
        { role: 'CD', hours: 10, rate: P(500) }, { role: 'Illustrator', hours: 10, rate: P(350) },
        { role: 'Junior', hours: 10, rate: P(180) }, { role: 'Junior', hours: 10, rate: P(180) },
      ],
      overheadPct: 25, method: 'margin' as const, markupPct: 60, marginPct: 45, manualPrice: null, roundTo: 5,
      addons: { rush: false, revision: 0, sourceFiles: false, ipBuyout: false },
      addonPcts: { rush: 25, revision: 15, sourceFiles: 20, ipBuyout: 60 },
      vatRegistered: true, vatPct: 12, ewt: false, ewtPct: 2, minMarginPct: 30,
    };
    const r = computeServiceQuote({ ...input, couponOff: P(500) });
    expect(r).toMatchObject({ totalPrice: P(27500), coupon: P(500), subtotal: P(27000), vat: P(3240), invoice: P(30240), profit: P(11875) });
    expect(computeServiceQuote(input)).toMatchObject({ coupon: 0, subtotal: P(27500), profit: P(12375) });
  });
});

describe('coupon services', () => {
  async function setup(extra: Partial<BatchInput> = {}) {
    const ev = await createEvent({ name: 'Komiket Iloilo', startDate: today, endDate: today });
    const b = await saveBatch({
      eventId: ev.id, name: 'Booth handout', kind: 'amount', value: P(300), maxOff: 0, minSpend: P(2500), validFrom: today, validTo: addDays(today, 60),
      mode: 'unique', maxUses: null, earnMin: 0, prefix: 'KI26', notes: '', count: 3, ...extra,
    });
    const codes = alive(await db.coupons.where('batchId').equals(b.id).toArray()).map((c) => c.code);
    return { ev, b, codes, device: await ensureDevice() };
  }
  const printOrder = (code: string, sheets = 30, name = 'Mira Bakeshop') => ({
    customerId: null, customerName: name, contact: '0917', lines: [sheetsLine(R, 'prem-matte-glossy', 'die', sheets)], delivery: blankDelivery(), printerId: null, files: '', notes: '', couponCode: code,
  });

  it('won’t make coupons under ₱2,500', async () => {
    const ev = await createEvent({ name: 'Komiket', startDate: today, endDate: today });
    await expect(
      saveBatch({ eventId: ev.id, name: 'Cheap', kind: 'amount', value: P(100), maxOff: 0, minSpend: P(1000), validFrom: today, validTo: today, mode: 'unique', maxUses: null, earnMin: 0, prefix: 'KO26', notes: '', count: 1 }),
    ).rejects.toThrow(/₱2,500 or more/);
  });

  it('a print order claims a code; a second service can’t, until the first is cancelled', async () => {
    const { b, codes, device } = await setup();
    expect(codes).toHaveLength(3);
    const first = await createPrintOrder(printOrder(codes[0]), device);
    expect(first.coupon).toMatchObject({ code: codes[0], discount: P(300) });
    const held = await db.couponClaims.get(claimId('print', first.id));
    expect(held).toMatchObject({ batchId: b.id, price: P(2700), discount: P(300), service: `Service order ${first.number}`, customerName: 'Mira Bakeshop' });
    expect(buildPrintFeed({ order: first, downPct: 50, customer: undefined, printer: undefined })).toMatchObject({ subtotal: P(2700), discount: P(300), couponCode: codes[0], total: P(2400) });

    await expect(createPrintOrder(printOrder(codes[0], 30, 'Kaye'), device)).rejects.toThrow(/already used by Mira Bakeshop/);
    await expect(createPrintOrder(printOrder(codes[1], 10), device)).rejects.toThrow(/₱2,500 or more; this is ₱900/);
    // Editing the order keeps its own code.
    await updatePrintOrder(first.id, printOrder(codes[0], 40));
    expect((await db.couponClaims.get(claimId('print', first.id)))?.price).toBe(P(3600));

    await cancelPrint(first.id, 'Changed their mind');
    expect((await db.couponClaims.get(claimId('print', first.id)))?.deleted).toBe(1);
    const second = await createPrintOrder(printOrder(codes[0], 30, 'Kaye'), device);
    expect(second.coupon?.code).toBe(codes[0]);
  });

  it('a big enough booth sale earns one code, which goes when the sale is voided', async () => {
    const { ev, device } = await setup({ name: 'Spend ₱500', count: 0, earnMin: P(500) });
    const pin = await createProduct({ name: 'Pin', price: P(300), trackStock: 0 });
    const session = await openSession(ev.id, device, P(1000), null);
    const sell = (qty: number) =>
      completeSale({ eventId: ev.id, session, device, cashierId: null, priced: priceCart([{ key: 'k', productId: pin.id, name: 'Pin', categoryId: null, unitPrice: P(300), qty, free: false, freeReason: '', designerId: null }], [], []), payments: [cash(qty * 300)], note: '' });

    expect(await issueEarnedCoupon(await sell(1))).toBeNull();
    const big = await sell(2);
    const earned = await issueEarnedCoupon(big);
    expect(earned).toMatchObject({ saleId: big.id, eventId: ev.id, void: 0 });
    expect(earned!.code).toMatch(/^KI26-/);
    expect((await issueEarnedCoupon(big))?.id).toBe(earned!.id);
    await voidSale(big.id, 'Wrong item', null);
    expect((await db.coupons.get(earned!.id))?.void).toBe(1);
  });

  it('an order’s pickup sale carries the coupon, off the commission piece', async () => {
    const { ev, device } = await setup({ name: '10% off', kind: 'percent', value: 10, maxOff: P(250), count: 1 });
    const [code] = alive(await db.coupons.toArray()).map((c) => c.code);
    const session = await openSession(ev.id, device, P(1000), null);
    const order = await createOrder(
      {
        eventId: ev.id, customerId: null, customerName: 'Kaye', contact: '0917', designerId: null, dueAt: '', notes: '', couponCode: code,
        lines: [
          { productId: null, name: 'Portrait commission', categoryId: null, designerId: null, qty: 1, unitPrice: P(3000) },
          { productId: null, name: 'Rush', categoryId: null, designerId: null, qty: 1, unitPrice: P(200) },
        ],
      },
      device,
    );
    expect(order.coupon?.discount).toBe(P(250));
    expect(orderTotal(order)).toBe(P(2950));
    const t = { session, device, cashierId: null };
    await takeDeposit(order, P(1000), { ...t, payments: [cash(1000)] });
    const sale = await pickUpOrder(order, { ...t, payments: [cash(1950)] });
    expect(sale.total).toBe(P(2950));
    expect(sale.discounts).toEqual([{ id: 'coupon', label: `Coupon ${code}`, kind: 'coupon', amount: P(250) }]);
    expect(await db.couponClaims.get(claimId('order', order.id))).toMatchObject({ price: P(3200), discount: P(250), customerName: 'Kaye' });
  });

  it('a lost quote lets its coupon go; winning it claims it again', async () => {
    const { codes } = await setup();
    const q = await saveQuote({ couponCode: codes[0], servicePrice: P(5000), date: today, client: 'Kape Uno', project: 'Logo', category: 'Branding', kind: 'service', qty: 1, unitPrice: P(4700), total: P(4700), cost: P(2000), status: 'quoted', notes: '', inputs: {} });
    expect(q.coupon).toMatchObject({ code: codes[0], discount: P(300) });
    const id = claimId('quote', q.id);
    expect(await db.couponClaims.get(id)).toMatchObject({ service: 'Quote Q-001: Logo', price: P(5000) });
    await setQuoteStatus(q.id, 'lost');
    expect((await db.couponClaims.get(id))?.deleted).toBe(1);
    await setQuoteStatus(q.id, 'won');
    expect((await db.couponClaims.get(id))?.deleted).toBe(0);
  });

  it('Studio jobs on this device that took a code count as uses; POS-imported jobs don’t', async () => {
    const { codes } = await setup();
    await Dexie.delete('jworks-campaigns');
    const st = new Dexie('jworks-campaigns');
    st.version(1).stores({ jobs: 'id', jobMoney: 'id', clients: 'id' });
    await st.open();
    await st.table('clients').put({ id: 'kape', name: 'Kape Uno' });
    await st.table('jobs').bulkPut([
      { id: 'j1', number: 'COM-012', title: 'Logo', clientId: 'kape', clientName: '' },
      { id: 'pos-print-x', number: 'COM-013', title: 'Sticker printing', clientId: null, clientName: 'Mira' },
    ]);
    await st.table('jobMoney').bulkPut([
      { id: 'j1', total: P(4700), discountAmount: P(300), couponCode: codes[0] },
      { id: 'pos-print-x', total: P(2400), discountAmount: P(300), couponCode: codes[1] },
    ]);
    st.close();

    expect(await readStudioClaims()).toMatchObject({ found: true, changed: 1 });
    const live = alive(await db.couponClaims.toArray());
    expect(live.map((c) => [c.id, c.code, c.price, c.discount, c.customerName, c.service])).toEqual([['studio:j1', codes[0], P(5000), P(300), 'Kape Uno', 'Studio job COM-012: Logo']]);
    expect(await readStudioClaims()).toMatchObject({ changed: 0 });

    // The job drops the coupon: the code is free again.
    const st2 = new Dexie('jworks-campaigns');
    await st2.open();
    await st2.table('jobMoney').put({ id: 'j1', total: P(5000), discountAmount: 0 });
    st2.close();
    await readStudioClaims();
    expect(alive(await db.couponClaims.toArray())).toEqual([]);
    await Dexie.delete('jworks-campaigns');
  });

  it('records a use by hand, checked like any other', async () => {
    const { codes } = await setup();
    await recordClaim({ code: codes[2], service: 'Logo on Messenger', customerId: null, customerName: 'Jo', price: P(6000) });
    await expect(recordClaim({ code: codes[2], service: 'Another', customerId: null, customerName: 'Al', price: P(6000) })).rejects.toThrow(/already used by Jo/);
    const [c] = alive(await db.couponClaims.toArray());
    expect(c).toMatchObject({ source: 'manual', discount: P(300), price: P(6000) });
  });
});
