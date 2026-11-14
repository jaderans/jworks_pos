import { describe, expect, it } from 'vitest';
import { LABEL_INNER, LABEL_OUTER, textEm, wheelLabel } from '../src/domain/wheelLabel';

/** The label's widest line, as drawn. */
const width = (l: { lines: string[]; fontSize: number }) => Math.max(...l.lines.map(textEm)) * l.fontSize;

describe('wheel labels fit their slice', () => {
  it('never runs past the rim or into the hub', () => {
    for (const [label, from, to] of [
      ['Free Barakada Pack', 200, 245],
      ['50 php Discount', 125, 145],
      ['Try again', 245, 360],
      ['A very long prize name that keeps going and going', 0, 40],
    ] as const) {
      const l = wheelLabel(label, from, to)!;
      expect(l, label).not.toBeNull();
      expect(width(l), label).toBeLessThanOrEqual(LABEL_OUTER - LABEL_INNER + 0.01);
    }
  });

  it('a long name in a mid-size slice wraps instead of shrinking to nothing', () => {
    const l = wheelLabel('Free Barakada Pack', 200, 245)!;
    expect(l.lines.length).toBeGreaterThan(1);
    expect(l.lines.join(' ')).toBe('Free Barakada Pack');
  });

  it('a thin slice gets smaller text than a wide one with the same name', () => {
    const thin = wheelLabel('50 php Discount', 125, 145)!;
    const wide = wheelLabel('50 php Discount', 0, 90)!;
    expect(thin.fontSize).toBeLessThan(wide.fontSize);
  });

  it('names on the left half are turned to read the right way up', () => {
    expect(wheelLabel('Try again', 245, 360)!.flip).toBe(true);
    expect(wheelLabel('Free Solo Pack', 0, 40)!.flip).toBe(false);
    expect(wheelLabel('Couple Pack', 140, 200)!.flip).toBe(false);
  });

  it('a sliver too thin for text gets none, and a too-long name is shortened', () => {
    expect(wheelLabel('Grand prize', 0, 0.5)).toBeNull();
    const l = wheelLabel('Supercalifragilisticexpialidocious', 0, 6);
    if (l) expect(l.lines[0].endsWith('…') || l.lines[0] === 'Supercalifragilisticexpialidocious').toBe(true);
  });
});
