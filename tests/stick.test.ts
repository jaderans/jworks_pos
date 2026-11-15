import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/db';
import { ensureDevice } from '../src/db/local';
import { setWriterDevice } from '../src/db/write';
import { saveStickOrder, stickOrderFor } from '../src/services/stick';
import { voidSale } from '../src/services/sales';
import type { Sale } from '../src/db/types';
import { DEFAULT_STICK, claimNo, designFileName, estimateReady, guessPack, isAddOnCategory, minisFor, nextDesignNos, nextStubNumber, orderPhotoName, packOf, readyText, stubSeq } from '../src/domain/stick';

const MIN = 60_000;

describe('Couple-of-Stickers packs', () => {
  it('knows the packs from the product names', () => {
    expect(guessPack('Couple Pack (live)')).toEqual({ pack: 'C', singles: false });
    expect(guessPack('Couple Pack Singles')).toEqual({ pack: 'C', singles: true });
    expect(guessPack('Solo Pack')).toEqual({ pack: 'S', singles: false });
    expect(guessPack('Barkada Pack (3)')).toEqual({ pack: 'B3', singles: false });
    expect(guessPack('Barkada Pack (4-5 people) Singles')).toEqual({ pack: 'B4', singles: true });
    expect(guessPack('Barkada Pack 5')).toEqual({ pack: 'B5', singles: false });
    expect(guessPack('Solo stickers')).toBeNull();
    expect(guessPack('Enamel Pins')).toBeNull();
    // The owner's real catalog: a "(Solo)" sticker isn't a pack; every pack says "Pack".
    expect(guessPack('Cat Meme (Solo)')).toBeNull();
    expect(guessPack('Solo Pack (live)')).toEqual({ pack: 'S', singles: false });
    expect(guessPack('Solo Pack Singles')).toEqual({ pack: 'S', singles: true });
    expect(guessPack('Barkada Pack (4-5)')).toEqual({ pack: 'B4', singles: false });
    expect(guessPack('Barkada Pack Singles (3)')).toEqual({ pack: 'B3', singles: true });
  });

  it('what the owner sets wins over the name', () => {
    const s = { packs: { p1: { pack: 'B5' as const, singles: false }, p2: { pack: null, singles: false } } };
    expect(packOf({ id: 'p1', name: 'Big group pack' }, s)).toEqual({ pack: 'B5', singles: false });
    expect(packOf({ id: 'p2', name: 'Couple Pack keychain' }, s)).toBeNull();
    expect(packOf({ id: 'p3', name: 'Solo Pack' }, s)).toEqual({ pack: 'S', singles: false });
  });

  it('packs come with mini stickers; singles don’t', () => {
    expect(minisFor({ pack: 'S', singles: false })).toBe(3);
    expect(minisFor({ pack: 'C', singles: false })).toBe(6);
    expect(minisFor({ pack: 'B5', singles: false })).toBe(8);
    expect(minisFor({ pack: 'C', singles: true })).toBe(0);
  });
});

describe('design files and numbers', () => {
  it('takes the next numbers after the highest used, in Drive or on an order', () => {
    expect(nextDesignNos(2, ['CS01', 'CS-07', 'cs3', 'XY99', ''])).toEqual(['CS08', 'CS09']);
    expect(nextDesignNos(1, [])).toEqual(['CS01']);
  });

  it('names the file after the number and the nickname', () => {
    expect(designFileName('CS12', 'leanna marnelle')).toBe('CS12-LeannaMarnelle');
    expect(designFileName('CS12', '')).toBe('CS12');
    expect(claimNo('QA-07')).toBe('07');
  });
});

describe('when it should be ready', () => {
  const now = Date.UTC(2026, 10, 15, 6, 0);

  it('with nothing ahead, a printed pack is 20 to 30 minutes', () => {
    const r = estimateReady([{ making: 'printing' }], [], DEFAULT_STICK, now);
    expect([r.from - now, r.to - now]).toEqual([20 * MIN, 30 * MIN]);
    expect(readyText({ readyFrom: r.from, readyTo: r.to }, now)).toBe('20–30 minutes');
  });

  it('orders in line push it back; one already being made counts half; two makers share the line', () => {
    const ahead = [
      { packs: [{ making: 'illustrating' as const }], started: true },
      { packs: [{ making: 'printing' as const }], started: false },
    ];
    // 15 (half of 30) + 20 waiting, then 20 for this one.
    expect(estimateReady([{ making: 'printing' }], ahead, DEFAULT_STICK, now).minutes).toBe(55);
    expect(estimateReady([{ making: 'printing' }], ahead, { ...DEFAULT_STICK, makers: 2 }, now).minutes).toBe(38);
    expect(estimateReady([{ making: 'printing' }], ahead, DEFAULT_STICK, now).ahead).toBe(2);
  });

  it('an add-on (a keychain, a pin) adds its minutes to the pack', () => {
    expect(estimateReady([{ making: 'printing', addOns: ['Keychain (add-on)'] }], [], DEFAULT_STICK, now).minutes).toBe(25);
  });

  it('more packs in one order take a little longer, not twice as long', () => {
    expect(estimateReady([{ making: 'printing' }, { making: 'printing' }], [], DEFAULT_STICK, now).minutes).toBe(30);
  });
});

