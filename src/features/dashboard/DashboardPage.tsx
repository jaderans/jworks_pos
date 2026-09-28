import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowRight, Calculator, CalendarPlus, CheckCircle2, ChevronLeft, ChevronRight, FileText, Layers, LayoutDashboard, PackageX, ShoppingCart, Tag,
  TimerReset, Wallet,
} from 'lucide-react';
import { alive, db } from '../../db/db';
import { useApp } from '../../app/AppContext';
import { useAudit, useEventProducts, useEvents, useMaterials, useMembers, usePayouts, useProductCosts, useProducts, useSales } from '../../hooks/data';
import { useNow } from '../../hooks/useNow';
import { useEventData } from '../event/useEventData';
import { Badge, Button, Loading, Stat } from '../../components/ui';
import { HourBars, Meter } from '../../components/charts';
import { eventMetrics } from '../../domain/summary';
import { needsReorder } from '../../domain/stock';
import { formatCount, formatPct, peso, sum } from '../../lib/money';
import { addDays, dayStart, daysBetween, fmtDateRange, fmtIsoDate, isoDate, relativeTime } from '../../lib/time';
import { EVENT_STATUS_LABEL } from '../../services/events';
import { ACTIVITY_LABELS, activityTone } from '../activity/labels';
import type { JWEvent } from '../../db/types';
import './dashboard.css';

