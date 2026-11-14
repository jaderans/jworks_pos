import { useEffect, useMemo, useState } from 'react';
import { BellRing, ClipboardCopy, Download, Mail, Plus, Ticket, Trash2, UserRound, X } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { useCouponData, useCustomers, useEvents, useSettingRows } from '../../hooks/data';
import { settingValue } from '../../db/settings';
import { Dialog } from '../../components/Dialog';
import { Badge, Button, Callout, EmptyState, IconButton, Loading, Segmented, Stat, Toggle } from '../../components/ui';
import { Field, MoneyInput, NumberInput, SearchInput, Select, TextArea, TextInput } from '../../components/form';
import { formatCount, peso, type Cents } from '../../lib/money';
import { addDays, fmtDate, fmtIsoDate, todayISO } from '../../lib/time';
import { downloadBlob, safeFileName, toCSV } from '../../lib/files';
import {
  CLAIM_SOURCE_LABEL, COUPON_DAYS_AFTER, COUPON_MIN_SPEND, COUPON_STATE_LABEL, claimsOf, couponPrefix, couponState, couponStats, expiringSoon, offText,
  randomCode, reminderText, termsText, type CouponData, type CouponState,
} from '../../domain/coupons';
import { addCodes, deleteBatch, giveCoupon, markReminded, readStudioClaims, recordClaim, removeClaim, saveBatch, setBatchActive, setCouponOff, type BatchInput } from '../../services/coupons';
import { getMailer, isEmail, mailerReady } from '../../email/send';
import { flushOutbox, queueEmail } from '../../email/outbox';
import { couponReminderEmail } from '../../email/templates';
import { CustomerPicker } from '../register/CustomerPicker';
import type { BusinessSettings, Coupon, CouponBatch, Customer, JWEvent } from '../../db/types';

const STATE_TONE: Record<CouponState, 'good' | 'teal' | 'warn' | undefined> = { open: 'good', claimed: 'teal', expired: undefined, off: undefined, upcoming: 'warn' };

/**
 * Service coupons: one event's (the event's Coupons tab) or every event's
 * (Customers → Coupons). Totals, the sets and their codes, who used them and
 * for how much, and reminders for codes about to run out.
 */
