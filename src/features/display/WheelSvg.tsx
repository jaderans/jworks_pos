import type { WheelSlice } from '../../domain/wheel';

/** Prize colours in the JoshWorks palette; "Try again" is always the dark one. */
const COLORS = ['#1fa3a8', '#f7d820', '#087a86', '#ee9d17', '#5fcf94', '#e07a5f'];
const INK = ['#ffffff', '#2b2526', '#ffffff', '#2b2526', '#2b2526', '#ffffff'];
const R = 100;

const point = (deg: number, r = R) => {
  const a = (deg * Math.PI) / 180;
  return `${(r * Math.sin(a)).toFixed(2)} ${(-r * Math.cos(a)).toFixed(2)}`;
};

/**
 * The prize wheel, each slice as wide as its chance. `turn` turns it
 * clockwise; with `spinMs` it eases to a stop under the pointer at the top.
 */
export function WheelSvg({ slices, turn = 0, spinMs = 0, className }: { slices: readonly WheelSlice[]; turn?: number; spinMs?: number; className?: string }) {
  let k = 0;
  return (
    <svg viewBox="-112 -122 224 236" className={className} role="img" aria-label={`Prize wheel: ${slices.map((s) => s.label).join(', ')}`}>
      <g style={{ transform: `rotate(${turn}deg)`, transformBox: 'fill-box', transformOrigin: 'center', transition: spinMs ? `transform ${spinMs}ms cubic-bezier(0.1, 0.65, 0.12, 1)` : 'none' }}>
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
          const label = s.label.length > 18 ? `${s.label.slice(0, 17)}…` : s.label;
          return (
            <g key={`${s.id ?? 'try'}:${s.from}`}>
              {shape}
              {span >= 14 ? (
                <text transform={`rotate(${mid - 90}) translate(${R * 0.6} 0)`} textAnchor="middle" dominantBaseline="middle" fill={ink} fontSize={span < 30 ? 7 : 9} fontWeight={800}>
                  {label}
                </text>
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