const longDateFmt = new Intl.DateTimeFormat('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const monthFmt = new Intl.DateTimeFormat('en-PH', { month: 'long', year: 'numeric' });
const dayNameFmt = new Intl.DateTimeFormat('en-PH', { weekday: 'long', month: 'long', day: 'numeric' });
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_MS = 86_400_000;

const statusTone = (s: JWEvent['status']) => (s === 'live' ? 'good' : s === 'planning' ? 'teal' : undefined);

/** "Day 2 of 3", "Starts in 5 days", "Ended Sep 20". */
function eventTiming(ev: JWEvent, today: string): string {
  if (!ev.startDate) return 'No date yet';
  const end = ev.endDate && ev.endDate >= ev.startDate ? ev.endDate : ev.startDate;
  if (today < ev.startDate) {
    const n = Math.round((dayStart(ev.startDate) - dayStart(today)) / DAY_MS);
    return n === 1 ? 'Starts tomorrow' : `Starts in ${n} days`;
  }
  if (today > end) return `Ended ${fmtIsoDate(end)}`;
  const total = daysBetween(ev.startDate, end).length;
  return total > 1 ? `Day ${daysBetween(ev.startDate, today).length} of ${total}` : 'Today';
}

/** The owner's start screen: the time, the calendar, the event in progress and what needs doing. */
export default function DashboardPage() {
  const app = useApp();
  const events = useEvents();
  const ev = app.activeEvent;
  return (
    <div className="page dash">
      <div className="dash-grid">
        <Hero ev={ev} />
        <CalendarCard events={events ?? []} />
        {ev ? <EventCard ev={ev} /> : <NoEventCard hasEvents={(events ?? []).length > 0} />}
        <AttentionCard ev={ev ?? null} />
        {ev ? <LatestSales ev={ev} /> : <Placeholder className="dash-sales" title="Latest sales" text="Pick an event to see its sales here." />}
        <ActivityCard />
      </div>
    </div>
  );
}

function Hero({ ev }: { ev: JWEvent | null | undefined }) {
  const app = useApp();
  const navigate = useNavigate();
  const now = useNow(1000);
  const d = new Date(now);
  const h = d.getHours();
  const greeting = h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  const first = (app.member?.name ?? '').trim().split(/\s+/)[0];
  const today = isoDate(now);
  return (
    <section className="dash-hero" aria-label="Today">
      <div className="hero-main">
        <span className="hero-date">{longDateFmt.format(now)}</span>
        <h1>
          {greeting}
          {first ? `, ${first}` : ''}
        </h1>
        <div className="hero-time" aria-label={`The time is ${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`}>
          <span className="hm" aria-hidden="true">
            {h % 12 || 12}:{String(d.getMinutes()).padStart(2, '0')}
          </span>
          <span className="ss" aria-hidden="true">
            :{String(d.getSeconds()).padStart(2, '0')}
          </span>
          <span className="ap" aria-hidden="true">
            {h < 12 ? 'AM' : 'PM'}
          </span>
        </div>
        {ev ? (
          <p className="hero-event">
            <Badge tone={statusTone(ev.status)}>{EVENT_STATUS_LABEL[ev.status]}</Badge>
            <b>{ev.name}</b>
            <span>
              {eventTiming(ev, today)}
              {ev.venue ? ` · ${ev.venue}` : ''}
            </span>
          </p>
        ) : (
          <p className="hero-event">No event picked yet.</p>
        )}
        <div className="hero-actions">
          {ev ? (
            <Button variant="primary" onClick={() => navigate('/sell')}>
              <ShoppingCart size={18} /> Sell
            </Button>
          ) : (
            <Button variant="primary" onClick={() => navigate('/events?new=1')}>
              <CalendarPlus size={18} /> New event
            </Button>
          )}
          {ev ? (
            <button type="button" className="btn on-dark" onClick={() => navigate('/event')}>
              <LayoutDashboard size={18} /> Event summary
            </button>
          ) : null}
          <button type="button" className="btn on-dark" onClick={() => navigate('/calculator')}>
            <Calculator size={18} /> Price a job
          </button>
        </div>
      </div>
      <AnalogClock now={now} />
    </section>
  );
}

function AnalogClock({ now }: { now: number }) {
  const d = new Date(now);
  const s = d.getSeconds();
  const m = d.getMinutes() + s / 60;
  const h = (d.getHours() % 12) + m / 60;
  return (
    <svg className="analog" viewBox="0 0 200 200" aria-hidden="true">
      <circle cx="100" cy="100" r="95" className="face" />
      {Array.from({ length: 60 }, (_, i) => (
        <line key={i} x1="100" y1={i % 5 === 0 ? 11 : 13} x2="100" y2={i % 5 === 0 ? 25 : 19} className={i % 5 === 0 ? 'tick major' : 'tick'} transform={`rotate(${i * 6} 100 100)`} />
      ))}
      <line x1="100" y1="100" x2="100" y2="54" className="hand hour" transform={`rotate(${h * 30} 100 100)`} />
      <line x1="100" y1="100" x2="100" y2="32" className="hand minute" transform={`rotate(${m * 6} 100 100)`} />
      <line x1="100" y1="116" x2="100" y2="24" className="hand second" transform={`rotate(${s * 6} 100 100)`} />
      <circle cx="100" cy="100" r="5.5" className="pin" />
    </svg>
  );
}

function CalendarCard({ events }: { events: JWEvent[] }) {
  const app = useApp();
  const navigate = useNavigate();
  const today = isoDate(useNow(60_000));
  const [month, setMonth] = useState(() => today.slice(0, 7));
  const [sel, setSel] = useState<string | null>(null);
  const [y, mo] = month.split('-').map(Number);
  const firstDay = new Date(y, mo - 1, 1);
  const gridStart = isoDate(new Date(y, mo - 1, 1 - firstDay.getDay()).getTime());
  const days = useMemo(() => Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)), [gridStart]);
  const dated = events.filter((e) => e.startDate);
  const endOf = (e: JWEvent) => (e.endDate && e.endDate >= e.startDate ? e.endDate : e.startDate);
  const on = (iso: string) => dated.filter((e) => e.startDate <= iso && iso <= endOf(e));
  const go = (delta: number) => {
    setMonth(isoDate(new Date(y, mo - 1 + delta, 1).getTime()).slice(0, 7));
    setSel(null);
  };
  const upcoming = dated
    .filter((e) => endOf(e) >= today && e.status !== 'reported')
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .slice(0, 4);
  const listed = sel ? on(sel) : upcoming;

  return (
    <section className="card dash-cal" aria-labelledby="cal-title">
      <div className="cal-head">
        <h2 id="cal-title" className="dot-title">
          {monthFmt.format(firstDay)}
        </h2>
        <div className="row" style={{ gap: 4 }}>
          <button type="button" className="icon-btn sm plain" aria-label="Previous month" onClick={() => go(-1)}>
            <ChevronLeft size={18} />
          </button>
          <button
            type="button"
            className="btn sm ghost"
            onClick={() => {
              setMonth(today.slice(0, 7));
              setSel(null);
            }}
          >
            Today
          </button>
          <button type="button" className="icon-btn sm plain" aria-label="Next month" onClick={() => go(1)}>
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
      <div className="cal-grid">
        {WEEKDAYS.map((w) => (
          <span key={w} className="cal-wd" aria-hidden="true">
            {w.slice(0, 1)}
          </span>
        ))}
        {days.map((iso, i) => {
          const evs = on(iso);
          const live = evs.some((e) => e.status === 'live');
          const cls = [
            'cal-day',
            iso.slice(0, 7) !== month ? 'out' : '',
            iso === today ? 'today' : '',
            evs.length ? 'has' : '',
            live ? 'live' : '',
            evs.length && (i % 7 === 0 || evs.some((e) => e.startDate === iso)) ? 'rs' : '',
            evs.length && (i % 7 === 6 || evs.some((e) => endOf(e) === iso)) ? 're' : '',
            sel === iso ? 'sel' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <button
              key={iso}
              type="button"
              className={cls}
              aria-pressed={sel === iso}
              aria-label={`${dayNameFmt.format(dayStart(iso))}${iso === today ? ' (today)' : ''}${evs.length ? `: ${evs.map((e) => e.name).join(', ')}` : ''}`}
              onClick={() => setSel(sel === iso ? null : iso)}
            >
              <span className="n">{Number(iso.slice(8))}</span>
            </button>
          );
        })}
      </div>
      <div className="cal-list">
        <div className="row between">
          <span className="eyebrow">{sel ? dayNameFmt.format(dayStart(sel)) : 'Coming up'}</span>
          {sel ? (
            <button type="button" className="btn link small" onClick={() => setSel(null)}>
              Show upcoming
            </button>
          ) : null}
        </div>
        {listed.length === 0 ? (
          <div className="row between">
            <span className="muted small">{sel ? 'No events on this day.' : 'No upcoming events.'}</span>
            {app.can('manageEvents') ? (
              <Button size="sm" onClick={() => navigate('/events?new=1')}>
                <CalendarPlus size={16} /> New event
              </Button>
            ) : null}
          </div>
        ) : (
          listed.map((e) => (
            <button
              key={e.id}
              type="button"
              className="cal-ev"
              onClick={() => {
                app.setActiveEventId(e.id);
                navigate('/event');
              }}
            >
              <span className={`bar ${e.status}`} aria-hidden="true" />
              <span className="grow">
                <b>{e.name}</b>
                <span className="muted small">
                  {fmtDateRange(e.startDate, e.endDate)}
                  {e.venue ? ` · ${e.venue}` : ''}
                </span>
              </span>
              <Badge tone={statusTone(e.status)}>{EVENT_STATUS_LABEL[e.status]}</Badge>
            </button>
          ))
        )}
      </div>
    </section>
  );
}

