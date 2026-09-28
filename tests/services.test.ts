import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { alive, db } from '../src/db/db';
import { setLocal, updateDevice, ensureDevice } from '../src/db/local';
import { setWriterDevice } from '../src/db/write';
import { toCents } from '../src/lib/money';
import { priceCart } from '../src/domain/cart';
import { onHandByProduct } from '../src/domain/stock';
import { computeShare } from '../src/domain/share';
import { makeCostIndex } from '../src/domain/cost';
import { createProduct } from '../src/services/catalog';
import { createEvent } from '../src/services/events';
import { completeSale, openSession, voidSale, closeSession } from '../src/services/sales';
import { exportAll, mergeBackup, parseBackup, type BackupFile } from '../src/services/backup';
import { recordBatch, saveMaterial, setManualCost, adjustStock } from '../src/services/production';
import { saveSpend, setSpendStatus } from '../src/services/spend';
import { finalizePayouts, markPayoutPaid, saveMember } from '../src/services/team';
import { addToRoster } from '../src/services/events';
import { runSetup } from '../src/services/setup';
import type { Product, SalePayment } from '../src/db/types';

const P = toCents;

beforeEach(async () => {
  await db.delete();
  await db.open();
  const d = await ensureDevice();
  setWriterDevice(d.deviceId);
});

async function sell(eventId: string, lines: [Product, number][], payKind: 'cash' | 'ewallet' = 'cash') {
  const device = await ensureDevice();
  const session = await openSession(eventId, device, P(2000), null);
  const priced = priceCart(
    lines.map(([p, qty]) => ({ key: p.id, productId: p.id, name: p.name, categoryId: null, unitPrice: p.price!, qty, free: false, freeReason: '', designerId: p.designerId })),
    [],
    [],
  );
  const payments: SalePayment[] = [{ methodId: payKind, name: payKind === 'cash' ? 'Cash' : 'GCash', kind: payKind, amount: priced.total, tendered: payKind === 'cash' ? priced.total : null, ref: payKind === 'cash' ? '' : '123' }];
  return completeSale({ eventId, session, device, cashierId: null, priced, payments, note: '' });
}

describe('first-run setup', () => {
  it('imports names only, with no prices or costs', async () => {
    await runSetup({ businessName: 'JoshWorks', ownerName: 'Kaye', pin: '1234', deviceLetter: 'A', deviceName: 'Phone', importProducts: true, importMaterials: true, importTeam: true, calcRates: 'keep' });
    const products = alive(await db.products.toArray());
    expect(products.length).toBeGreaterThan(20);
    expect(products.every((p) => p.price === null)).toBe(true);
    expect(await db.productCosts.count()).toBe(0);
    const materials = alive(await db.materials.toArray());
    expect(materials.every((m) => m.packCost === null && m.onHand === 0)).toBe(true);
    const members = alive(await db.members.toArray());
    expect(members.filter((m) => m.appRole === 'owner').map((m) => m.name)).toEqual(['Kaye']);
    expect(members.filter((m) => m.name === 'Kaye')).toHaveLength(1);
    const methods = alive(await db.paymentMethods.toArray());
    expect(methods.filter((m) => m.active === 1).sort((x, y) => x.sort - y.sort).map((m) => m.name)).toEqual(['Cash', 'GCash', 'Maribank', 'Bank transfer']);
  });
});

