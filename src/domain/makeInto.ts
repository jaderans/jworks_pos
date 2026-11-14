import type { Cents } from '../lib/money';

/**
 * "Make it into…": a design a customer already has on an order (a Couple
 * Pack, an illustration, a custom piece) turned into a pin or a keychain, a
 * couple of matching stickers, or printed again. A pin, keychain or couple
 * set costs the design's own price plus an add-on from the rate card; an
 * extra reprint is just its own price. The add-ons start at ₱0 for the
 * owner to set.
 */

export type MakeIntoKind = 'pin' | 'keychain' | 'couple' | 'reprint';

export interface MakeIntoRate {
  kind: MakeIntoKind;
  /** On the button and the order line: "Pin", "Keychain"… */
  label: string;
  /** Per piece, on top of the design's price when withDesign. */
  addOn: Cents;
  /** Pins, keychains and couple sets include the design's own price; a reprint doesn't. */
  withDesign: boolean;
}

export const DEFAULT_MAKE_INTO: MakeIntoRate[] = [
  { kind: 'pin', label: 'Pin', addOn: 0, withDesign: true },
  { kind: 'keychain', label: 'Keychain', addOn: 0, withDesign: true },
  { kind: 'couple', label: 'Couple stickers', addOn: 0, withDesign: true },
  { kind: 'reprint', label: 'Extra reprint', addOn: 0, withDesign: false },
];

/** Each kind once, in the default order, with whatever the rate card has saved. */
export function makeIntoRates(saved: readonly MakeIntoRate[] | undefined): MakeIntoRate[] {
  return DEFAULT_MAKE_INTO.map((d) => ({ ...d, ...(saved ?? []).find((s) => s.kind === d.kind) }));
}

/** One piece: the design's price (when it counts) plus the add-on. */
export const makeIntoPrice = (rate: Pick<MakeIntoRate, 'addOn' | 'withDesign'>, designUnit: Cents): Cents => (rate.withDesign ? Math.max(0, designUnit) : 0) + Math.max(0, rate.addOn);

/** "Couple Pack (live) as a pin", "Extra reprint of Couple Pack (live)". */
export function makeIntoName(rate: Pick<MakeIntoRate, 'kind' | 'label'>, design: string): string {
  const d = design.trim();
  switch (rate.kind) {
    case 'reprint':
      return `Extra reprint of ${d}`;
    case 'couple':
      return `${d}, couple stickers`;
    default:
      return `${d} as a ${rate.label.toLowerCase()}`;
  }
}
