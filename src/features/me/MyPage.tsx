import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { CalendarDays, Palette, Wallet } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { alive, db } from '../../db/db';
import { Badge, Callout, EmptyState, Loading, PageHeader, Stat } from '../../components/ui';
import { peso, sum } from '../../lib/money';
import { fmtDateRange } from '../../lib/time';
import { rosterHours } from '../../domain/share';
import { lineRevenue } from '../../domain/cart';
import { ROLE_LABEL } from '../../services/team';

/** What a designer (or partner, or cashier) sees about themselves: shifts, payouts, their designs' sales. */
export default function MyPage() {
  const app = useApp();
  const [params] = useSearchParams();
  const as = app.role === 'owner' ? params.get('as') : null;
  const memberId = as ?? app.member?.id ?? null;

  const data = useLiveQuery(async () => {
    if (!memberId) return null;
    const member = await db.members.get(memberId);
    const roster = alive(await db.roster.where('memberId').equals(memberId).toArray());
    const payouts = alive(await db.payouts.where('memberId').equals(memberId).toArray());
    const events = alive(await db.events.toArray());
    const designs = alive(await db.products.where('designerId').equals(memberId).toArray());
    const designIds = new Set(designs.map((p) => p.id));
    const sales = designIds.size ? alive(await db.sales.toArray()).filter((s) => s.status === 'completed' && s.lines.some((l) => designIds.has(l.productId))) : [];
    return { member, roster, payouts, events, designs, sales };
  }, [memberId]);

  const designStats = useMemo(() => {
    if (!data) return [];
    const m = new Map<string, { name: string; units: number; revenue: number }>();
    for (const p of data.designs) m.set(p.id, { name: p.name, units: 0, revenue: 0 });
    for (const s of data.sales) {
      const rev = lineRevenue(s);
      s.lines.forEach((l, i) => {
        const r = m.get(l.productId);
        if (r) {
          r.units += l.qty;
          r.revenue += rev[i];
        }
      });
    }
    return [...m.values()].sort((a, b) => b.units - a.units);
  }, [data]);

  if (!memberId) {
    return (
      <div className="page narrow">
        <EmptyState title="Who are you?">Choose yourself with the name button at the top right, or sign in through Settings → Cloud sync.</EmptyState>
      </div>
    );
  }
  if (!data) return <Loading />;
  const eventName = new Map(data.events.map((e) => [e.id, e]));
  const pending = data.payouts.filter((p) => p.status === 'pending');
  const paid = data.payouts.filter((p) => p.status === 'paid');

  return (
    <div className="page narrow">
      <PageHeader
        eyebrow={as ? 'Owner preview: what this person sees' : data.member ? ROLE_LABEL[data.member.appRole] : undefined}
        title={data.member ? `Hi, ${data.member.name}` : 'My page'}
        subtitle="Your shifts, your payouts, and how your designs are selling."
      />
      <div className="stats">
        <Stat label="To be paid" value={peso(sum(pending.map((p) => p.amount)))} hint={`${pending.length} payout${pending.length === 1 ? '' : 's'}`} />
        <Stat label="Paid so far" value={peso(sum(paid.map((p) => p.amount)))} />
        <Stat label="Events worked" value={String(data.roster.length)} />
        <Stat label="Your designs sold" value={String(sum(designStats.map((d) => d.units)))} hint={`${data.designs.length} design${data.designs.length === 1 ? '' : 's'}`} />
      </div>

      <section className="stack">
        <h2 className="row" style={{ gap: 8 }}>
          <Wallet size={20} className="teal" /> Payouts
        </h2>
        {data.payouts.length ? (
          <div className="card flush">
            <div className="list">
              {data.payouts
                .slice()
                .sort((a, b) => b.createdAt - a.createdAt)
                .map((p) => (
                  <div key={p.id} className="list-item" style={{ alignItems: 'flex-start' }}>
                    <span className="main-text">
                      <b>{eventName.get(p.eventId)?.name ?? 'Event'}</b>
                      <span style={{ whiteSpace: 'normal' }}>
                        {p.kind === 'staff' ? 'Staff share' : p.kind === 'partner' ? 'Partner share' : 'Design royalty'} · {p.detail}
                      </span>
                    </span>
                    <div className="right">
                      <b className="num">{peso(p.amount)}</b>
                      <div>{p.status === 'paid' ? <Badge tone="good">Paid{p.method ? ` · ${p.method}` : ''}</Badge> : <Badge tone="warn">To be paid</Badge>}</div>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        ) : (
          <p className="muted small">No payouts yet. They appear after the owner saves the split for an event.</p>
        )}
      </section>

      <section className="stack">
        <h2 className="row" style={{ gap: 8 }}>
          <CalendarDays size={20} className="teal" /> Events you&rsquo;re on
        </h2>
        {data.roster.length ? (
          <div className="card flush">
            <div className="list">
              {data.roster.map((r) => {
                const ev = eventName.get(r.eventId);
                return (
                  <div key={r.id} className="list-item">
                    <span className="main-text">
                      <b>{ev?.name ?? 'Event'}</b>
                      <span>
                        {ev ? fmtDateRange(ev.startDate, ev.endDate) : ''} · {r.roleLabel} · {rosterHours(r)} h
                      </span>
                    </span>
                    {ev ? <Badge tone={ev.status === 'live' ? 'good' : undefined}>{ev.status}</Badge> : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <p className="muted small">Not on any event roster yet.</p>
        )}
      </section>

      <section className="stack">
        <h2 className="row" style={{ gap: 8 }}>
          <Palette size={20} className="teal" /> Your designs
        </h2>
        {designStats.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Design</th>
                  <th className="r">Sold</th>
                  <th className="r">Sales</th>
                </tr>
              </thead>
              <tbody>
                {designStats.map((d) => (
                  <tr key={d.name}>
                    <td>{d.name}</td>
                    <td className="r strong">{d.units}</td>
                    <td className="r">{peso(d.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted small">No products credited to you yet. The owner sets design credit on each product.</p>
        )}
      </section>
      {as ? <Callout tone="info">This is a preview. On their own phone they see only this page and the event dashboard, never your costs or other people&rsquo;s payouts.</Callout> : null}
    </div>
  );
}
