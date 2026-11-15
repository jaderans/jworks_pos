import { describe, expect, it } from 'vitest';
import { landingTurn, spinNudge, wheelSlices, type WheelConfig } from '../src/domain/wheel';
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

describe('same-size slices', () => {
  const equal = { ...cfg, look: 'equal' as const };
  it('draws every slice the same size, Try again included', () => {
    const slices = wheelSlices(equal);
    expect(slices).toHaveLength(5);
    for (const s of slices) expect(s.to - s.from).toBeCloseTo(72);
  });

  it('still stops on the prize the chances drew', () => {
    const slices = wheelSlices(equal);
    for (const id of ['solo', 'five', 'off', 'couple', null]) {
      for (const r of [0, 0.5, 0.999]) expect(slices[sliceUnderPointer(slices, landingTurn(slices, id, r))].id, `${id} at ${r}`).toBe(id);
    }
  });
});

describe('close to a spin', () => {
  const wheel = { on: true, minSpend: 25000, minItems: { count: 15, categoryId: 'stk' }, prizes: cfg.prizes } as unknown as WheelConfig;
  const line = (qty: number, categoryId = 'stk', free = false) => ({ qty, categoryId, free, productId: 'p' });
  it('says how many pesos more when the spend is close', () => {
    expect(spinNudge(wheel, { total: 23500, lines: [line(6)] }, 'Sticker')).toEqual({ ready: false, text: 'Add ₱15 more to spin the prize wheel!' });
  });
  it('says how many pieces more when that is closer', () => {
    expect(spinNudge(wheel, { total: 18000, lines: [line(12)] }, 'Sticker')).toEqual({ ready: false, text: '3 more stickers to spin the prize wheel!' });
    expect(spinNudge(wheel, { total: 18000, lines: [line(14)] }, 'Sticker')?.text).toBe('1 more sticker to spin the prize wheel!');
  });
  it('says nothing when far off, or when the wheel is off; cheers when this sale spins', () => {
    expect(spinNudge(wheel, { total: 9000, lines: [line(3)] }, 'Sticker')).toBeNull();
    expect(spinNudge({ ...wheel, on: false }, { total: 24000, lines: [line(6)] }, 'Sticker')).toBeNull();
    expect(spinNudge(wheel, { total: 26000, lines: [line(6)] }, 'Sticker')).toEqual({ ready: true, text: 'This sale spins the prize wheel!' });
    // Free items don't count toward the pieces.
    expect(spinNudge(wheel, { total: 9000, lines: [line(10), line(5, 'stk', true)] }, 'Sticker')?.text).toBe('5 more stickers to spin the prize wheel!');
  });
  it('with more than one spin: how many this sale spins, and how much more for the next', () => {
    const marks = { ...wheel, spins: { per: 'mark', count: 3 } } as WheelConfig;
    expect(spinNudge(marks, { total: 26000, lines: [line(6)] }, 'Sticker')).toEqual({ ready: true, text: 'This sale spins the prize wheel!' });
    expect(spinNudge(marks, { total: 46000, lines: [line(6)] }, 'Sticker')).toEqual({ ready: true, text: 'This sale spins the prize wheel!', more: 'Add ₱40 more for 2 spins!' });
    expect(spinNudge(marks, { total: 52000, lines: [line(6)] }, 'Sticker')).toEqual({ ready: true, text: 'This sale spins the prize wheel 2 times!' });
    // 43 stickers: 2 more reach the third mark (45), closer than the spend.
    expect(spinNudge(marks, { total: 52000, lines: [line(43)] }, 'Sticker')?.more).toBe('2 more stickers for 3 spins!');
    expect(spinNudge(marks, { total: 74000, lines: [line(6)] }, 'Sticker')?.more).toBe('Add ₱10 more for 3 spins!');
    // At the most: nothing more to say.
    expect(spinNudge(marks, { total: 99000, lines: [line(6)] }, 'Sticker')).toEqual({ ready: true, text: 'This sale spins the prize wheel 3 times!' });
    // A set number: said before and after the mark.
    const two = { ...wheel, spins: { per: 'sale', count: 2 } } as WheelConfig;
    expect(spinNudge(two, { total: 23500, lines: [line(6)] }, 'Sticker')?.text).toBe('Add ₱15 more to spin the prize wheel 2 times!');
    expect(spinNudge(two, { total: 26000, lines: [line(6)] }, 'Sticker')).toEqual({ ready: true, text: 'This sale spins the prize wheel 2 times!' });
  });
});