export function CouponsView({ eventId }: { eventId: string | null }) {
  const app = useApp();
  const events = useEvents();
  const [pick, setPick] = useState<string>('');
  const scope = eventId ?? (pick || null);
  const data = useCouponData(scope);
  const customers = useCustomers();
  const business = settingValue<BusinessSettings>(useSettingRows(), 'business');
  const [editing, setEditing] = useState<CouponBatch | 'new' | null>(null);
  const [adding, setAdding] = useState<CouponBatch | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [giving, setGiving] = useState<Coupon | null>(null);
  const [q, setQ] = useState('');
  const [state, setState] = useState<'all' | CouponState>('all');

  // Studio jobs on this device that took a coupon show up as claims.
  useEffect(() => {
    void readStudioClaims().catch(() => null);
  }, []);

  const today = todayISO();
  const eventOf = useMemo(() => new Map((events ?? []).map((e) => [e.id, e])), [events]);
  const custOf = useMemo(() => new Map((customers ?? []).map((c) => [c.id, c])), [customers]);
  if (!data || !events || !customers) return <Loading />;
  const batchOf = new Map(data.batches.map((b) => [b.id, b]));
  const stats = couponStats(data, today);
  const soon = expiringSoon(data, today);
  const ev = scope ? eventOf.get(scope) : undefined;
  const rows = data.coupons
    .map((c) => ({ c, b: batchOf.get(c.batchId) }))
    .filter((r): r is { c: Coupon; b: CouponBatch } => !!r.b)
    .map((r) => ({ ...r, st: couponState(r.c, r.b, data.claims, today), used: claimsOf(r.c.id, data.claims) }))
    .filter((r) => state === 'all' || r.st === state)
    .filter((r) => {
      const needle = q.trim().toLowerCase();
      if (!needle) return true;
      const who = [r.c.customerId ? custOf.get(r.c.customerId)?.name : '', ...r.used.map((u) => `${u.customerName} ${u.service}`)].join(' ');
      return `${r.c.code} ${r.b.name} ${who}`.toLowerCase().includes(needle);
    });

  const run = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      if (label) app.toast(label, { tone: 'good' });
    } catch (e) {
      app.toast(e instanceof Error ? e.message : 'Couldn’t do that', { tone: 'bad' });
    }
  };
  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      app.toast(label, { tone: 'good' });
    } catch {
      app.toast('Couldn’t copy on this device', { tone: 'bad' });
    }
  };
  const copyCodes = (b: CouponBatch) => {
    const open = data.coupons.filter((c) => c.batchId === b.id && couponState(c, b, data.claims, today) === 'open' && !c.customerId && !c.saleId);
    if (!open.length) return app.toast('No unused codes left in this set to hand out.', { tone: 'info' });
    void copy(open.map((c) => c.code).join('\n'), `${open.length} code${open.length === 1 ? '' : 's'} copied`);
  };
  const csv = () => {
    const head = ['Code', 'Set', 'Event', 'Takes off', 'Status', 'Given to', 'Used by', 'Service', 'Price', 'Discount', 'Used on'];
    const out: (string | number)[][] = [];
    for (const c of data.coupons) {
      const b = batchOf.get(c.batchId);
      if (!b) continue;
      const used = claimsOf(c.id, data.claims);
      const base = [c.code, b.name, eventOf.get(c.eventId)?.name ?? '', offText(b), COUPON_STATE_LABEL[couponState(c, b, data.claims, today)], c.customerId ? (custOf.get(c.customerId)?.name ?? '') : ''];
      if (!used.length) out.push([...base, '', '', '', '', '']);
      for (const u of used) out.push([...base, u.customerName, u.service, u.price / 100, u.discount / 100, fmtDate(u.at)]);
    }
    downloadBlob(new Blob([toCSV([head, ...out])], { type: 'text/csv;charset=utf-8' }), `${safeFileName(ev?.name ?? 'All events')} - coupons.csv`);
  };
  const remind = async (c: Coupon, b: CouponBatch, how: 'copy' | 'email') => {
    const cust = c.customerId ? custOf.get(c.customerId) : undefined;
    if (!cust) return;
    if (how === 'copy') {
      await copy(reminderText(business.name, { name: cust.name, code: c.code, batch: b }), `Message for ${cust.name} copied; paste it in Messenger or SMS.`);
      await markReminded(c.id);
      return;
    }
    if (!mailerReady(await getMailer())) return app.toast('Set up the studio Gmail in Settings → Email first.', { tone: 'bad' });
    await queueEmail({
      kind: 'coupon',
      saleId: null,
      to: cust.email,
      toName: cust.name,
      mail: couponReminderEmail(business, { customerName: cust.name, code: c.code, terms: termsText(b, business.name || 'JoshWorks'), validTo: b.validTo, eventName: eventOf.get(c.eventId)?.name ?? '' }),
    });
    await markReminded(c.id);
    const r = await flushOutbox();
    app.toast(r.sent ? `Reminder emailed to ${cust.email}` : 'Reminder saved; it goes out when there’s a connection.', { tone: r.sent ? 'good' : 'info' });
  };

  return (
    <div className="stack loose coupons">
      <div className="row between wrap">
        <p className="muted" style={{ maxWidth: '68ch' }}>
          Coupons for JoshWorks services (printing, commissions, logos and other studio jobs) of {peso(COUPON_MIN_SPEND)} or more, never booth merch.
          {ev ? ` These belong to ${ev.name}.` : ' Each set belongs to one event.'} Hand them out, or let a booth sale earn one.
        </p>
        <div className="row wrap">
          {!eventId ? (
            <Select aria-label="Event" value={pick} onChange={(e) => setPick(e.target.value)} style={{ width: 'auto' }}>
              <option value="">All events</option>
              {events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </Select>
          ) : null}
          <Button onClick={() => setClaiming(true)} disabled={!data.coupons.length}>
            Record a use
          </Button>
          <Button variant="primary" onClick={() => setEditing('new')} disabled={!events.length}>
            <Plus size={18} /> New coupons
          </Button>
        </div>
      </div>

      <div className="stats">
        <Stat label="Coupon codes" value={formatCount(stats.codes)} hint={`${formatCount(stats.open)} open · ${formatCount(stats.given)} given out`} />
        <Stat label="Used" value={formatCount(stats.claims)} hint={stats.claimRate === null ? 'No codes yet' : `${stats.claimRate}% of the codes`} />
        <Stat label="Services booked with them" value={peso(stats.price)} hint="Before the coupons" />
        <Stat label="Discounts given" value={peso(stats.discount)} hint={`${peso(stats.net)} came in`} />
      </div>

      {stats.doubles.length ? (
        <Callout tone="warn" title="Used twice">
          {stats.doubles.join(', ')} {stats.doubles.length === 1 ? 'was' : 'were'} used on two services, probably by two phones offline at the same time. Check the uses below and remove the coupon from one of them.
        </Callout>
      ) : null}

      {soon.length ? (
        <section className="card stack tight" aria-label="Expiring soon">
          <div className="card-head">
            <h2>
              <BellRing size={18} /> Running out soon
            </h2>
          </div>
          <p className="muted small">Codes given to customers that run out within two weeks and haven’t been used. A reminder often brings the booking in.</p>
          <div className="list">
            {soon.map(({ coupon: c, batch: b, daysLeft }) => {
              const cust = c.customerId ? custOf.get(c.customerId) : undefined;
              return (
                <div key={c.id} className="list-item">
                  <span className="main-text">
                    <b>{cust?.name ?? 'Customer'}</b>
                    <span>
                      <span className="mono">{c.code}</span> · {offText(b)} · {daysLeft <= 0 ? 'last day today' : `ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`} ({fmtIsoDate(b.validTo)})
                      {c.remindedAt ? ` · reminded ${fmtDate(c.remindedAt)}` : ''}
                    </span>
                  </span>
                  <Button size="sm" onClick={() => void remind(c, b, 'copy')}>
                    <ClipboardCopy size={15} /> Message
                  </Button>
                  {cust && isEmail(cust.email) ? (
                    <Button size="sm" onClick={() => void remind(c, b, 'email')}>
                      <Mail size={15} /> Email
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {data.batches.length === 0 ? (
        <EmptyState icon={<Ticket size={44} />} title="No coupons yet">
          Make a set for {ev ? ev.name : 'an event'}: single-use codes to hand out, one shared code for a post, or a coupon every booth sale over an amount earns.
        </EmptyState>
      ) : (
        <div className="coupon-sets">
          {data.batches.map((b) => {
            const codes = data.coupons.filter((c) => c.batchId === b.id);
            const s = couponStats({ batches: [b], coupons: codes, claims: data.claims.filter((x) => x.batchId === b.id) }, today);
            const shared = b.mode === 'shared' ? codes[0] : undefined;
            return (
              <article key={b.id} className={`card coupon-set ${b.active ? '' : 'muted'}`} aria-label={`Coupons ${b.name}`}>
                <div className="row between" style={{ alignItems: 'flex-start' }}>
                  <div>
                    <b>{b.name}</b>
                    <div className="small">{termsText(b, business.name || 'JoshWorks')}</div>
                    {!eventId ? <div className="muted tiny">{eventOf.get(b.eventId)?.name ?? 'Deleted event'}</div> : null}
                  </div>
                  {s.claims === 0 ? (
                    <IconButton
                      label={`Delete ${b.name}`}
                      size="sm"
                      plain
                      onClick={async () => {
                        if (await app.confirm({ title: `Delete “${b.name}”?`, message: `Its ${codes.length} code${codes.length === 1 ? '' : 's'} stop working.`, confirmLabel: 'Delete', tone: 'danger' })) await run('Deleted', () => deleteBatch(b.id));
                      }}
                    >
                      <Trash2 size={15} />
                    </IconButton>
                  ) : null}
                </div>
                <div className="row wrap" style={{ gap: 6 }}>
                  {shared ? <Badge tone="yellow">Shared code {shared.code}</Badge> : <Badge>{formatCount(codes.length)} single-use codes</Badge>}
                  {b.mode === 'shared' ? <Badge>{b.maxUses === null ? 'No use limit' : `Up to ${b.maxUses} uses`}</Badge> : null}
                  {b.earnMin ? <Badge tone="teal">Earned with a sale of {peso(b.earnMin)}+</Badge> : null}
                  {b.active ? null : <Badge>Turned off</Badge>}
                  {b.validTo < today ? <Badge>Expired</Badge> : null}
                </div>
                <div className="row between small">
                  <span className="muted">
                    {formatCount(s.claims)} used · {formatCount(s.open)} open
                    {s.discount ? ` · ${peso(s.discount)} off ${peso(s.price)}` : ''}
                  </span>
                </div>
                <div className="actions">
                  {b.mode === 'unique' ? (
                    <>
                      <Button size="sm" onClick={() => setAdding(b)}>
                        <Plus size={15} /> Make codes
                      </Button>
                      <Button size="sm" onClick={() => copyCodes(b)}>
                        <ClipboardCopy size={15} /> Copy codes
                      </Button>
                    </>
                  ) : shared ? (
                    <Button size="sm" onClick={() => void copy(shared.code, `${shared.code} copied`)}>
                      <ClipboardCopy size={15} /> Copy code
                    </Button>
                  ) : null}
                  <Button size="sm" variant="ghost" onClick={() => setEditing(b)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void run(b.active ? 'Turned off' : 'Turned on', () => setBatchActive(b.id, !b.active))}>
                    {b.active ? 'Turn off' : 'Turn on'}
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {data.claims.length ? (
        <section className="stack tight" aria-label="Who used them">
          <h2>Who used them</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Who</th>
                  <th>Code</th>
                  <th className="hide-phone">Service</th>
                  <th className="r">Price</th>
                  <th className="r">Off</th>
                  <th className="hide-phone">When</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {data.claims.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <b>{u.customerName || 'Customer'}</b>
                      <div className="muted tiny">{CLAIM_SOURCE_LABEL[u.source]}</div>
                    </td>
                    <td className="mono">{u.code}</td>
                    <td className="hide-phone small">{u.service}</td>
                    <td className="r">{peso(u.price)}</td>
                    <td className="r strong">{peso(u.discount)}</td>
                    <td className="hide-phone small nowrap">{fmtDate(u.at)}</td>
                    <td className="r">
                      {u.source === 'manual' ? (
                        <IconButton
                          label={`Remove the use of ${u.code}`}
                          size="sm"
                          plain
                          onClick={async () => {
                            if (await app.confirm({ title: `Remove this use of ${u.code}?`, message: 'The code can be used again.', confirmLabel: 'Remove', tone: 'danger' })) await run('Removed', () => removeClaim(u.id));
                          }}
                        >
                          <X size={15} />
                        </IconButton>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {data.coupons.length ? (
        <section className="stack tight" aria-label="Codes">
          <div className="row between wrap">
            <h2>Codes</h2>
            <div className="row wrap">
              <SearchInput value={q} onChange={setQ} placeholder="Code, set or name" ariaLabel="Search codes" />
              <Select aria-label="Status" value={state} onChange={(e) => setState(e.target.value as typeof state)} style={{ width: 'auto' }}>
                <option value="all">All</option>
                {(Object.keys(COUPON_STATE_LABEL) as CouponState[]).map((s) => (
                  <option key={s} value={s}>
                    {COUPON_STATE_LABEL[s]}
                  </option>
                ))}
              </Select>
              <Button onClick={csv}>
                <Download size={16} /> CSV
              </Button>
            </div>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Status</th>
                  <th className="hide-phone">Given to</th>
                  <th>Used by</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 300).map(({ c, b, st, used }) => {
                  const given = c.customerId ? custOf.get(c.customerId)?.name : undefined;
                  return (
                    <tr key={c.id}>
                      <td>
                        <b className="mono">{c.code}</b>
                        <div className="muted tiny">{b.name}</div>
                      </td>
                      <td>
                        <Badge tone={STATE_TONE[st]}>{COUPON_STATE_LABEL[st]}</Badge>
                      </td>
                      <td className="hide-phone small">
                        {given ?? (c.saleId ? 'Earned at the booth' : <span className="muted">—</span>)}
                      </td>
                      <td className="small">
                        {used.length ? (
                          used.map((u) => (
                            <div key={u.id}>
                              <b>{u.customerName || 'Customer'}</b> · {peso(u.discount)} off {peso(u.price)}
                              <div className="muted tiny">{u.service}</div>
                            </div>
                          ))
                        ) : (
                          <span className="muted">Not used</span>
                        )}
                      </td>
                      <td className="r">
                        <div className="actions" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                          {!used.length || b.mode === 'shared' ? (
                            <IconButton label={given ? `Change who has ${c.code}` : `Give ${c.code} to a customer`} size="sm" plain onClick={() => setGiving(c)}>
                              <UserRound size={15} />
                            </IconButton>
                          ) : null}
                          {st === 'open' || st === 'off' ? (
                            <Button size="sm" variant="ghost" onClick={() => void run('', () => setCouponOff(c.id, c.void !== 1))}>
                              {c.void === 1 ? 'Turn on' : 'Turn off'}
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rows.length > 300 ? <p className="muted small">Showing 300 of {formatCount(rows.length)}. Search to find a code, or download the CSV.</p> : null}
        </section>
      ) : null}

      <BatchDialog batch={editing} events={events} eventId={scope} onClose={() => setEditing(null)} />
      <AddCodesDialog batch={adding} onClose={() => setAdding(null)} />
      <ClaimDialog open={claiming} data={data} onClose={() => setClaiming(false)} />
      <CustomerPicker
        open={!!giving}
        onClose={() => setGiving(null)}
        eventId={giving?.eventId ?? null}
        onPick={(cust: Customer) => {
          const c = giving;
          setGiving(null);
          if (c) void run(`${c.code} is ${cust.name}’s`, () => giveCoupon(c.id, cust.id));
        }}
      />
    </div>
  );
}

const blankBatch = (ev: JWEvent | undefined): BatchInput => ({
  eventId: ev?.id ?? '',
  name: 'Booth handout',
  kind: 'amount',
  value: 30000,
  maxOff: 0,
  minSpend: COUPON_MIN_SPEND,
  validFrom: ev?.startDate || todayISO(),
  validTo: addDays(ev?.endDate || ev?.startDate || todayISO(), COUPON_DAYS_AFTER),
  mode: 'unique',
  maxUses: null,
  earnMin: 0,
  prefix: ev ? couponPrefix(ev.name, ev.startDate) : 'JW',
  notes: '',
  count: 50,
  code: '',
});

function BatchDialog({ batch, events, eventId, onClose }: { batch: CouponBatch | 'new' | null; events: JWEvent[]; eventId: string | null; onClose: () => void }) {
  const app = useApp();
  const [f, setF] = useState<BatchInput>(blankBatch(undefined));
  const [earn, setEarn] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const isNew = batch === 'new';

  useEffect(() => {
    if (!batch) return;
    setError('');
    if (batch === 'new') {
      const ev = events.find((e) => e.id === eventId) ?? events[0];
      setF(blankBatch(ev));
      setEarn(false);
    } else {
      setF({ ...batch, count: 0, code: '' });
      setEarn(batch.earnMin > 0);
    }
  }, [batch]); // eslint-disable-line react-hooks/exhaustive-deps

  const sample = useMemo(() => randomCode(f.prefix.toUpperCase().replace(/[^A-Z0-9]/g, '') || 'JW'), [f.prefix]);
  if (!batch) return null;
  const set = (p: Partial<BatchInput>) => setF({ ...f, ...p });
  const pickEvent = (id: string) => {
    const ev = events.find((e) => e.id === id);
    set({ eventId: id, ...(ev ? { validFrom: ev.startDate || f.validFrom, validTo: addDays(ev.endDate || ev.startDate || todayISO(), COUPON_DAYS_AFTER), prefix: couponPrefix(ev.name, ev.startDate) } : {}) });
  };

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const out = await saveBatch({ ...f, earnMin: earn && f.mode === 'unique' ? f.earnMin : 0, id: isNew ? undefined : batch.id });
      app.toast(isNew ? `Made “${out.name}”` : 'Saved', { tone: 'good' });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t save the coupons');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={isNew ? 'New service coupons' : `Edit “${batch.name}”`}
      size="wide"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={busy}>
            {isNew ? (f.mode === 'unique' && f.count ? `Make ${f.count} code${f.count === 1 ? '' : 's'}` : 'Make the coupons') : 'Save'}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        {isNew ? (
          <Field label="Event" htmlFor="cp-event" hint="Coupons belong to one event, so you can see what each booth brought in.">
            <Select id="cp-event" value={f.eventId} onChange={(e) => pickEvent(e.target.value)}>
              {events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field label="Name" htmlFor="cp-name">
          <TextInput id="cp-name" value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="Booth handout, Facebook post, spend ₱500…" />
        </Field>
      </div>

      {isNew ? (
        <Segmented
          label="Codes"
          value={f.mode}
          onChange={(mode) => set({ mode })}
          options={[
            { value: 'unique', label: 'Single-use codes' },
            { value: 'shared', label: 'One shared code' },
          ]}
        />
      ) : null}

      <div className="form-grid">
        {isNew && f.mode === 'unique' ? (
          <Field label="Codes to make now" htmlFor="cp-count" hint="Up to 500. Make more later, or 0 if booth sales earn them.">
            <NumberInput id="cp-count" decimals={false} min={0} value={f.count ?? 0} onChange={(n) => set({ count: Math.max(0, Math.round(n ?? 0)) })} />
          </Field>
        ) : null}
        {isNew && f.mode === 'shared' ? (
          <Field label="The code" htmlFor="cp-code" hint="Leave it blank to make one up.">
            <TextInput id="cp-code" value={f.code ?? ''} onChange={(e) => set({ code: e.target.value.toUpperCase() })} placeholder={`e.g. ${f.prefix}-STUDIO`} />
          </Field>
        ) : null}
        {f.mode === 'shared' ? (
          <Field label="Uses allowed" htmlFor="cp-uses" hint="Blank for no limit.">
            <NumberInput id="cp-uses" decimals={false} min={1} value={f.maxUses} onChange={(n) => set({ maxUses: n === null ? null : Math.max(1, Math.round(n)) })} />
          </Field>
        ) : null}
        <Field label="Codes start with" htmlFor="cp-prefix" hint={`They look like ${sample}.`}>
          <TextInput id="cp-prefix" value={f.prefix} disabled={!isNew} onChange={(e) => set({ prefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) })} />
        </Field>
      </div>

      <div className="form-grid">
        <Field label="Takes off">
          <Segmented
            label="Takes off"
            value={f.kind}
            onChange={(kind) => set({ kind, value: kind === 'percent' ? 10 : 30000 })}
            options={[
              { value: 'amount', label: 'Pesos' },
              { value: 'percent', label: 'Percent' },
            ]}
          />
        </Field>
        {f.kind === 'amount' ? (
          <Field label="Amount off" htmlFor="cp-value">
            <MoneyInput id="cp-value" value={f.value} onChange={(c) => set({ value: c ?? 0 })} />
          </Field>
        ) : (
          <>
            <Field label="Percent off" htmlFor="cp-value">
              <NumberInput id="cp-value" min={0} value={f.value} onChange={(n) => set({ value: n ?? 0 })} suffix="%" />
            </Field>
            <Field label="At most" htmlFor="cp-cap" hint="Blank for no cap.">
              <MoneyInput id="cp-cap" value={f.maxOff || null} onChange={(c) => set({ maxOff: c ?? 0 })} />
            </Field>
          </>
        )}
        <Field label="For services of at least" htmlFor="cp-min" hint={`${peso(COUPON_MIN_SPEND)} or more.`}>
          <MoneyInput id="cp-min" value={f.minSpend} onChange={(c) => set({ minSpend: c ?? 0 })} />
        </Field>
        <Field label="Good from" htmlFor="cp-from">
          <TextInput id="cp-from" type="date" value={f.validFrom} onChange={(e) => set({ validFrom: e.target.value })} />
        </Field>
        <Field label="Expires after" htmlFor="cp-to" hint={`${COUPON_DAYS_AFTER} days after the event to start.`}>
          <TextInput id="cp-to" type="date" value={f.validTo} onChange={(e) => set({ validTo: e.target.value })} />
        </Field>
      </div>

      {f.mode === 'unique' ? (
        <div className="stack tight">
          <Toggle id="cp-earn" checked={earn} onChange={(v) => setEarn(v)} label="Booth sales earn one" />
          {earn ? (
            <Field label="A sale of at least" htmlFor="cp-earn-min" hint="The code shows on the receipt, the QR copy and the emailed receipt. One per sale; the biggest set it reaches.">
              <MoneyInput id="cp-earn-min" value={f.earnMin || null} onChange={(c) => set({ earnMin: c ?? 0 })} />
            </Field>
          ) : null}
        </div>
      ) : null}

      <Field label="Notes" htmlFor="cp-notes">
        <TextArea id="cp-notes" rows={2} value={f.notes} onChange={(e) => set({ notes: e.target.value })} />
      </Field>
      <p className="muted small">{termsText({ ...f, maxOff: f.kind === 'percent' ? f.maxOff : 0 })} Everyone’s share of the job (printer, designer) is worked out on the price after the coupon.</p>
      {error ? <Callout tone="bad">{error}</Callout> : null}
    </Dialog>
  );
}

function AddCodesDialog({ batch, onClose }: { batch: CouponBatch | null; onClose: () => void }) {
  const app = useApp();
  const [count, setCount] = useState<number | null>(20);
  const [busy, setBusy] = useState(false);
  useEffect(() => setCount(20), [batch]);
  if (!batch) return null;
  const make = async () => {
    setBusy(true);
    try {
      const codes = await addCodes(batch.id, count ?? 0);
      app.toast(`${codes.length} new codes in “${batch.name}”`, { tone: 'good' });
      onClose();
    } catch (e) {
      app.toast(e instanceof Error ? e.message : 'Couldn’t make the codes', { tone: 'bad' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={`More codes for “${batch.name}”`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={make} disabled={busy || !count}>
            Make {count ?? 0}
          </Button>
        </>
      }
    >
      <Field label="How many" htmlFor="cp-more" hint="Each is a new single-use code with the same terms.">
        <NumberInput id="cp-more" decimals={false} min={1} value={count} onChange={setCount} autoFocus />
      </Field>
    </Dialog>
  );
}

/** A coupon used on a service the app can't see: booked on Messenger, or in Studio on another device. */
function ClaimDialog({ open, data, onClose }: { open: boolean; data: CouponData; onClose: () => void }) {
  const app = useApp();
  const [code, setCode] = useState('');
  const [service, setService] = useState('');
  const [price, setPrice] = useState<Cents | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [name, setName] = useState('');
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    setCode('');
    setService('');
    setPrice(null);
    setCustomer(null);
    setName('');
    setError('');
  }, [open]);
  if (!open) return null;
  const save = async () => {
    setError('');
    try {
      await recordClaim({ code, service, price: price ?? 0, customerId: customer?.id ?? null, customerName: customer?.name ?? name });
      app.toast('Use recorded', { tone: 'good' });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t record it');
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Record a coupon use"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>
            Record it
          </Button>
        </>
      }
    >
      <p className="muted small">For a service booked somewhere the app can’t see. Service orders, orders, quotes and Studio jobs on this device record their coupons by themselves.</p>
      <div className="form-grid">
        <Field label="Coupon code" htmlFor="cl-code">
          <TextInput id="cl-code" list="cl-codes" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g. KI26-7F3QX" />
          <datalist id="cl-codes">
            {data.coupons.slice(0, 200).map((c) => (
              <option key={c.id} value={c.code} />
            ))}
          </datalist>
        </Field>
        <Field label="Price of the service" htmlFor="cl-price" hint="Before the coupon.">
          <MoneyInput id="cl-price" value={price} onChange={setPrice} />
        </Field>
        <Field label="What it was for" htmlFor="cl-service" className="span-2">
          <TextInput id="cl-service" value={service} onChange={(e) => setService(e.target.value)} placeholder="Logo design for Kape Uno" />
        </Field>
        {customer ? (
          <div className="row span-2">
            <UserRound size={18} />
            <b className="grow">{customer.name}</b>
            <IconButton label="Choose a different customer" size="sm" onClick={() => setCustomer(null)}>
              <X size={16} />
            </IconButton>
          </div>
        ) : (
          <>
            <Field label="Who used it" htmlFor="cl-name">
              <TextInput id="cl-name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <div className="field">
              <span className="label">&nbsp;</span>
              <Button onClick={() => setPicking(true)}>
                <UserRound size={15} /> Pick a saved customer
              </Button>
            </div>
          </>
        )}
      </div>
      {error ? <Callout tone="bad">{error}</Callout> : null}
      <CustomerPicker
        open={picking}
        onClose={() => setPicking(false)}
        eventId={null}
        onPick={(c) => {
          setCustomer(c);
          setPicking(false);
        }}
      />
    </Dialog>
  );
}
