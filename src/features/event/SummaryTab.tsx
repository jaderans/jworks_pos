import { useMemo } from 'react';
import { Link } from 'react-router';
import { CheckCircle2, Circle, Minus, Plus } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { useEventData } from './useEventData';
import { Badge, Callout, IconButton, Loading, Stat } from '../../components/ui';
import { BarList, HourBars, Meter } from '../../components/charts';
import { peso, formatPct, formatCount } from '../../lib/money';
import { fmtIsoWeekday, fmtTime } from '../../lib/time';
import { drawerState } from '../../domain/summary';
import { bumpCounter } from '../../services/events';
import type { JWEvent } from '../../db/types';

export function SummaryTab({ ev }: { ev: JWEvent }) {
  const app = useApp();
  const d = useEventData(ev);
  const owner = app.can('viewProfit');
  const { metrics: m, share: s } = d;

  const setup = useMemo(() => {
    const priced = d.products.filter((p) => p.active === 1 && (p.price !== null || d.eventProducts.some((e) => e.productId === p.id && e.price !== null)));
    return [
      { done: priced.length > 0, label: `Set prices (${priced.length} product${priced.length === 1 ? '' : 's'} priced)`, to: '/event/prices' },
      { done: d.eventProducts.some((e) => e.stockBrought !== null), label: 'Count the stock you’re bringing', to: '/event/stock' },
      { done: d.roster.length > 0, label: 'Add the team on duty', to: '/event/team' },
      { done: d.spend.length > 0, label: 'List booth spend (booth fee, supplies)', to: '/event/spend' },
      { done: d.sessions.length > 0, label: 'Open the register and sell', to: '/sell' },
    ];
  }, [d.products, d.eventProducts, d.roster, d.spend, d.sessions]);

  if (d.loading) return <Loading />;

  const costs = s.costs.total;
  const earned = s.tradingProfit;
  const covered = earned >= costs;
  const openSessions = d.sessions.filter((x) => x.closedAt === null);
  const leads = ev.counters?.leads ?? 0;

  return (
    <div className="stack loose">
      {m.transactions === 0 && owner ? (
        <div className="card">
          <div className="card-head">
            <h2>Get ready for {ev.name}</h2>
            <Badge tone="teal">{setup.filter((x) => x.done).length} of {setup.length} done</Badge>
          </div>
          <div className="stack tight">
            {setup.map((x) => (
              <Link key={x.label} to={x.to} className="row" style={{ textDecoration: 'none', color: x.done ? 'var(--muted)' : 'var(--ink)', padding: '6px 0' }}>
                {x.done ? <CheckCircle2 size={20} className="good" /> : <Circle size={20} className="muted" />}
                <span style={{ textDecoration: x.done ? 'line-through' : 'none' }}>{x.label}</span>
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      <div className="stats">
        <Stat hero label="Gross sales" value={peso(m.gross)} hint={ev.targets.sales ? `${formatPct((m.gross / ev.targets.sales) * 100)} of the ${peso(ev.targets.sales)} target` : undefined} />
        <Stat label="Transactions" value={formatCount(m.transactions)} hint={m.voided ? `${m.voided} voided` : undefined} />
        <Stat label="Items sold" value={formatCount(m.itemsSold)} hint={m.freeItems ? `${m.freeItems} given free` : undefined} />
        <Stat label="Average sale" value={peso(m.avgSale)} hint={`Biggest ${peso(m.biggestSale)}`} />
        <Stat label="Discounts given" value={peso(m.discounts)} />
        {m.addOnAttach !== null ? <Stat label="Add-ons per sale" value={m.addOnAttach.toFixed(2)} hint={m.addOnAttach < 0.5 ? 'Below 0.5: remind the team to offer add-ons' : 'Good attach rate'} /> : null}
      </div>

      {owner ? (
        <div className="card">
          <div className="card-head">
            <h2>Did the booth pay for itself?</h2>
            <Badge tone={covered ? 'good' : 'warn'}>{covered ? 'Covered' : 'Not yet'}</Badge>
          </div>
          <Meter value={earned} mark={costs} ok={covered} />
          <div className="row between small">
            <span>
              Earned after production cost: <b>{peso(earned)}</b>
            </span>
            <span>
              Event costs: <b>{peso(costs)}</b>
            </span>
          </div>
          <p className="small">
            {costs === 0
              ? 'No booth fee or event costs recorded yet. Add them in Booth spend to track break-even.'
              : covered
                ? `The booth is paid for, with ${peso(earned - costs)} to spare so far.`
                : `${peso(costs - earned)} more profit is needed to cover the booth and event costs.`}
          </p>
          {s.warnings.map((w) => (
            <Callout key={w} tone="warn">
              {w}
            </Callout>
          ))}
        </div>
      ) : null}

      <div className="grid-2">
        <div className="card">
          <h2>Sales by hour</h2>
          <HourBars data={m.byHour} />
        </div>
        <div className="card">
          <h2>Payments</h2>
          <BarList rows={m.byMethod.map((x) => ({ key: x.methodId, name: x.name, value: x.amount, sub: `· ${x.count}` }))} empty="No payments yet." />
          {d.sessions.length ? (
            <div className="stack tight">
              <hr className="divider" />
              <h3>Registers</h3>
              {d.sessions.map((sess) => {
                const dr = drawerState(sess, d.sales);
                return (
                  <div key={sess.id} className="row between small">
                    <span>
                      Register {sess.letter} · {fmtTime(sess.openedAt)}
                      {sess.closedAt ? ` – ${fmtTime(sess.closedAt)}` : ' · open'}
                    </span>
                    <span>
                      {sess.closedAt ? (
                        dr.overShort === 0 ? (
                          <Badge tone="good">Balanced</Badge>
                        ) : (
                          <Badge tone="warn">{(dr.overShort ?? 0) > 0 ? 'Over' : 'Short'} {peso(Math.abs(dr.overShort ?? 0))}</Badge>
                        )
                      ) : (
                        <span className="muted">Expect {peso(dr.expected)} cash</span>
                      )}
                    </span>
                  </div>
                );
              })}
              {openSessions.length ? <p className="muted tiny">Close each register at the end of the day to count the cash.</p> : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h2>Top products</h2>
          <BarList rows={m.byProduct.slice(0, 10).map((p) => ({ key: p.productId, name: p.name, value: p.revenue, sub: `· ${p.qty} sold` }))} empty="Nothing sold yet." />
        </div>
        <div className="card">
          <h2>Category mix</h2>
          <BarList rows={m.byCategory.map((c) => ({ key: c.categoryId ?? 'none', name: c.name, value: c.revenue, sub: `· ${c.qty}` }))} empty="Nothing sold yet." />
          {m.byDay.length > 1 ? (
            <>
              <hr className="divider" />
              <h3>By day</h3>
              <BarList rows={m.byDay.map((x) => ({ key: x.date, name: fmtIsoWeekday(x.date), value: x.amount, sub: `· ${x.count}` }))} />
            </>
          ) : null}
        </div>
      </div>

      {owner ? (
        <div className="grid-3">
          <div className="card">
            <h2>1 · Trading</h2>
            <div className="waterfall">
              <div className="wf-row"><span>Gross sales</span><span className="v">{peso(s.gross)}</span></div>
              <div className="wf-row sub"><span>− Production cost of items sold</span><span className="v">{peso(ev.share.poolMode === 'supplies' ? s.costs.materialsUsed : s.cogs)}</span></div>
              {ev.share.royaltiesBeforePool && s.partnerTotal ? <div className="wf-row sub"><span>− Partner shares</span><span className="v">{peso(s.partnerTotal)}</span></div> : null}
              {ev.share.royaltiesBeforePool && s.royaltyTotal ? <div className="wf-row sub"><span>− Design royalties</span><span className="v">{peso(s.royaltyTotal)}</span></div> : null}
              <div className="wf-row total"><span>Trading profit</span><span className="v">{peso(s.tradingProfit)}</span></div>
              <div className="wf-row sub"><span>Margin</span><span className="v">{s.gross ? formatPct((s.tradingProfit / s.gross) * 100) : '—'}</span></div>
            </div>
          </div>
          <div className="card">
            <h2>2 · Event result</h2>
            <div className="waterfall">
              <div className="wf-row"><span>Trading profit</span><span className="v">{peso(s.tradingProfit)}</span></div>
              {ev.share.poolMode === 'all' ? (
                <>
                  <div className="wf-row sub"><span>− Booth fee</span><span className="v">{peso(s.costs.boothFee)}</span></div>
                  <div className="wf-row sub"><span>− Used up at the event</span><span className="v">{peso(s.costs.consumables)}</span></div>
                  <div className="wf-row sub"><span>− Share of reusable assets</span><span className="v">{peso(s.costs.assets)}</span></div>
                </>
              ) : null}
              <div className="wf-row total"><span>Profit pool</span><span className="v">{peso(s.pool)}</span></div>
              <div className="wf-row sub"><span>JoshWorks {ev.share.joshworksPct}%</span><span className="v">{peso(s.joshworks)}</span></div>
              <div className="wf-row sub"><span>Staff pool {100 - ev.share.joshworksPct}%</span><span className="v">{peso(s.staffPool)}</span></div>
              <div className="wf-row final"><span>JoshWorks keeps</span><span className="v">{peso(s.joshworksNet)}</span></div>
            </div>
          </div>
          <div className="card">
            <h2>3 · Cash</h2>
            <div className="waterfall">
              <div className="wf-row"><span>Money in (all methods)</span><span className="v">{peso(s.gross)}</span></div>
              <div className="wf-row sub"><span>− Everything bought for this event</span><span className="v">{peso(s.costs.boothFee + s.costs.consumables + boughtAssets(d.spend) + s.costs.materialsBought)}</span></div>
              <div className="wf-row sub"><span>− Staff, partner and royalty payouts</span><span className="v">{peso(s.staffPool + s.partnerTotal + s.royaltyTotal + s.topUpTotal)}</span></div>
              <div className="wf-row total"><span>Net cash from this event</span><span className="v">{peso(s.gross - (s.costs.boothFee + s.costs.consumables + boughtAssets(d.spend) + s.costs.materialsBought) - (s.staffPool + s.partnerTotal + s.royaltyTotal + s.topUpTotal))}</span></div>
            </div>
            <p className="muted tiny">Cash can look negative on a first event while the result is positive: stands, displays and leftover materials come home with you.</p>
          </div>
        </div>
      ) : null}

      {owner ? (
        <div className="card">
          <div className="card-head">
            <h2>What the booth brought in besides sales</h2>
          </div>
          <div className="grid-2">
            <Counter label="Emails and contacts captured" value={leads} onChange={(delta) => bumpCounter(ev.id, 'leads', delta)} />
            <Counter label="Org officers spoken to" value={ev.counters?.orgOfficers ?? 0} onChange={(delta) => bumpCounter(ev.id, 'orgOfficers', delta)} />
          </div>
          <p className="small">
            Cost per contact: <b>{leads > 0 ? peso(Math.round(costs / leads)) : '—'}</b>
            <span className="muted"> (event costs ÷ contacts). One converted org officer can pay for the whole day.</span>
          </p>
        </div>
      ) : null}
    </div>
  );
}

function boughtAssets(spend: { type: string; status: string; qty: number; unitCost: number; deleted?: 0 | 1 }[]) {
  return spend.filter((x) => x.deleted !== 1 && x.type === 'asset' && x.status === 'bought').reduce((a, x) => a + Math.round(x.qty * x.unitCost), 0);
}

function Counter({ label, value, onChange }: { label: string; value: number; onChange: (delta: number) => void }) {
  return (
    <div className="row between" style={{ padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 12 }}>
      <span className="strong">{label}</span>
      <div className="row">
        <IconButton label={`One less: ${label}`} size="sm" onClick={() => onChange(-1)} disabled={value <= 0}>
          <Minus size={16} />
        </IconButton>
        <span className="num strong" style={{ minWidth: 32, textAlign: 'center', fontSize: '1.2rem' }}>
          {value}
        </span>
        <IconButton label={`One more: ${label}`} size="sm" onClick={() => onChange(1)}>
          <Plus size={16} />
        </IconButton>
      </div>
    </div>
  );
}