function EventCard({ ev }: { ev: JWEvent }) {
  const app = useApp();
  const d = useEventData(ev);
  const today = isoDate(useNow(60_000));
  const todaySales = useMemo(() => d.sales.filter((s) => isoDate(s.at) === today), [d.sales, today]);
  const tm = useMemo(() => eventMetrics(todaySales, d.categories), [todaySales, d.categories]);
  if (d.loading)
    return (
      <section className="card dash-event">
        <Loading />
      </section>
    );
  const m = d.metrics;
  const s = d.share;
  const covered = s.tradingProfit >= s.costs.total;
  return (
    <section className="card dash-event" aria-labelledby="dash-ev-title">
      <div className="card-head">
        <div className="stack tight" style={{ minWidth: 0 }}>
          <h2 id="dash-ev-title" className="dot-title">
            {ev.name}
          </h2>
          <span className="sub">
            {fmtDateRange(ev.startDate, ev.endDate)}
            {ev.venue ? ` · ${ev.venue}` : ''}
            {ev.boothNo ? ` · Booth ${ev.boothNo}` : ''}
          </span>
        </div>
        <Link to="/event" className="btn sm">
          Open event <ArrowRight size={16} />
        </Link>
      </div>
      <div className="dash-kpis">
        <Stat label="Sales today" value={peso(tm.gross)} hint={`${formatCount(tm.transactions)} sale${tm.transactions === 1 ? '' : 's'}`} />
        <Stat
          label="Whole event"
          value={peso(m.gross)}
          hint={ev.targets.sales ? `${formatPct((m.gross / ev.targets.sales) * 100)} of the ${peso(ev.targets.sales)} target` : `${formatCount(m.transactions)} sales`}
        />
        <Stat label="Items sold" value={formatCount(m.itemsSold)} hint={m.freeItems ? `${m.freeItems} given free` : undefined} />
        <Stat label="Average sale" value={peso(m.avgSale)} hint={m.biggestSale ? `Biggest ${peso(m.biggestSale)}` : undefined} />
      </div>
      {app.can('viewProfit') ? (
        <div className="stack tight">
          <div className="row between small">
            <span className="strong">Did the booth pay for itself?</span>
            <Badge tone={covered ? 'good' : 'warn'}>{covered ? 'Covered' : 'Not yet'}</Badge>
          </div>
          <Meter value={s.tradingProfit} mark={s.costs.total} ok={covered} />
          <div className="row between tiny muted wrap">
            <span>Earned after production cost: {peso(s.tradingProfit)}</span>
            <span>Event costs: {peso(s.costs.total)}</span>
          </div>
        </div>
      ) : null}
      {tm.transactions > 0 ? <HourBars data={tm.byHour} label="Today by hour" height={150} /> : <p className="muted small">No sales yet today.</p>}
    </section>
  );
}

