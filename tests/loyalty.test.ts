import { describe, expect, it } from 'vitest';
import { toCents } from '../src/lib/money';
import { priceCart } from '../src/domain/cart';
import { checkVoucher, loyaltyDiscount, loyaltyState, normalizeCode, stampsForSale } from '../src/domain/loyalty';
import type { LoyaltySettings, Sale, Voucher } from '../src/db/types';

const P = toCents;
const rules: LoyaltySettings = { enabled: true, pesoPerStamp: P(100), stampsForReward: 5, rewardKind: 'amount', rewardValue: P(50) };

let n = 0;
function sale(total: number, extra: Partial<Sale> = {}): Sale {
  n++;
  return {
    id: `s${n}`, createdAt: 0, updatedAt: 0, eventId: 'e1', sessionId: 'x', deviceId: 'd', receiptNo: `A-${n}`, at: n * 1000, cashierId: null,
    lines: [], subtotal: P(total), discountTotal: 0, discounts: [], total: P(total), payments: [], change: 0, note: '', status: 'completed',
    voidedAt: null, voidedBy: null, voidReason: '', ...extra,
  };
}

const voucher = (extra: Partial<Voucher> = {}): Voucher => ({
  id: 'v1', createdAt: 0, updatedAt: 0, code: 'KOMIKET50', label: '', kind: 'amount', value: P(50), minSpend: 0, validFrom: '', validTo: '',
  eventId: null, maxUses: null, perCustomer: null, active: 1, notes: '', ...extra,
});

describe('stamp card', () => {
  it('gives a stamp per ₱100 actually paid', () => {
    expect(stampsForSale({ total: P(99) }, rules)).toBe(0);
    expect(stampsForSale({ total: P(250) }, rules)).toBe(2);
    expect(stampsForSale({ total: P(250) }, { ...rules, enabled: false })).toBe(0);
  });

  it('counts stamps from sales, so a double merge never doubles them', () => {
    const sales = [sale(300, { customerId: 'c1' }), sale(250, { customerId: 'c1' }), sale(900, { customerId: 'c2' }), sale(400, { customerId: 'c1', status: 'voided' })];
    const st = loyaltyState('c1', sales, rules);
    expect(st).toMatchObject({ earned: 5, balance: 5, rewards: 1, visits: 2, spent: P(550) });
    // The same sales merged in again from another phone's file (same ids) are the same sales.
    const merged = new Map([...sales, ...sales].map((s) => [s.id, s]));
    expect(loyaltyState('c1', [...merged.values()], rules).balance).toBe(5);
  });

  it('a reward used on a sale takes its stamps off the card', () => {
    const sales = [sale(500, { customerId: 'c1' }), sale(150, { customerId: 'c1', discounts: [{ id: 'loyalty', label: 'Loyalty reward', kind: 'loyalty', amount: P(50) }] })];
    const st = loyaltyState('c1', sales, rules);
    expect(st).toMatchObject({ earned: 6, used: 5, balance: 1, rewards: 0, toNext: 4 });
  });

  it('prices the reward as a discount recorded as loyalty', () => {
    const priced = priceCart(
      [{ key: 'k', productId: 'p', name: 'Pin', categoryId: null, unitPrice: P(80), qty: 2, free: false, freeReason: '', designerId: null }],
      [],
      [loyaltyDiscount(rules)],
    );
    expect(priced.total).toBe(P(110));
    expect(priced.discounts[0]).toMatchObject({ kind: 'loyalty', amount: P(50) });
  });
});

describe('vouchers', () => {
  const ctx = { code: 'komiket 50', today: '2026-10-28', eventId: 'e1', base: P(200), customerId: null as string | null, sales: [] as Sale[] };

  it('normalizes codes', () => {
    expect(normalizeCode(' komiket 50 ')).toBe('KOMIKET50');
  });

  it('applies a valid code as a voucher discount', () => {
    const r = checkVoucher(voucher(), ctx);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.discount).toMatchObject({ kind: 'amount', value: P(50), source: 'voucher' });
      const priced = priceCart([{ key: 'k', productId: 'p', name: 'Sticker', categoryId: null, unitPrice: P(100), qty: 2, free: false, freeReason: '', designerId: null }], [], [r.discount]);
      expect(priced.discounts[0].kind).toBe('voucher');
      expect(priced.total).toBe(P(150));
    }
  });

  it('refuses unknown, off, early, late, other-event and below-minimum codes', () => {
    expect(checkVoucher(undefined, ctx).ok).toBe(false);
    expect(checkVoucher(voucher({ active: 0 }), ctx).ok).toBe(false);
    expect(checkVoucher(voucher({ validFrom: '2026-11-01' }), ctx).ok).toBe(false);
    expect(checkVoucher(voucher({ validTo: '2026-10-27' }), ctx).ok).toBe(false);
    expect(checkVoucher(voucher({ eventId: 'e2' }), ctx).ok).toBe(false);
    const low = checkVoucher(voucher({ minSpend: P(300) }), ctx);
    expect(low.ok).toBe(false);
    if (!low.ok) expect(low.reason).toContain('₱300');
  });

  it('counts uses from sales, in total and per customer', () => {
    const used = [sale(200, { voucherCode: 'KOMIKET50', customerId: 'c1' }), sale(200, { voucherCode: 'KOMIKET50', customerId: 'c2' })];
    expect(checkVoucher(voucher({ maxUses: 2 }), { ...ctx, sales: used }).ok).toBe(false);
    expect(checkVoucher(voucher({ maxUses: 3 }), { ...ctx, sales: used }).ok).toBe(true);
    expect(checkVoucher(voucher({ perCustomer: 1 }), { ...ctx, sales: used }).ok).toBe(false);
    expect(checkVoucher(voucher({ perCustomer: 1 }), { ...ctx, sales: used, customerId: 'c1' }).ok).toBe(false);
    expect(checkVoucher(voucher({ perCustomer: 1 }), { ...ctx, sales: used, customerId: 'c3' }).ok).toBe(true);
    // A voided sale gives its use back.
    const voided = [sale(200, { voucherCode: 'KOMIKET50', status: 'voided' })];
    expect(checkVoucher(voucher({ maxUses: 1 }), { ...ctx, sales: voided }).ok).toBe(true);
  });
});
