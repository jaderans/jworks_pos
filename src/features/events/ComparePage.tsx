import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, BarChart3 } from 'lucide-react';
import { db } from '../../db/db';
import { useEvents } from '../../hooks/data';
import { EmptyState, Loading, PageHeader } from '../../components/ui';
import { BarList } from '../../components/charts';
import { peso } from '../../lib/money';
import { fmtDateRange } from '../../lib/time';
import { compareEvent, type EventComparison } from '../../domain/plan';

const MAX = 5;

interface Metric {
  label: string;
  hint?: string;
  value: (c: EventComparison) => number | null;
  format: (v: number) => string;
  better?: 'high' | 'low';
}

const METRICS: Metric[] = [
  { label: 'Sales', value: (c) => c.gross, format: peso, better: 'high' },
  { label: 'Transactions', value: (c) => c.transactions, format: String, better: 'high' },
  { label: 'Average sale', value: (c) => c.avgSale, format: peso, better: 'high' },
  { label: 'Items sold', value: (c) => c.items, format: String, better: 'high' },
  { label: 'Hours open', hint: 'Any register open; two phones at once count once', value: (c) => c.hours, format: (v) => `${v} h` },
  { label: 'Sales per open hour', value: (c) => c.perHour, format: peso, better: 'high' },
  { label: 'Booth fee', value: (c) => c.boothFee, format: peso },
  { label: 'Sales per ₱1 of booth fee', hint: 'How hard the booth fee worked', value: (c) => c.perBoothPeso, format: (v) => `₱${v}`, better: 'high' },
  { label: 'Profit after production cost', value: (c) => c.tradingProfit, format: peso, better: 'high' },
  { label: 'After booth fee and costs', value: (c) => c.eventResult, format: peso, better: 'high' },
  { label: 'Paid in cash', value: (c) => c.cashPct, format: (v) => `${v}%` },
  { label: 'Sell-through', hint: 'Of the stock counted in', value: (c) => c.sellThrough, format: (v) => `${v}%`, better: 'high' },
  { label: 'Discounts given', value: (c) => c.discounts, format: peso, better: 'low' },
];

/** Past events side by side: which booth was worth it, per hour and per peso of booth fee. */
export default function ComparePage() {
  const events = useEvents();
  const salesCount = useLiveQuery(() => db.sales.count(), []);
  const [picked, setPicked] = useState<string[] | null>(null);
  const [rows, setRows] = useState<EventComparison[] | null>(null);

  const dated = useMemo(() => (events ?? []).filter((e) => e.startDate).sort((a, b) => b.startDate.localeCompare(a.startDate)), [events]);
  useEffect(() => {
    if (picked === null && events) setPicked(dated.slice(0, 4).map((e) => e.id));
  }, [events, dated, picked]);

  useEffect(() => {
    if (!picked) return;
    let live = true;
    void (async () => {
      const { loadReportInput } = await import('../../reports/loadReport');
      const inputs = await Promise.all(picked.map(loadReportInput));
      if (!live) return;
      setRows(inputs.filter((x): x is NonNullable<typeof x> => !!x).map(compareEvent).sort((a, b) => (a.startDate || '').localeCompare(b.startDate || '')));
    })();
    return () => {
      live = false;
    };
  }, [picked, salesCount]);

  if (!events || !picked) return <Loading />;
  const toggle = (id: string) => setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : picked.length >= MAX ? picked : [...picked, id]);

  return (
    <div className="page">
      <PageHeader
        eyebrow={
          <Link to="/events" className="row small strong" style={{ gap: 4 }}>
            <ArrowLeft size={14} /> All events
          </Link>
        }
        title="Compare events"
        subtitle="Which booths were worth it: sales per open hour, what the booth fee earned back, and what sold. Pick up to five."
      />
      <div className="chip-row" role="group" aria-label="Events to compare">
        {dated.map((e) => (
          <button key={e.id} type="button" className="chip" aria-pressed={picked.includes(e.id)} onClick={() => toggle(e.id)} disabled={!picked.includes(e.id) && picked.length >= MAX}>
            {e.name} <span className="muted tiny">{fmtDateRange(e.startDate, e.endDate)}</span>
          </button>
        ))}
      </div>
      {!rows ? (
        <Loading />
      ) : rows.length < 2 ? (
        <EmptyState icon={<BarChart3 size={44} />} title="Pick at least two events">
          Events with sales compare best. Each event’s numbers come from its own report.
        </EmptyState>
      ) : (
        <>
          <div className="table-wrap">
            <table className="table compare-table">
              <thead>
                <tr>
                  <th>
                    <span className="sr-only">Measure</span>
                  </th>
                  {rows.map((c) => (
                    <th key={c.eventId} className="r">
                      {c.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {METRICS.map((m) => {
                  const values = rows.map(m.value);
                  const known = values.filter((v): v is number => v !== null);
                  const best = m.better && known.length > 1 ? (m.better === 'high' ? Math.max(...known) : Math.min(...known)) : null;
                  return (
                    <tr key={m.label}>
                      <th scope="row" style={{ fontWeight: 700 }}>
                        {m.label}
                        {m.hint ? <div className="muted tiny">{m.hint}</div> : null}
                      </th>
                      {values.map((v, i) => (
                        <td key={rows[i].eventId} className={`r ${best !== null && v === best ? 'best' : ''}`}>
                          {v === null ? '—' : m.format(v)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
                <tr>
                  <th scope="row" style={{ fontWeight: 700 }}>
                    Best sellers
                  </th>
                  {rows.map((c) => (
                    <td key={c.eventId} className="r small">
                      {c.top.length ? c.top.map((t) => <div key={t.name}>{`${t.name} ×${t.qty}`}</div>) : '—'}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <div className="grid-2">
            <Chart title="Sales">{<BarList rows={rows.map((c) => ({ key: c.eventId, name: c.name, value: c.gross }))} />}</Chart>
            <Chart title="Sales per open hour">
              <BarList rows={rows.filter((c) => c.perHour !== null).map((c) => ({ key: c.eventId, name: c.name, value: c.perHour ?? 0 }))} empty="Needs register open and close times." />
            </Chart>
          </div>
        </>
      )}
    </div>
  );
}

function Chart({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="card">
      <h3 className="dot-title">{title}</h3>
      {children}
    </div>
  );
}
