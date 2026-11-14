import { useEffect, useRef } from 'react';
import type { WheelSlice } from '../../domain/wheel';
import { LABEL_OUTER, wheelLabel } from '../../domain/wheelLabel';
import { sliceUnderPointer, spinAngle } from '../../domain/wheelSpin';

/** Prize colours in the JoshWorks palette; "Try again" is always the dark one. */
const COLORS = ['#1fa3a8', '#f7d820', '#087a86', '#ee9d17', '#5fcf94', '#e07a5f'];
const INK = ['#ffffff', '#2b2526', '#ffffff', '#2b2526', '#2b2526', '#ffffff'];
const R = 100;
/** Turning slowly while it waits to be spun, degrees a second. */
const IDLE_SPEED = 9;

const point = (deg: number, r = R) => {
  const a = (deg * Math.PI) / 180;
  return `${(r * Math.sin(a)).toFixed(2)} ${(-r * Math.cos(a)).toFixed(2)}`;
};

/**
 * The prize wheel, each slice as wide as its chance. `turn` turns it
 * clockwise; with `spinMs` it eases to a stop under the pointer at the top.
 * The turning is drawn frame by frame (not a CSS transition), so it spins
 * even when the computer asks for less motion; `onTick` fires each time a
 * slice passes the pointer. `idle` turns it slowly while it waits.
 */
export function WheelSvg({
  slices,
  turn = 0,
  spinMs = 0,
  idle = false,
  onTick,
  className,
}: {
  slices: readonly WheelSlice[];
  turn?: number;
  spinMs?: number;
  idle?: boolean;
  onTick?: () => void;
  className?: string;
}) {
  const g = useRef<SVGGElement>(null);
  const angle = useRef(0);
  const tick = useRef(onTick);
  tick.current = onTick;

  useEffect(() => {
    const el = g.current;
    if (!el) return;
    const set = (a: number) => {
      angle.current = a;
      el.setAttribute('transform', `rotate(${a.toFixed(3)})`);
    };
    let raf = 0;
    if (idle && !spinMs) {
      let last = performance.now();
      const drift = (now: number) => {
        set((angle.current + ((now - last) / 1000) * IDLE_SPEED) % 360);
        last = now;
        raf = requestAnimationFrame(drift);
      };
      raf = requestAnimationFrame(drift);
      return () => cancelAnimationFrame(raf);
    }
    if (!spinMs) {
      set(turn);
      return;
    }
    // From wherever it is now, a whole number of turns further, to land on `turn`.
    const from = angle.current;
    const to = turn + 360 * Math.ceil(Math.max(0, from - turn) / 360);
    const start = performance.now();
    let under = sliceUnderPointer(slices, from);
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / spinMs);
      const a = from + (to - from) * spinAngle(t);
      set(a);
      const s = sliceUnderPointer(slices, a);
      if (s !== under) {
        under = s;
        tick.current?.();
      }
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [turn, spinMs, idle]); // eslint-disable-line react-hooks/exhaustive-deps

  let k = 0;
  return (
    <svg viewBox="-112 -122 224 236" className={className} role="img" aria-label={`Prize wheel: ${slices.map((s) => s.label).join(', ')}`}>
      <g ref={g} transform={`rotate(${angle.current})`}>
        {slices.map((s) => {
          const tryAgain = s.id === null;
          const i = tryAgain ? -1 : k++ % COLORS.length;
          const fill = tryAgain ? '#26383a' : COLORS[i];
          const ink = tryAgain ? '#cfe3e4' : INK[i];
          const span = s.to - s.from;
          const mid = s.from + span / 2;
          const shape =
            span >= 359.99 ? (
              <circle r={R} fill={fill} />
            ) : (
              <path d={`M 0 0 L ${point(s.from)} A ${R} ${R} 0 ${span > 180 ? 1 : 0} 1 ${point(s.to)} Z`} fill={fill} stroke="#0f1516" strokeWidth={1.2} />
            );
          // The name fits its slice: from the rim inward, as big as the slice allows, the right way up.
          const fit = wheelLabel(s.label, s.from, s.to);
          return (
            <g key={`${s.id ?? 'try'}:${s.from}`}>
              {shape}
              {fit ? (
                <g transform={fit.flip ? `rotate(${mid + 90})` : `rotate(${mid - 90})`} fill={ink} fontSize={fit.fontSize} fontWeight={800}>
                  {fit.lines.map((line, n) => (
                    <text
                      key={n}
                      x={fit.flip ? -LABEL_OUTER : LABEL_OUTER}
                      y={(n - (fit.lines.length - 1) / 2) * fit.fontSize * 1.12}
                      textAnchor={fit.flip ? 'start' : 'end'}
                      dominantBaseline="central"
                    >
                      {line}
                    </text>
                  ))}
                </g>
              ) : null}
            </g>
          );
        })}
      </g>
      <circle r={13} fill="#0f1516" stroke="#f7d820" strokeWidth={3} />
      <polygon points="0,-90 -10,-116 10,-116" fill="#f7d820" stroke="#0f1516" strokeWidth={2} />
    </svg>
  );
}
