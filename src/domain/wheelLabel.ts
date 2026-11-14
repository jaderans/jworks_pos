/**
 * Fitting a prize's name into its slice of the wheel. The wheel's radius is
 * 100; a name runs along the slice from the rim toward the hub, as big as the
 * slice's length and width allow, on one, two or three lines. Names on the
 * left half are turned so they read the right way up.
 */

/** Where text may go: from just outside the hub to just inside the rim. */
export const LABEL_INNER = 19;
export const LABEL_OUTER = 93;
const MAX_FONT = 12;
const MIN_FONT = 4.2;
const LINE = 1.12;

/** About how wide a bold label is, in ems. Wide letters count more, narrow ones less. */
export function textEm(s: string): number {
  let w = 0;
  for (const ch of s) {
    if (ch === ' ') w += 0.27;
    else if (/[il1.,:;'!|]/.test(ch)) w += 0.3;
    else if (/[mwMW]/.test(ch)) w += 0.88;
    else if (/[A-Z]/.test(ch)) w += 0.7;
    else if (/[0-9]/.test(ch)) w += 0.6;
    else w += 0.58;
  }
  return w;
}

/** Split into n lines of about even width, at spaces. */
function splitLines(label: string, n: number): string[] | null {
  const words = label.trim().split(/\s+/);
  if (n === 1) return [words.join(' ')];
  if (words.length < n) return null;
  let best: string[] | null = null;
  let bestW = Infinity;
  // Every way to cut the words into n runs (labels are short, so this is small).
  const cut = (start: number, left: number, acc: string[]) => {
    if (left === 1) {
      const lines = [...acc, words.slice(start).join(' ')];
      const w = Math.max(...lines.map(textEm));
      if (w < bestW) {
        bestW = w;
        best = lines;
      }
      return;
    }
    for (let end = start + 1; end <= words.length - left + 1; end++) cut(end, left - 1, [...acc, words.slice(start, end).join(' ')]);
  };
  cut(0, n, []);
  return best;
}

export interface WheelLabelLayout {
  lines: string[];
  fontSize: number;
  /** Turned 180° so it reads the right way up on the left half. */
  flip: boolean;
}

/**
 * The biggest text that fits: no longer than the slice is deep, and no taller
 * than the slice is wide where the text's inner end sits (slices narrow
 * toward the hub). Null when the slice is too thin for any text.
 */
export function wheelLabel(label: string, from: number, to: number): WheelLabelLayout | null {
  const span = to - from;
  const text = label.trim();
  if (!text || span <= 0) return null;
  const mid = (((from + span / 2) % 360) + 360) % 360;
  const flip = mid > 180 && mid < 360;
  const depth = LABEL_OUTER - LABEL_INNER;
  const half = (Math.min(span, 180) * Math.PI) / 360;
  /** How tall the text may be at radius r: the slice's width there, less a margin. */
  const room = (r: number) => (span >= 180 ? 2 * r : 2 * r * Math.sin(half)) * 0.86;
  const fits = (lines: string[], f: number) => {
    const width = Math.max(...lines.map(textEm)) * f;
    if (width > depth) return false;
    return lines.length * f * LINE <= room(LABEL_OUTER - width);
  };
  let best: { lines: string[]; f: number } | null = null;
  for (let n = 1; n <= 3; n++) {
    const lines = splitLines(text, n);
    if (!lines) break;
    let f = MAX_FONT;
    while (f >= MIN_FONT && !fits(lines, f)) f -= 0.2;
    // More lines only when the text gets clearly bigger.
    if (f >= MIN_FONT && (!best || f > best.f + 0.6)) best = { lines, f };
  }
  if (best) return { lines: best.lines, fontSize: Math.round(best.f * 10) / 10, flip };
  // Too long even at the smallest size: shorten it to what fits on one line.
  for (let len = text.length - 1; len >= 3; len--) {
    const short = `${text.slice(0, len).trimEnd()}…`;
    if (fits([short], MIN_FONT)) return { lines: [short], fontSize: MIN_FONT, flip };
  }
  return null;
}
