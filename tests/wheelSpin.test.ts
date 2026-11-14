import { describe, expect, it } from 'vitest';
import { landingTurn, wheelSlices, type WheelConfig } from '../src/domain/wheel';
import { sliceUnderPointer, spinAngle } from '../src/domain/wheelSpin';

const cfg = {
  prizes: [
    { id: 'solo', label: 'Free Solo Pack', kind: 'item', productId: 'p1', voucher: null, chance: 8, perDay: null },
    { id: 'five', label: '5 Pcs Sticker', kind: 'item', productId: 'p2', voucher: null, chance: 25, perDay: null },
    { id: 'off', label: '50 php Discount', kind: 'voucher', productId: null, voucher: { kind: 'amount', value: 5000 }, chance: 5, perDay: null },
    { id: 'couple', label: 'Couple Pack', kind: 'item', productId: 'p3', voucher: null, chance: 10, perDay: null },
  ],
} as unknown as Pick<WheelConfig, 'prizes'>;

describe('the wheel spin', () => {
  it('stops with the drawn prize under the pointer, wherever in its slice', () => {
    const slices = wheelSlices(cfg);
    for (const id of ['solo', 'five', 'off', 'couple', null]) {
      for (const r of [0, 0.5, 0.999]) {
        const turn = landingTurn(slices, id, r);
        expect(slices[sliceUnderPointer(slices, turn)].id, `${id} at ${r}`).toBe(id);
      }
    }
  });

  it('starts fast and slows to a stop', () => {
    expect(spinAngle(0)).toBe(0);
    expect(spinAngle(1)).toBe(1);
    expect(spinAngle(0.25)).toBeGreaterThan(0.6);
    // The last fifth of the time covers only a sliver of the turn.
    expect(spinAngle(1) - spinAngle(0.8)).toBeLessThan(0.002);
  });
});
