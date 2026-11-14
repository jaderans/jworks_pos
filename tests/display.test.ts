import { describe, expect, it } from 'vitest';
import { toCents } from '../src/lib/money';
import { priceCart, type BundleLike, type CartItem } from '../src/domain/cart';
import { bundleNudge, displayCart } from '../src/domain/display';

const P = toCents;
const item = (productId: string, name: string, price: number, qty: number, free = false): CartItem => ({
  key: productId, productId, name, categoryId: null, unitPrice: P(price), qty, free, freeReason: '', designerId: null,
});
const fiveCats: BundleLike = { id: 'b1', name: 'Cat Meme five', productIds: ['cat'], qty: 5, price: P(110) };
const trio: BundleLike = { id: 'b2', name: 'Sticker trio', productIds: ['cat', 'pawer', 'sbl'], qty: 3, price: P(50) };

describe('the customer screen', () => {
  it('nudges when the cart is one item short of a deal', () => {
    expect(bundleNudge(priceCart([item('cat', 'Cat Meme (Solo)', 25, 4)], [], []).lines, [fiveCats])).toBe('Add 1 more Cat Meme (Solo): 5 for ₱110');
    expect(bundleNudge(priceCart([item('cat', 'Cat Meme (Solo)', 25, 3)], [], []).lines, [fiveCats])).toBeNull();
    // A deal on several products names the deal.
    expect(bundleNudge(priceCart([item('cat', 'Cat Meme (Solo)', 25, 1), item('pawer', 'Pawer Litters', 20, 1)], [], []).lines, [trio])).toBe('Add 1 more from Sticker trio: 3 for ₱50');
  });

  it('never nudges toward a deal that costs more, or with free items', () => {
    const dear: BundleLike = { ...fiveCats, price: P(130) };
    expect(bundleNudge(priceCart([item('cat', 'Cat Meme (Solo)', 25, 4)], [], []).lines, [dear])).toBeNull();
    expect(bundleNudge(priceCart([item('cat', 'Cat Meme (Solo)', 25, 4, true)], [], []).lines, [fiveCats])).toBeNull();
  });

  it('shows each line, the deals as savings, and the total the customer pays', () => {
    const priced = priceCart([item('cat', 'Cat Meme (Solo)', 25, 5), item('couple', 'Couple Pack (live)', 240, 1)], [fiveCats], [{ id: 'd', label: 'Student', kind: 'percent', value: 10 }]);
    const c = displayCart(priced, [fiveCats]);
    expect(c.lines).toEqual([
      { name: 'Cat Meme (Solo)', qty: 5, total: P(125), free: false },
      { name: 'Couple Pack (live)', qty: 1, total: P(240), free: false },
    ]);
    expect(c.savings).toEqual([{ label: 'Cat Meme five', amount: P(15) }, { label: 'Student', amount: P(35) }]);
    expect([c.subtotal, c.total, c.count, c.nudge]).toEqual([P(365), P(315), 6, null]);
  });
});