describe('selling', () => {
  it('numbers receipts per device, takes stock out, and a void puts it back', async () => {
    await updateDevice({ letter: 'B' });
    const ev = await createEvent({ name: 'Fair' });
    const pin = await createProduct({ name: 'Enamel pin', price: P(30), trackStock: 1 });
    const pack = await createProduct({ name: 'Live pack', price: P(120), trackStock: 0 });
    await adjustStock(pin.id, 20, 'count');
    const s1 = await sell(ev.id, [[pin, 2], [pack, 1]]);
    const s2 = await sell(ev.id, [[pin, 1]]);
    expect([s1.receiptNo, s2.receiptNo]).toEqual(['B-0001', 'B-0002']);
    expect(s1.total).toBe(P(180));
    let onHand = onHandByProduct(alive(await db.stockMoves.toArray()));
    expect(onHand.get(pin.id)).toBe(17);
    expect(onHand.get(pack.id)).toBeUndefined();
    await voidSale(s1.id, 'Rang up twice', null);
    onHand = onHandByProduct(alive(await db.stockMoves.toArray()));
    expect(onHand.get(pin.id)).toBe(19);
    expect((await db.sales.get(s1.id))!.status).toBe('voided');
    // voiding twice does nothing more
    await voidSale(s1.id, 'again', null);
    expect(onHandByProduct(alive(await db.stockMoves.toArray())).get(pin.id)).toBe(19);
  });

  it('closes the register and records over/short', async () => {
    const ev = await createEvent({ name: 'Fair' });
    const pin = await createProduct({ name: 'Pin', price: P(30) });
    const sale = await sell(ev.id, [[pin, 3]]);
    const closed = await closeSession(sale.sessionId, { '1000': 2, '50': 1, '20': 2 }, '', null);
    expect(closed!.expected).toBe(P(2090));
    expect(closed!.countedTotal).toBe(P(2090));
  });

  it('refuses a sale whose payments do not cover the total', async () => {
    const ev = await createEvent({ name: 'Fair' });
    const pin = await createProduct({ name: 'Pin', price: P(30) });
    const device = await ensureDevice();
    const session = await openSession(ev.id, device, 0, null);
    const priced = priceCart([{ key: 'k', productId: pin.id, name: 'Pin', categoryId: null, unitPrice: P(30), qty: 2, free: false, freeReason: '', designerId: null }], [], []);
    await expect(
      completeSale({ eventId: ev.id, session, device, cashierId: null, priced, payments: [{ methodId: 'c', name: 'Cash', kind: 'cash', amount: P(50), tendered: P(50), ref: '' }], note: '' }),
    ).rejects.toThrow(/cover/);
    expect(await db.sales.count()).toBe(0);
  });
});

describe('merging two devices', () => {
  it('adds the other phone’s sales once, even if the file is merged twice', async () => {
    const ev = await createEvent({ name: 'Fair' });
    const pin = await createProduct({ name: 'Pin', price: P(30) });
    await sell(ev.id, [[pin, 1]]);
    // Make a file that looks like it came from phone B with two sales of its own.
    const mine = await exportAll();
    const phoneB: BackupFile = JSON.parse(JSON.stringify(mine));
    phoneB.device = { deviceId: 'phone-b', letter: 'B', name: 'Phone B' };
    const [tmpl] = phoneB.tables.sales as never as { id: string; receiptNo: string; deviceId: string; updatedAt: number; _dev: string }[];
    phoneB.tables.sales = [
      { ...tmpl, id: 'b-sale-1', receiptNo: 'B-0001', deviceId: 'phone-b', _dev: 'phone-b' },
      { ...tmpl, id: 'b-sale-2', receiptNo: 'B-0002', deviceId: 'phone-b', _dev: 'phone-b' },
    ] as never;
    const text = JSON.stringify(phoneB);
    const first = await mergeBackup(parseBackup(text));
    expect(first.byTable.sales).toEqual({ added: 2, updated: 0 });
    const second = await mergeBackup(parseBackup(text));
    expect(second.added).toBe(0);
    expect(second.updated).toBe(0);
    expect(alive(await db.sales.toArray())).toHaveLength(3);
  });

  it('keeps the newer copy of an edited record', async () => {
    const pin = await createProduct({ name: 'Pin', price: P(30) });
    const file = await exportAll();
    const older = JSON.parse(JSON.stringify(file)) as BackupFile;
    const newer = JSON.parse(JSON.stringify(file)) as BackupFile;
    (newer.tables.products![0] as unknown as Product).price = P(35);
    (newer.tables.products![0] as unknown as Product).updatedAt += 5000;
    await mergeBackup(newer);
    expect((await db.products.get(pin.id))!.price).toBe(P(35));
    await mergeBackup(older);
    expect((await db.products.get(pin.id))!.price).toBe(P(35));
  });

  it('rejects files that are not backups', () => {
    expect(() => parseBackup('hello')).toThrow(/isn.t a JoshWorks POS backup/);
    expect(() => parseBackup('{"app":"other","tables":{}}')).toThrow(/isn.t a JoshWorks POS backup/);
  });
});