function NoEventCard({ hasEvents }: { hasEvents: boolean }) {
  const navigate = useNavigate();
  return (
    <section className="card dash-event dash-empty">
      <h2 className="dot-title">{hasEvents ? 'Pick the event you’re working on' : 'Set up your first event'}</h2>
      <p className="muted">
        {hasEvents
          ? 'Choose it from the calendar or the event button at the top. Its sales, costs and team show up here.'
          : 'Add the booth fee, prices and team, then open the register on event day. It works without internet.'}
      </p>
      <div className="actions">
        <Button variant="primary" onClick={() => navigate('/events?new=1')}>
          <CalendarPlus size={18} /> New event
        </Button>
        {hasEvents ? <Button onClick={() => navigate('/events')}>All events</Button> : null}
      </div>
    </section>
  );
}

interface Todo {
  key: string;
  icon: ReactNode;
  tone: 'warn' | 'info';
  text: ReactNode;
  cta: string;
  go: () => void;
}

function AttentionCard({ ev }: { ev: JWEvent | null }) {
  const app = useApp();
  const navigate = useNavigate();
  const products = useProducts();
  const costs = useProductCosts();
  const materials = useMaterials();
  const eventProducts = useEventProducts(ev?.id);
  const payouts = usePayouts();
  const events = useEvents();
  const openSessions = useLiveQuery(async () => alive(await db.sessions.toArray()).filter((s) => s.closedAt === null), []);
  const today = isoDate(useNow(60_000));

  const todos = useMemo<Todo[] | null>(() => {
    if (!products || !costs || !materials || !eventProducts || !payouts || !events || !openSessions) return null;
    const out: Todo[] = [];
    const eventName = new Map(events.map((e) => [e.id, e.name]));
    const open = (id: string, to: string) => {
      app.setActiveEventId(id);
      navigate(to);
    };
    const active = products.filter((p) => p.active === 1);
    if (ev) {
      const eps = new Map(eventProducts.map((e) => [e.productId, e]));
      const unpriced = active.filter((p) => {
        const e = eps.get(p.id);
        return e?.active !== 0 && (e?.price ?? null) === null && p.price === null;
      }).length;
      if (unpriced)
        out.push({ key: 'price', icon: <Tag size={18} />, tone: 'warn', text: <><b>{unpriced}</b> product{unpriced === 1 ? ' has' : 's have'} no price for {ev.name}</>, cta: 'Set prices', go: () => navigate('/event/prices') });
    }
    const stale = openSessions.filter((s) => s.openedAt < dayStart(today));
    for (const s of stale.slice(0, 2))
      out.push({
        key: `session-${s.id}`,
        icon: <TimerReset size={18} />,
        tone: 'warn',
        text: <>Register {s.letter} for {eventName.get(s.eventId) ?? 'an event'} is still open since {fmtIsoDate(isoDate(s.openedAt))}</>,
        cta: 'Close it',
        go: () => open(s.eventId, '/sell'),
      });
    const pending = payouts.filter((p) => p.status === 'pending');
    if (pending.length)
      out.push({
        key: 'payouts',
        icon: <Wallet size={18} />,
        tone: 'warn',
        text: <><b>{peso(sum(pending.map((p) => p.amount)))}</b> in payouts not marked paid ({pending.length})</>,
        cta: 'Pay',
        go: () => open(pending[0].eventId, '/event/team'),
      });
    const unreported = events.filter((e) => e.status !== 'reported' && e.startDate && (e.endDate || e.startDate) < today);
    for (const e of unreported.slice(0, 2))
      out.push({ key: `report-${e.id}`, icon: <FileText size={18} />, tone: 'info', text: <>{e.name} has ended. Save its report and mark it reported.</>, cta: 'Report', go: () => open(e.id, '/event/report') });
    const low = materials.filter(needsReorder);
    if (low.length)
      out.push({
        key: 'reorder',
        icon: <PackageX size={18} />,
        tone: 'warn',
        text: <><b>{low.length}</b> material{low.length === 1 ? ' is' : 's are'} running low: {low.slice(0, 2).map((m) => m.name).join(', ')}{low.length > 2 ? '…' : ''}</>,
        cta: 'Materials',
        go: () => navigate('/production?tab=materials'),
      });
    const noCost = active.filter((p) => (costs.get(p.id)?.current ?? null) === null).length;
    if (noCost)
      out.push({ key: 'cost', icon: <Layers size={18} />, tone: 'info', text: <><b>{noCost}</b> product{noCost === 1 ? ' has' : 's have'} no production cost, so profit reads high</>, cta: 'Add costs', go: () => navigate('/production') });
    return out;
  }, [products, costs, materials, eventProducts, payouts, events, openSessions, ev, today, app, navigate]);

  return (
    <section className="card dash-attn" aria-labelledby="attn-title">
      <div className="card-head">
        <h2 id="attn-title" className="dot-title">
          Needs attention
        </h2>
        {todos && todos.length ? <Badge tone="warn">{todos.length}</Badge> : null}
      </div>
      {!todos ? (
        <Loading />
      ) : todos.length === 0 ? (
        <div className="row muted">
          <CheckCircle2 size={20} className="good" /> All clear. Nothing waiting on you.
        </div>
      ) : (
        <div className="dash-list">
          {todos.map((t) => (
            <div key={t.key} className="dash-row">
              <span className={`attn-ic ${t.tone}`} aria-hidden="true">
                {t.icon}
              </span>
              <span className="attn-text small">{t.text}</span>
              <button type="button" className="btn sm" onClick={t.go}>
                {t.cta}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function LatestSales({ ev }: { ev: JWEvent }) {
  const sales = useSales(ev.id);
  useNow(30_000);
  const latest = (sales ?? []).slice(0, 6);
  return (
    <section className="card dash-sales" aria-labelledby="sales-title">
      <div className="card-head">
        <h2 id="sales-title" className="dot-title">
          Latest sales
        </h2>
        <Link to="/sales" className="small strong">
          Sales log
        </Link>
      </div>
      {!sales ? (
        <Loading />
      ) : latest.length === 0 ? (
        <p className="muted small">No sales yet for {ev.name}.</p>
      ) : (
        <div className="dash-list">
          {latest.map((s) => (
            <div key={s.id} className={`dash-row${s.status === 'voided' ? ' voided' : ''}`}>
              <span className="receipt-no">{s.receiptNo}</span>
              <span className="grow">
                <span className="ellipsis small strong">{s.lines.map((l) => `${l.qty}× ${l.name}`).join(', ')}</span>
                <span className="muted tiny">
                  {relativeTime(s.at)} · {s.status === 'voided' ? 'Voided' : s.payments.map((p) => p.name).join(' + ')}
                </span>
              </span>
              <b className="num nowrap">{peso(s.total)}</b>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ActivityCard() {
  const audit = useAudit(6);
  const members = useMembers();
  useNow(30_000);
  const names = new Map((members ?? []).map((m) => [m.id, m.name]));
  return (
    <section className="card dash-act" aria-labelledby="act-title">
      <div className="card-head">
        <h2 id="act-title" className="dot-title">
          Activity
        </h2>
        <Link to="/activity" className="small strong">
          See all
        </Link>
      </div>
      {!audit ? (
        <Loading />
      ) : audit.length === 0 ? (
        <p className="muted small">Nothing yet. Price changes, voids and payouts show up here.</p>
      ) : (
        <div className="dash-list">
          {audit.map((a) => (
            <div key={a.id} className="dash-row top">
              <Badge tone={activityTone(a.action)}>{ACTIVITY_LABELS[a.action] ?? a.action}</Badge>
              <span className="grow">
                <span className="act-text">{a.summary}</span>
                <span className="muted tiny">
                  {relativeTime(a.at)}
                  {a.actorId ? ` · ${names.get(a.actorId) ?? 'someone'}` : ''}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Placeholder({ className, title, text }: { className: string; title: string; text: string }) {
  return (
    <section className={`card ${className}`}>
      <h2 className="dot-title">{title}</h2>
      <p className="muted small">{text}</p>
    </section>
  );
}