describe('saving a Couple-of-Stickers order', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    setWriterDevice((await ensureDevice()).deviceId);
  });
  const sale = { id: 's1', receiptNo: 'A-0001', customerId: null, total: 29000, lines: [], payments: [] } as unknown as Sale;
  const stick = (nickname: string) => ({
    nickname, email: '', softCopy: false, addOns: ['1 × Enamel Pins'], saleId: 's1', paid: 29000, paidWith: 'Cash', readyFrom: 1, readyTo: 2, photo: 'message' as const,
    packs: [{ name: 'Couple Pack (live)', pack: 'C' as const, singles: false, making: 'printing' as const, minis: ['01'], designNo: 'CS01', note: '' }],
  });

  it('makes one order to make, already paid by the sale, with its number; saving again changes it', async () => {
    const device = await ensureDevice();
    await expect(saveStickOrder({ sale, stick: stick('  '), eventId: 'e1', device })).rejects.toThrow(/name or nickname/);
    const o = await saveStickOrder({ sale, stick: stick(' Leanna '), eventId: 'e1', device });
    expect(o).toMatchObject({ number: '01', status: 'new', pickupSaleId: 's1', customerName: 'Leanna', designNo: 'CS01' });
    expect(o.lines).toEqual([expect.objectContaining({ unitPrice: 0, name: 'Couple Pack · printing · CS01-Leanna' })]);
    const again = await saveStickOrder({ sale, stick: { ...stick('Leanna R'), email: 'l@jw.ph' }, existing: o, eventId: 'e1', device });
    expect(again).toMatchObject({ id: o.id, number: '01', contact: 'l@jw.ph' });
    expect((await stickOrderFor('s1'))?.id).toBe(o.id);
  });

  it('voiding the sale takes its order off Orders', async () => {
    const device = await ensureDevice();
    await db.sales.put({ ...sale, eventId: 'e1', status: 'completed', deleted: 0 } as Sale);
    const o = await saveStickOrder({ sale: { ...sale, eventId: 'e1' } as Sale, stick: stick('Leanna'), eventId: 'e1', device });
    const r = await voidSale('s1', 'Test sale', null);
    expect(r.ordersRemoved).toEqual([o.number]);
    expect((await db.orders.get(o.id))?.deleted).toBe(1);
    expect(await stickOrderFor('s1')).toBeUndefined();
  });
});

describe('stub numbers', () => {
  it('follow the last order still on Orders, so deleting test orders brings them back down', () => {
    expect(nextStubNumber([], {})).toBe('01');
    expect(nextStubNumber(['01', '02'], {})).toBe('03');
    expect(nextStubNumber(['01', '03'], {})).toBe('04');
    // All the test orders deleted: back to 01.
    expect(nextStubNumber([], { startAt: 1 })).toBe('01');
  });

  it('can start where pre-printed stubs left off, or carry the register letter', () => {
    expect(nextStubNumber([], { startAt: 9 })).toBe('09');
    expect(nextStubNumber(['12'], { startAt: 9 })).toBe('13');
    expect(nextStubNumber(['A-01'], { letter: 'A' })).toBe('A-02');
    expect(stubSeq('A-07')).toBe(7);
    expect(claimNo('A-07')).toBe('07');
  });

  it('names a booth photo after the order and the name; knows the add-on category', () => {
    expect(orderPhotoName('07', 'joshua')).toBe('07-Joshua');
    expect(isAddOnCategory('Add-on')).toBe(true);
    expect(isAddOnCategory('Add-ons')).toBe(true);
    expect(isAddOnCategory('Add on')).toBe(true);
    expect(isAddOnCategory('Stickers')).toBe(false);
  });
});

describe('samples on the customer screen', () => {
  it('a pack is shown with samples of its kind; a file name says which kind', async () => {
    const { packWhat, sampleKindFromName, sampleKindOf } = await import('../src/domain/stick');
    expect(['S', 'C', 'B3', 'B5'].map((p) => sampleKindOf(p as 'S'))).toEqual(['solo', 'couple', 'barkada', 'barkada']);
    expect(sampleKindFromName('Couple - Eliza & Renz')).toBe('couple');
    expect(sampleKindFromName('Solo - Wendy (2)')).toBe('solo');
    expect(sampleKindFromName('Barkada - Thea, Gretch, Dana & Pixie')).toBe('barkada');
    expect(sampleKindFromName('group photo')).toBe('barkada');
    expect(sampleKindFromName('heaven done (3)')).toBeNull();
    expect(packWhat({ pack: 'C', singles: false })).toBe('2 illustrated stickers + 6 mini stickers');
    expect(packWhat({ pack: 'B4', singles: true })).toBe('4 illustrated stickers');
  });
});

describe('who is on each pack', () => {
  it('one row per person the pack holds; the names make the pack’s name and its design file', async () => {
    const { packFileName, packNames, packPeople } = await import('../src/domain/stick');
    expect(packPeople({ pack: 'S' })).toEqual([{ name: '', who: '' }]);
    expect(packPeople({ pack: 'B4', people: [{ name: 'Thea', who: 'far left' }] })).toHaveLength(4);
    const couple = { pack: 'C' as const, designNo: 'CS03', people: [{ name: 'Kaye', who: 'left' }, { name: 'mark anthony', who: 'right' }] };
    expect(packNames(couple)).toBe('Kaye & mark anthony');
    expect(packNames({ pack: 'B3', people: [{ name: 'Thea', who: '' }, { name: 'Gretch', who: '' }, { name: 'Dana', who: '' }] })).toBe('Thea, Gretch & Dana');
    expect(packNames({ pack: 'S' }, 'Kaye')).toBe('Kaye');
    expect(packFileName(couple, 'Kaye')).toBe('CS03-Kaye-MarkAnthony');
    // No names on the pack: the order's name, as before.
    expect(packFileName({ pack: 'S', designNo: 'CS02' }, 'Kaye')).toBe('CS02-Kaye');
  });
});
