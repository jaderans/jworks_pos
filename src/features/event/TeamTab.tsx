import { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2, UserPlus } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { useEventData } from './useEventData';
import { usePayouts } from '../../hooks/data';
import { Dialog } from '../../components/Dialog';
import { Badge, Button, Callout, IconButton, Initials, Loading, Segmented, Toggle } from '../../components/ui';
import { Field, MoneyInput, NumberInput, Select, TextInput } from '../../components/form';
import { formatPct, peso, type Cents } from '../../lib/money';
import { daysBetween, fmtIsoWeekday, shiftHours } from '../../lib/time';
import { rosterHours } from '../../domain/share';
import { addToRoster, deleteDeal, removeFromRoster, saveDeal, updateEvent, updateRoster } from '../../services/events';
import { finalizePayouts, markPayoutPaid } from '../../services/team';
import type { JWEvent, PartnerDeal, RosterEntry, ShareSettings, Tier } from '../../db/types';

export default function TeamTab({ ev }: { ev: JWEvent }) {
  const app = useApp();
  const d = useEventData(ev);
  const payouts = usePayouts(ev.id);
  const [adding, setAdding] = useState(false);
  const [shiftsFor, setShiftsFor] = useState<RosterEntry | null>(null);
  const [deal, setDeal] = useState<Partial<PartnerDeal> | null>(null);
  const [paying, setPaying] = useState<string | null>(null);

  if (d.loading || !payouts) return <Loading />;
  const s = d.share;
  const cfg = ev.share;
  const setShare = (changes: Partial<ShareSettings>) => updateEvent(ev.id, { share: { ...cfg, ...changes } });
  const partners = d.members.filter((m) => m.appRole === 'partner' && m.active === 1);
  const staffById = new Map(s.staff.map((x) => [x.rosterId, x]));

  const save = async () => {
    const r = await finalizePayouts(ev.id, s);
    app.toast(`Saved payouts for ${r.saved} ${r.saved === 1 ? 'person' : 'people'}`, { tone: 'good' });
    if (r.changedAfterPaid.length) app.toast(`${r.changedAfterPaid.length} payout(s) were already paid and now compute differently. Check them.`, { tone: 'bad' });
  };

  return (
    <div className="stack loose">
      <section className="stack">
        <div className="row between wrap">
          <div>
            <h2>On duty at {ev.name}</h2>
            <p className="muted small">Role weight × hours worked decides each person&rsquo;s share of the staff pool.</p>
          </div>
          <Button onClick={() => setAdding(true)}>
            <UserPlus size={18} /> Add to roster
          </Button>
        </div>
        {d.roster.length === 0 ? <Callout tone="info">Nobody is on the roster yet. Add the team working this event.</Callout> : null}
        {d.roster.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Role</th>
                  <th className="r">Weight</th>
                  <th className="r">Hours</th>
                  <th>In pool</th>
                  <th className="r">Payout</th>
                  <th className="r"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {d.roster.map((r) => {
                  const m = d.memberMap.get(r.memberId);
                  const line = staffById.get(r.id);
                  return (
                    <tr key={r.id}>
                      <td>
                        <div className="row" style={{ gap: 8 }}>
                          <Initials name={m?.name ?? '?'} />
                          <b>{m?.name ?? 'Unknown'}</b>
                        </div>
                      </td>
                      <td style={{ minWidth: 130 }}>
                        <InlineText value={r.roleLabel} label={`Role of ${m?.name}`} onCommit={(v) => updateRoster(r.id, { roleLabel: v })} />
                      </td>
                      <td className="r" style={{ width: 90 }}>
                        <InlineNumber value={r.weight} label={`Weight of ${m?.name}`} onCommit={(v) => updateRoster(r.id, { weight: v ?? 0 })} />
                      </td>
                      <td className="r">
                        <Button size="sm" variant="ghost" onClick={() => setShiftsFor(r)}>
                          {rosterHours(r)} h
                        </Button>
                      </td>
                      <td>
                        <Toggle id={`pool-${r.id}`} checked={r.inPool === 1} onChange={(v) => updateRoster(r.id, { inPool: v ? 1 : 0 })} label={<span className="sr-only">In the pool</span>} />
                      </td>
                      <td className="r">
                        {line ? (
                          <>
                            <b>{peso(line.amount)}</b>
                            {line.belowMin ? <div><Badge tone="warn">{line.topUp ? 'Topped up' : 'Below minimum'}</Badge></div> : null}
                          </>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="r">
                        <IconButton
                          label={`Remove ${m?.name} from the roster`}
                          size="sm"
                          onClick={async () => {
                            if (await app.confirm({ title: `Remove ${m?.name ?? 'this person'} from the roster?`, confirmLabel: 'Remove', tone: 'danger' })) await removeFromRoster(r.id);
                          }}
                        >
                          <Trash2 size={16} />
                        </IconButton>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <div className="grid-2">
        <div className="card">
          <h2>Profit share</h2>
          <div className="waterfall">
            <div className="wf-row"><span>Gross sales</span><span className="v">{peso(s.gross)}</span></div>
            <div className="wf-row sub"><span>− Production cost</span><span className="v">{peso(cfg.poolMode === 'supplies' ? s.costs.materialsUsed : s.cogs)}</span></div>
            {cfg.royaltiesBeforePool ? (
              <>
                <div className="wf-row sub"><span>− Partner shares</span><span className="v">{peso(s.partnerTotal)}</span></div>
                <div className="wf-row sub"><span>− Design royalties</span><span className="v">{peso(s.royaltyTotal)}</span></div>
              </>
            ) : null}
            <div className="wf-row total"><span>Trading profit</span><span className="v">{peso(s.tradingProfit)}</span></div>
            {cfg.poolMode === 'all' ? <div className="wf-row sub"><span>− Booth fee and event costs</span><span className="v">{peso(s.costs.total)}</span></div> : null}
            <div className="wf-row total"><span>Profit pool</span><span className="v">{peso(s.pool)}</span></div>
            <div className="wf-row"><span>JoshWorks {cfg.joshworksPct}%</span><span className="v">{peso(s.joshworks)}</span></div>
            <div className="wf-row"><span>Staff pool {100 - cfg.joshworksPct}%</span><span className="v">{peso(s.staffPool)}</span></div>
            {s.topUpTotal ? <div className="wf-row sub"><span>Top-ups to the minimum (from JoshWorks)</span><span className="v">{peso(s.topUpTotal)}</span></div> : null}
            <div className="wf-row final"><span>JoshWorks keeps</span><span className="v">{peso(s.joshworksNet)}</span></div>
          </div>
          {s.warnings.map((w) => (
            <Callout key={w} tone="warn">
              {w}
            </Callout>
          ))}
        </div>
        <div className="card">
          <h2>How it&rsquo;s split</h2>
          <Field label="JoshWorks share" htmlFor="jw-pct" hint={`Staff pool gets the other ${100 - cfg.joshworksPct}%.`}>
            <NumberInput id="jw-pct" value={cfg.joshworksPct} onChange={(n) => setShare({ joshworksPct: Math.max(0, Math.min(100, n ?? 0)) })} suffix="%" />
          </Field>
          <div className="field">
            <span className="label">What comes out before the split</span>
            <Segmented
              label="Pool mode"
              value={cfg.poolMode}
              onChange={(v) => setShare({ poolMode: v })}
              options={[
                { value: 'all', label: 'Production + event costs' },
                { value: 'cogs', label: 'Production cost only' },
                { value: 'supplies', label: 'Old sheet' },
              ]}
            />
            <span className="hint">
              {cfg.poolMode === 'all'
                ? 'Booth fee, used-up items and assets’ share come out before anyone is paid.'
                : cfg.poolMode === 'cogs'
                  ? 'Event costs are paid from the JoshWorks share.'
                  : 'Like the AYS sheet: sales minus materials used; JoshWorks pays the booth.'}
            </span>
          </div>
          <div className="field">
            <span className="label">Staff pool divided by</span>
            <Segmented
              label="Split by"
              value={cfg.weightMode}
              onChange={(v) => setShare({ weightMode: v })}
              options={[
                { value: 'weighthours', label: 'Weight × hours' },
                { value: 'weight', label: 'Weight only' },
                { value: 'equal', label: 'Equal' },
              ]}
            />
          </div>
          <div className="form-grid">
            <Field label="Minimum guarantee" htmlFor="min-g" hint="Your AYS sheet used ₱500.">
              <MoneyInput id="min-g" value={cfg.minGuarantee} onChange={(c) => setShare({ minGuarantee: c })} placeholder="Off" />
            </Field>
            <div className="field" style={{ alignContent: 'end' }}>
              <Toggle id="topup" checked={cfg.topUp} onChange={(v) => setShare({ topUp: v })} label="Top up from JoshWorks" />
            </div>
          </div>
          <Toggle id="royal-before" checked={cfg.royaltiesBeforePool} onChange={(v) => setShare({ royaltiesBeforePool: v })} label="Partner shares and royalties come out before the pool" />
        </div>
      </div>

      <section className="stack">
        <div className="row between wrap">
          <div>
            <h2>Partner deals</h2>
            <p className="muted small">For co-branded items (like SparkHub at Westival). Partners must be on the team list with the Partner role.</p>
          </div>
          <Button onClick={() => setDeal({ basis: 'net', mode: 'fixed', fixedPct: 20, tiers: [], productIds: [] })} disabled={!partners.length}>
            <Plus size={18} /> Add deal
          </Button>
        </div>
        {!partners.length ? <p className="muted small">Add a partner in Team (role: Partner) to set up a deal.</p> : null}
        {s.partners.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Deal</th>
                  <th className="r">Sold</th>
                  <th className="r">Sell-through</th>
                  <th className="r">Base</th>
                  <th className="r">Share</th>
                  <th className="r">Partner gets</th>
                  <th className="r"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {s.partners.map((p) => {
                  const dl = d.deals.find((x) => x.id === p.dealId);
                  return (
                    <tr key={p.dealId}>
                      <td>
                        <b>{p.dealName}</b>
                        <div className="muted tiny">
                          {p.partnerName} · {dl?.basis === 'net' ? 'of sales minus production cost' : 'of sales'} · {dl?.mode === 'tiered' ? 'tiered' : 'fixed'}
                        </div>
                      </td>
                      <td className="r">{p.units}</td>
                      <td className="r">{p.sellThroughPct === null ? '—' : formatPct(p.sellThroughPct)}</td>
                      <td className="r">{peso(p.base)}</td>
                      <td className="r">{p.pct}%</td>
                      <td className="r strong">{peso(p.amount)}</td>
                      <td className="r">
                        <div className="actions" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                          <IconButton label="Edit deal" size="sm" onClick={() => setDeal(dl ?? null)}>
                            <Pencil size={16} />
                          </IconButton>
                          <IconButton
                            label="Delete deal"
                            size="sm"
                            onClick={async () => {
                              if (await app.confirm({ title: `Delete ${p.dealName}?`, confirmLabel: 'Delete', tone: 'danger' })) await deleteDeal(p.dealId);
                            }}
                          >
                            <Trash2 size={16} />
                          </IconButton>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {s.royalties.length ? (
        <section className="stack">
          <h2>Design royalties</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Designer</th>
                  <th className="r">Pieces sold</th>
                  <th className="r">Sales</th>
                  <th className="r">Royalty</th>
                </tr>
              </thead>
              <tbody>
                {s.royalties.map((r) => (
                  <tr key={r.memberId}>
                    <td>{r.name}</td>
                    <td className="r">{r.units}</td>
                    <td className="r">{peso(r.revenue)}</td>
                    <td className="r strong">{peso(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="stack">
        <div className="row between wrap">
          <div>
            <h2>Payouts</h2>
            <p className="muted small">Save the split when the event is done. Each person sees their own payout on their phone. Mark them paid as you pay.</p>
          </div>
          <Button variant="primary" onClick={save} disabled={!s.staff.length && !s.partners.length && !s.royalties.length}>
            Save payouts
          </Button>
        </div>
        {payouts.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>For</th>
                  <th className="r">Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {payouts
                  .slice()
                  .sort((a, b) => b.amount - a.amount)
                  .map((p) => (
                    <tr key={p.id}>
                      <td>
                        <b>{d.memberMap.get(p.memberId)?.name ?? 'Unknown'}</b>
                        <div className="muted tiny">{p.detail}</div>
                      </td>
                      <td>
                        <Badge>{p.kind === 'staff' ? 'Staff share' : p.kind === 'partner' ? 'Partner share' : 'Royalty'}</Badge>
                      </td>
                      <td className="r strong">{peso(p.amount)}</td>
                      <td>
                        {p.status === 'paid' ? (
                          <button type="button" className="badge good" style={{ border: 0, cursor: 'pointer' }} onClick={() => markPayoutPaid(p.id, false)} title="Tap to mark as not paid">
                            Paid{p.method ? ` · ${p.method}` : ''}
                          </button>
                        ) : (
                          <Button size="sm" variant="teal" onClick={() => setPaying(p.id)}>
                            Mark paid
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted small">No payouts saved yet.</p>
        )}
      </section>

      <AddRosterDialog open={adding} onClose={() => setAdding(false)} ev={ev} members={d.members} rosterIds={d.roster.map((r) => r.memberId)} />
      <ShiftsDialog entry={shiftsFor} ev={ev} onClose={() => setShiftsFor(null)} />
      <DealDialog deal={deal} ev={ev} onClose={() => setDeal(null)} partners={partners} products={d.products} />
      <PayDialog payoutId={paying} onClose={() => setPaying(null)} />
    </div>
  );
}

function InlineText({ value, onCommit, label }: { value: string; onCommit: (v: string) => void; label: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return <input className="input" aria-label={label} value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onCommit(v.trim())} style={{ minHeight: 36 }} />;
}

function InlineNumber({ value, onCommit, label }: { value: number; onCommit: (v: number | null) => void; label: string }) {
  const [v, setV] = useState<number | null>(value);
  useEffect(() => setV(value), [value]);
  return (
    <div onBlur={() => v !== value && onCommit(v)}>
      <NumberInput ariaLabel={label} value={v} onChange={setV} />
    </div>
  );
}

function AddRosterDialog({ open, onClose, ev, members, rosterIds }: { open: boolean; onClose: () => void; ev: JWEvent; members: { id: string; name: string; roleLabel: string; weight: number; active: 0 | 1; appRole: string }[]; rosterIds: string[] }) {
  const available = members.filter((m) => m.active === 1 && !rosterIds.includes(m.id));
  return (
    <Dialog open={open} onClose={onClose} title="Add to the roster" footer={<Button onClick={onClose}>Done</Button>}>
      {available.length === 0 ? <p className="muted">Everyone on the team is already on the roster. Add new people in Team.</p> : null}
      <div className="card flush">
        <div className="list">
          {available.map((m) => (
            <div key={m.id} className="list-item">
              <Initials name={m.name} />
              <span className="main-text">
                <b>{m.name}</b>
                <span>
                  {m.roleLabel || 'No role'} · weight {m.weight}
                </span>
              </span>
              <Button size="sm" variant="teal" onClick={() => addToRoster(ev.id, m.id)}>
                <Plus size={16} /> Add
              </Button>
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  );
}

function ShiftsDialog({ entry, ev, onClose }: { entry: RosterEntry | null; ev: JWEvent; onClose: () => void }) {
  const [shifts, setShifts] = useState(entry?.shifts ?? []);
  const [override, setOverride] = useState<number | null>(entry?.hoursOverride ?? null);
  useEffect(() => {
    if (!entry) return;
    const days = daysBetween(ev.startDate, ev.endDate);
    const byDay = new Map(entry.shifts.map((s) => [s.date, s]));
    setShifts(days.map((date) => byDay.get(date) ?? { date, start: '', end: '' }));
    setOverride(entry.hoursOverride);
  }, [entry, ev.startDate, ev.endDate]);
  if (!entry) return null;
  const total = shifts.reduce((a, s) => a + (s.start && s.end ? shiftHours(s.start, s.end) : 0), 0);
  const save = async () => {
    await updateRoster(entry.id, { shifts: shifts.filter((s) => s.start && s.end), hoursOverride: override });
    onClose();
  };
  return (
    <Dialog
      open={!!entry}
      onClose={onClose}
      title="Shifts"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <p className="muted small">Times on duty each day. Leave a day blank if they weren&rsquo;t there.</p>
      {shifts.map((s, i) => (
        <div key={s.date} className="row wrap">
          <span className="strong" style={{ width: 120 }}>
            {fmtIsoWeekday(s.date)}
          </span>
          <TextInput type="time" aria-label="Start" value={s.start} onChange={(e) => setShifts(shifts.map((x, k) => (k === i ? { ...x, start: e.target.value } : x)))} style={{ width: 130 }} />
          <span>to</span>
          <TextInput type="time" aria-label="End" value={s.end} onChange={(e) => setShifts(shifts.map((x, k) => (k === i ? { ...x, end: e.target.value } : x)))} style={{ width: 130 }} />
          <span className="muted small">{s.start && s.end ? `${shiftHours(s.start, s.end)} h` : ''}</span>
        </div>
      ))}
      <p className="strong">Total from shifts: {Math.round(total * 100) / 100} h</p>
      <Field label="Or set the hours directly" htmlFor="h-override" hint="Overrides the shifts above. Leave blank to use them.">
        <NumberInput id="h-override" value={override} onChange={setOverride} suffix="h" placeholder="Use shifts" />
      </Field>
    </Dialog>
  );
}

function DealDialog({ deal, ev, onClose, partners, products }: { deal: Partial<PartnerDeal> | null; ev: JWEvent; onClose: () => void; partners: { id: string; name: string }[]; products: { id: string; name: string; active: 0 | 1 }[] }) {
  const [f, setF] = useState<Partial<PartnerDeal>>({});
  useEffect(() => {
    if (deal) setF({ partnerId: partners[0]?.id, name: '', ...deal });
  }, [deal, partners]);
  if (!deal) return null;
  const tiers: Tier[] = f.tiers?.length ? f.tiers : [];
  const westival: Tier[] = [
    { minPct: 0, partnerPct: 15 },
    { minPct: 26, partnerPct: 25 },
    { minPct: 40, partnerPct: 40 },
    { minPct: 70, partnerPct: 55 },
  ];
  const save = async () => {
    if (!f.partnerId || !f.name?.trim()) return;
    await saveDeal({ ...f, eventId: ev.id, partnerId: f.partnerId, name: f.name.trim() });
    onClose();
  };
  const toggleProduct = (id: string) => {
    const cur = new Set(f.productIds ?? []);
    if (cur.has(id)) cur.delete(id);
    else cur.add(id);
    setF({ ...f, productIds: [...cur] });
  };
  return (
    <Dialog
      open={!!deal}
      onClose={onClose}
      title={deal.id ? 'Edit partner deal' : 'New partner deal'}
      size="wide"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={!f.partnerId || !f.name?.trim()}>
            Save deal
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Partner" htmlFor="dl-partner">
          <Select id="dl-partner" value={f.partnerId ?? ''} onChange={(e) => setF({ ...f, partnerId: e.target.value })}>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Deal name" htmlFor="dl-name">
          <TextInput id="dl-name" value={f.name ?? ''} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Co-branded pins" />
        </Field>
      </div>
      <div className="field">
        <span className="label">Share of</span>
        <Segmented label="Basis" value={f.basis ?? 'net'} onChange={(v) => setF({ ...f, basis: v })} options={[{ value: 'net', label: 'Sales minus production cost' }, { value: 'gross', label: 'Sales' }]} />
      </div>
      <div className="field">
        <span className="label">Partner&rsquo;s share</span>
        <Segmented label="Mode" value={f.mode ?? 'fixed'} onChange={(v) => setF({ ...f, mode: v })} options={[{ value: 'fixed', label: 'Fixed %' }, { value: 'tiered', label: 'By sell-through' }]} />
      </div>
      {(f.mode ?? 'fixed') === 'fixed' ? (
        <Field label="Partner gets" htmlFor="dl-pct">
          <NumberInput id="dl-pct" value={f.fixedPct ?? 20} onChange={(n) => setF({ ...f, fixedPct: n ?? 0 })} suffix="%" />
        </Field>
      ) : (
        <div className="stack tight">
          <div className="row between">
            <span className="label strong small">Tiers (sell-through from → partner share)</span>
            <Button size="sm" variant="link" onClick={() => setF({ ...f, tiers: westival })}>
              Use the Westival tiers
            </Button>
          </div>
          {tiers.map((t, i) => (
            <div key={i} className="row">
              <span className="small">From</span>
              <div style={{ width: 110 }}>
                <NumberInput ariaLabel="Sell-through from" value={t.minPct} onChange={(n) => setF({ ...f, tiers: tiers.map((x, k) => (k === i ? { ...x, minPct: n ?? 0 } : x)) })} suffix="%" />
              </div>
              <span className="small">partner gets</span>
              <div style={{ width: 110 }}>
                <NumberInput ariaLabel="Partner share" value={t.partnerPct} onChange={(n) => setF({ ...f, tiers: tiers.map((x, k) => (k === i ? { ...x, partnerPct: n ?? 0 } : x)) })} suffix="%" />
              </div>
              <IconButton label="Remove tier" size="sm" onClick={() => setF({ ...f, tiers: tiers.filter((_, k) => k !== i) })}>
                <Trash2 size={16} />
              </IconButton>
            </div>
          ))}
          <Button size="sm" onClick={() => setF({ ...f, tiers: [...tiers, { minPct: tiers.length ? tiers[tiers.length - 1].minPct + 20 : 0, partnerPct: 20 }] })}>
            <Plus size={16} /> Add tier
          </Button>
          <p className="muted tiny">Sell-through uses the stock brought for these products (Event → Stock).</p>
        </div>
      )}
      <div className="field">
        <span className="label">Products in this deal ({f.productIds?.length ?? 0})</span>
        <div className="chip-row" style={{ maxHeight: 220, overflowY: 'auto' }}>
          {products
            .filter((p) => p.active === 1)
            .map((p) => (
              <button key={p.id} type="button" className="chip" aria-pressed={(f.productIds ?? []).includes(p.id)} onClick={() => toggleProduct(p.id)}>
                {p.name}
              </button>
            ))}
        </div>
      </div>
    </Dialog>
  );
}

function PayDialog({ payoutId, onClose }: { payoutId: string | null; onClose: () => void }) {
  const [method, setMethod] = useState('GCash');
  const [ref, setRef] = useState('');
  useEffect(() => {
    setMethod('GCash');
    setRef('');
  }, [payoutId]);
  return (
    <Dialog
      open={!!payoutId}
      onClose={onClose}
      title="Mark as paid"
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={async () => {
              if (payoutId) await markPayoutPaid(payoutId, true, method, ref);
              onClose();
            }}
          >
            Mark paid
          </Button>
        </>
      }
    >
      <Field label="Paid with" htmlFor="pay-m">
        <Select id="pay-m" value={method} onChange={(e) => setMethod(e.target.value)}>
          {['GCash', 'Cash', 'Maribank', 'Bank transfer', 'Maya'].map((m) => (
            <option key={m}>{m}</option>
          ))}
        </Select>
      </Field>
      <Field label="Reference (optional)" htmlFor="pay-ref">
        <TextInput id="pay-ref" value={ref} onChange={(e) => setRef(e.target.value)} />
      </Field>
    </Dialog>
  );
}

export type { Cents };
