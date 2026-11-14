import { describe, expect, it } from 'vitest';
import { toCents } from '../src/lib/money';
import { DEFAULT_MAKE_INTO, makeIntoName, makeIntoPrice, makeIntoRates } from '../src/domain/makeInto';
import { DEFAULT_PRINT_RATES, canMakeInto, customLine, illustrationLine, lineTotal, makeIntoLine } from '../src/domain/print';

const P = toCents;

describe('make it into a pin, keychain, couple stickers or a reprint', () => {
  it('a pin, keychain or couple set is the design’s price plus the add-on; a reprint is its own price', () => {
    const [pin, keychain, couple, reprint] = makeIntoRates([
      { kind: 'pin', label: 'Pin', addOn: P(60), withDesign: true },
      { kind: 'reprint', label: 'Extra reprint', addOn: P(30), withDesign: false },
    ]);
    expect(makeIntoPrice(pin, P(240))).toBe(P(300));
    expect(makeIntoPrice(keychain, P(240))).toBe(P(240));
    expect(makeIntoPrice(couple, P(240))).toBe(P(240));
    expect(makeIntoPrice(reprint, P(240))).toBe(P(30));
  });

  it('keeps every kind, in order, even when the rate card has none saved', () => {
    expect(makeIntoRates(undefined).map((r) => [r.kind, r.addOn])).toEqual(DEFAULT_MAKE_INTO.map((r) => [r.kind, 0]));
  });

  it('names the new line after the design', () => {
    const [pin, keychain, couple, reprint] = DEFAULT_MAKE_INTO;
    expect(makeIntoName(pin, 'Couple Pack (live)')).toBe('Couple Pack (live) as a pin');
    expect(makeIntoName(keychain, 'Sticker illustration, detailed: 2 designs')).toBe('Sticker illustration, detailed: 2 designs as a keychain');
    expect(makeIntoName(couple, 'Pet portrait')).toBe('Pet portrait, couple stickers');
    expect(makeIntoName(reprint, 'Pet portrait')).toBe('Extra reprint of Pet portrait');
  });
});

describe('the make-into line on a service order', () => {
  const rates = makeIntoRates([{ kind: 'pin', label: 'Pin', addOn: P(30), withDesign: true }]);
  it('one pin per design, each the design’s share of the illustration plus the add-on', () => {
    const art = illustrationLine(DEFAULT_PRINT_RATES, 'detailed', 2);
    const line = makeIntoLine(rates[0], art);
    expect(line).toMatchObject({ kind: 'makeInto', makeInto: 'pin', qty: 2, unitPrice: Math.round(lineTotal(art) / 2) + P(30), unitCost: null, a4: 0 });
    expect(line.label).toBe('Sticker illustration, detailed: 2 designs as a pin');
  });
  it('a custom piece keeps its quantity; a reprint is only its own price', () => {
    const piece = customLine('Pet portrait', 3, P(240));
    expect(makeIntoLine(rates[3], piece)).toMatchObject({ qty: 3, unitPrice: 0, label: 'Extra reprint of Pet portrait' });
    expect(canMakeInto(piece)).toBe(true);
    expect(canMakeInto(makeIntoLine(rates[0], piece))).toBe(false);
  });
});