describe('production', () => {
  it('adds stock, uses materials, and averages cost across batches', async () => {
    const vinyl = await saveMaterial({ name: 'Vinyl', unit: 'sheet', packQty: 20, packCost: P(280), onHand: 40 });
    const sticker = await createProduct({ name: 'Sticker', price: P(25) });
    await recordBatch({ productId: sticker.id, qtyMade: 60, qtySpoiled: 5, materials: [{ materialId: vinyl.id, qty: 4 }], laborMinutes: 40, laborRate: P(150), oneTime: P(150), other: 0, overheadPct: 25, deductMaterials: true, note: '' });
    expect(onHandByProduct(alive(await db.stockMoves.toArray())).get(sticker.id)).toBe(55);
    expect((await db.materials.get(vinyl.id))!.onHand).toBe(36);
    const c1 = (await db.productCosts.get(sticker.id))!.current!;
    // (4 × ₱14 + ₱100 labor + ₱150 design) × 1.25 = ₱382.50 ÷ 55
    expect(c1).toBe(Math.round(38250 / 55));
    await recordBatch({ productId: sticker.id, qtyMade: 55, qtySpoiled: 0, materials: [], laborMinutes: 0, laborRate: 0, oneTime: 0, other: P(330), overheadPct: 0, deductMaterials: false, note: '' });
    const c2 = (await db.productCosts.get(sticker.id))!.current!;
    expect(c2).toBe(Math.round((55 * c1 + 55 * P(6)) / 110));
    expect(alive(await db.costPoints.where('productId').equals(sticker.id).toArray())).toHaveLength(2);
  });

  it('uses the cost in force at each sale for profit', async () => {
    const ev = await createEvent({ name: 'Fair' });
    const pin = await createProduct({ name: 'Pin', price: P(30) });
    await setManualCost(pin.id, P(10));
    await sell(ev.id, [[pin, 2]]);
    await new Promise((r) => setTimeout(r, 5));
    await setManualCost(pin.id, P(20));
    await sell(ev.id, [[pin, 1]]);
    const share = computeShare({
      event: (await db.events.get(ev.id))!,
      sales: alive(await db.sales.toArray()),
      products: new Map([[pin.id, pin]]),
      costOf: makeCostIndex(alive(await db.costPoints.toArray())),
      roster: [],
      members: new Map(),
      deals: [],
      eventProducts: [],
      spend: [],
    });
    expect(share.cogs).toBe(P(2 * 10 + 20));
  });
});

describe('booth spend', () => {
  it('restocks a material once when bought, and undoes it', async () => {
    const ev = await createEvent({ name: 'Fair' });
    const vinyl = await saveMaterial({ name: 'Vinyl', unit: 'sheet', packQty: 20, packCost: P(280), onHand: 0 });
    const item = await saveSpend({ eventId: ev.id, type: 'material', name: 'Vinyl', qty: 3, unitCost: P(300), materialId: vinyl.id, status: 'to_buy' });
    expect((await db.materials.get(vinyl.id))!.onHand).toBe(0);
    await setSpendStatus(item.id, 'bought');
    expect((await db.materials.get(vinyl.id))!.onHand).toBe(60);
    expect((await db.materials.get(vinyl.id))!.packCost).toBe(P(300));
    await setSpendStatus(item.id, 'bought');
    expect((await db.materials.get(vinyl.id))!.onHand).toBe(60);
    await setSpendStatus(item.id, 'not_needed');
    expect((await db.materials.get(vinyl.id))!.onHand).toBe(0);
  });
});

describe('payouts', () => {
  it('saves the split and leaves paid payouts alone', async () => {
    await setLocal('setupDone', true);
    const ev = await createEvent({ name: 'Fair', startDate: '2026-10-01', endDate: '2026-10-01' });
    const a = await saveMember({ name: 'Ana', roleLabel: 'Production', weight: 3 });
    const b = await saveMember({ name: 'Ben', roleLabel: 'Floater', weight: 2 });
    await addToRoster(ev.id, a.id);
    await addToRoster(ev.id, b.id);
    const pin = await createProduct({ name: 'Pin', price: P(100) });
    await setManualCost(pin.id, P(20));
    await sell(ev.id, [[pin, 10]]);
    const compute = async () =>
      computeShare({
        event: (await db.events.get(ev.id))!,
        sales: alive(await db.sales.toArray()),
        products: new Map([[pin.id, pin]]),
        costOf: makeCostIndex(alive(await db.costPoints.toArray())),
        roster: alive(await db.roster.toArray()),
        members: new Map(alive(await db.members.toArray()).map((m) => [m.id, m])),
        deals: [],
        eventProducts: [],
        spend: [],
      });
    const s = await compute();
    // ₱1,000 − ₱200 cost = ₱800 pool; staff 60% = ₱480 split 3:2 (same hours)
    expect(Object.fromEntries(s.staff.map((x) => [x.name, x.amount]))).toEqual({ Ana: P(288), Ben: P(192) });
    const r = await finalizePayouts(ev.id, s);
    expect(r.saved).toBe(2);
    const payouts = alive(await db.payouts.toArray());
    const ana = payouts.find((p) => p.memberId === a.id)!;
    await markPayoutPaid(ana.id, true, 'GCash', 'ref1');
    await sell(ev.id, [[pin, 10]]);
    const r2 = await finalizePayouts(ev.id, await compute());
    expect(r2.changedAfterPaid).toEqual([ana.id]);
    expect((await db.payouts.get(ana.id))!.amount).toBe(P(288));
    expect((await db.payouts.get(ana.id))!.status).toBe('paid');
  });
});
