import { useState, type ReactNode } from 'react';
import { peso, type Cents } from '../lib/money';
import { hourLabel } from '../lib/time';

/** Round a maximum up to a readable axis top (1, 2, 5 × 10ⁿ). */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * exp;
}

const compact = (c: Cents) => {
  const p = c / 100;
  if (p >= 1_000_000) return `₱${(p / 1_000_000).toFixed(p >= 10_000_000 ? 0 : 1)}M`;
  if (p >= 1000) return `₱${(p / 1000).toFixed(p >= 10_000 ? 0 : 1)}k`;
  return `₱${Math.round(p)}`;
};

/** Sales by hour as bars, with a hover/focus tooltip. Empty hours in between show as gaps. */
export function HourBars({ data, label = 'Sales by hour', height = 220 }: { data: { hour: number; amount: Cents; count: number }[]; label?: string; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  if (data.length === 0) return <p className="muted small">No sales yet.</p>;
  const minH = Math.min(...data.map((d) => d.hour));
  const maxH = Math.max(...data.map((d) => d.hour));
  const hours: { hour: number; amount: Cents; count: number }[] = [];
  for (let h = minH; h <= maxH; h++) hours.push(data.find((d) => d.hour === h) ?? { hour: h, amount: 0, count: 0 });
  const W = 640;
  const H = height;
  const padL = 46;
  const padB = 26;
  const padT = 10;
  const top = niceMax(Math.max(...hours.map((d) => d.amount)));
  const plotW = W - padL - 8;
  const plotH = H - padB - padT;
  const slot = plotW / hours.length;
  const barW = Math.max(6, Math.min(40, slot * 0.62));
  const y = (v: number) => padT + plotH - (v / top) * plotH;
  const every = hours.length > 14 ? 3 : hours.length > 8 ? 2 : 1;
  const hovered = hover !== null ? hours[hover] : null;
  return (
    <div style={{ position: 'relative' }}>
      <svg className="chart-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}: ${hours.filter((h) => h.amount > 0).map((h) => `${hourLabel(h.hour)} ${peso(h.amount)}`).join(', ')}`}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line className={f === 0 ? 'axis' : 'grid'} x1={padL} x2={W - 8} y1={y(top * f)} y2={y(top * f)} />
            <text className="lbl" x={padL - 8} y={y(top * f) + 4} textAnchor="end">
              {compact(top * f)}
            </text>
          </g>
        ))}
        {hours.map((d, i) => {
          const cx = padL + slot * i + slot / 2;
          const h = Math.max(d.amount > 0 ? 2 : 0, plotH - (y(d.amount) - padT));
          return (
            <g key={d.hour} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={d.amount > 0 ? 0 : -1}>
              <rect x={padL + slot * i} y={padT} width={slot} height={plotH} fill="transparent" />
              {d.amount > 0 ? <rect className={`bar ${hover === i ? 'on' : ''}`} x={cx - barW / 2} y={padT + plotH - h} width={barW} height={h} rx={4} /> : null}
              {i % every === 0 ? (
                <text className="lbl" x={cx} y={H - 8} textAnchor="middle">
                  {hourLabel(d.hour)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {hovered ? (
        <div className="chart-tip" style={{ left: `${((padL + slot * (hover as number) + slot / 2) / W) * 100}%`, top: `${(y(hovered.amount) / H) * 100}%` }}>
          {hourLabel(hovered.hour)}: {peso(hovered.amount)} · {hovered.count} sale{hovered.count === 1 ? '' : 's'}
        </div>
      ) : null}
    </div>
  );
}

/** Horizontal bars for ranked lists (top products, payment split, category mix). */
export function BarList({ rows, format = (v) => peso(v), empty = 'Nothing yet.' }: { rows: { key: string; name: ReactNode; value: number; sub?: ReactNode }[]; format?: (v: number) => ReactNode; empty?: string }) {
  if (rows.length === 0) return <p className="muted small">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div className="bars">
      {rows.map((r) => (
        <div key={r.key} className="bar-row" title={typeof r.name === 'string' ? r.name : undefined}>
          <span className="name">{r.name}</span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${Math.max(1, (r.value / max) * 100)}%`, display: 'block' }} />
          </span>
          <span className="val">
            {format(r.value)}
            {r.sub ? <span className="muted tiny"> {r.sub}</span> : null}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Progress toward a mark (break-even, a target). */
export function Meter({ value, mark, max, ok }: { value: number; mark: number | null; max?: number; ok: boolean }) {
  const top = Math.max(max ?? 0, value, mark ?? 0, 1) * 1.08;
  return (
    <div className={`meter-track ${ok ? '' : 'short'}`} role="presentation">
      <div className={`meter-fill ${ok ? '' : 'short'}`} style={{ width: `${Math.min(100, (Math.max(0, value) / top) * 100)}%` }} />
      {mark !== null ? <div className="meter-mark" style={{ left: `${(mark / top) * 100}%` }} /> : null}
    </div>
  );
}
