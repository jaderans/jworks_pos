import { useEffect, useMemo, useState } from 'react';
import { Download, Plus, Ticket, Trash2, UserPlus, Users } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { useCustomerSales, useCustomers, useEvents, useSettingRows, useVouchers } from '../../hooks/data';
import { setSetting, settingValue } from '../../db/settings';
import { alive, db } from '../../db/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { Dialog } from '../../components/Dialog';
import { Badge, Button, Callout, EmptyState, Loading, PageHeader, Segmented, Stat, Toggle } from '../../components/ui';
import { Check, Field, MoneyInput, NumberInput, SearchInput, Select, TextArea, TextInput } from '../../components/form';
import { formatCount, peso, type Cents } from '../../lib/money';
import { fmtDate, fmtIsoDate, todayISO } from '../../lib/time';
import { downloadBlob, toCSV } from '../../lib/files';
import { loyaltyState, normalizeCode, rewardText, voucherUses } from '../../domain/loyalty';
import { deleteCustomer, deleteVoucher, saveCustomer, saveVoucher } from '../../services/customers';
import type { Customer, LoyaltySettings, Sale, Voucher } from '../../db/types';

type Tab = 'customers' | 'vouchers' | 'loyalty';

export default function CustomersPage() {
  const app = useApp();
  const owner = app.can('settings');
  const [tab, setTab] = useState<Tab>('customers');
  return (
    <div className="page">
      <PageHeader title="Customers" subtitle="The people who buy from the booth: their visits, stamp cards and voucher codes. Kept on this device and in backups, never online." />
      {owner ? (
        <Segmented<Tab>
          label="Section"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'customers', label: 'Customers' },
            { value: 'vouchers', label: 'Vouchers' },
            { value: 'loyalty', label: 'Stamp card' },
          ]}
        />
      ) : null}
      {tab === 'customers' || !owner ? <CustomerList /> : tab === 'vouchers' ? <VoucherList /> : <LoyaltyRules />}
    </div>
  );
}

// ---------- customers ----------

function CustomerList() {
  const app = useApp();
  const owner = app.can('settings');
  const customers = useCustomers();
  const sales = useCustomerSales();
  const rules = settingValue<LoyaltySettings>(useSettingRows(), 'loyalty');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Partial<Customer> | null>(null);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (customers ?? [])
      .filter((c) => !needle || `${c.name} ${c.phone} ${c.email} ${c.handle}`.toLowerCase().includes(needle))
      .map((c) => ({ c, st: loyaltyState(c.id, sales ?? [], { ...rules, enabled: true }) }));
  }, [customers, sales, rules, q]);

  if (!customers || !sales) return <Loading />;
  const consenting = customers.filter((c) => c.marketingOk === 1).length;

  const exportCsv = () => {
    const out = [['Name', 'Mobile', 'Email', 'Handle', 'OK to message', 'Visits', 'Spent', 'Stamps', 'Last visit', 'Added']];
    for (const { c, st } of rows) {
      out.push([c.name, c.phone, c.email, c.handle, c.marketingOk ? 'yes' : 'no', String(st.visits), (st.spent / 100).toFixed(2), rules.enabled ? String(st.balance) : '', st.lastAt ? fmtDate(st.lastAt) : '', fmtDate(c.createdAt)]);
    }
    downloadBlob(new Blob([toCSV(out)], { type: 'text/csv' }), `JoshWorks customers ${todayISO()}.csv`);
  };

  return (
    <div className="stack">
      <div className="stats">
        <Stat label="Customers" value={formatCount(customers.length)} />
        <Stat label="OK to message" value={formatCount(consenting)} hint="Agreed to hear about drops and events" />
        <Stat label="Came back" value={formatCount(rows.filter((r) => r.st.visits > 1).length)} hint="More than one visit" />
      </div>
      <div className="row wrap">
        <div className="grow" style={{ minWidth: 200 }}>
          <SearchInput value={q} onChange={setQ} placeholder="Search name, mobile, email or @handle" />
        </div>
        {owner ? (
          <Button onClick={exportCsv} disabled={!customers.length}>
            <Download size={16} /> Export
          </Button>
        ) : null}
        <Button variant="primary" onClick={() => setEditing({})}>
          <UserPlus size={18} /> Add customer
        </Button>
      </div>
      {customers.length === 0 ? (
        <EmptyState icon={<Users size={44} />} title="No customers yet">
          Add them at the register with the Customer button, or here. Stamps and emailed receipts need a customer on the sale.
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Customer</th>
                <th className="hide-phone">Contact</th>
                <th className="r">Visits</th>
                <th className="r hide-phone">Spent</th>
                {rules.enabled ? <th className="r">Stamps</th> : null}
                <th className="r hide-phone">Last visit</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ c, st }) => (
                <tr key={c.id} className="click" onClick={() => setEditing(c)}>
                  <td>
                    <b>{c.name}</b>
                    {c.handle ? <div className="muted tiny">{c.handle}</div> : null}
                  </td>
                  <td className="hide-phone small">{[c.phone, c.email].filter(Boolean).join(' · ') || <span className="muted">—</span>}</td>
                  <td className="r">{st.visits}</td>
                  <td className="r hide-phone">{peso(st.spent)}</td>
                  {rules.enabled ? (
                    <td className="r">
                      {st.balance}
                      {st.rewards ? <Badge tone="yellow">Reward</Badge> : null}
                    </td>
                  ) : null}
                  <td className="r hide-phone">{st.lastAt ? fmtDate(st.lastAt) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <CustomerDialog customer={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function CustomerDialog({ customer, onClose }: { customer: Partial<Customer> | null; onClose: () => void }) {
  const app = useApp();
  const owner = app.can('settings');
  const events = useEvents();
  const rules = settingValue<LoyaltySettings>(useSettingRows(), 'loyalty');
  const history = useLiveQuery(
    async () => (customer?.id ? alive(await db.sales.where('customerId').equals(customer.id).toArray()).sort((a, b) => b.at - a.at) : []),
    [customer?.id],
  );
  const [f, setF] = useState({ name: '', phone: '', email: '', handle: '', notes: '', marketingOk: false });
  const [error, setError] = useState('');
  useEffect(() => {
    if (!customer) return;
    setF({ name: customer.name ?? '', phone: customer.phone ?? '', email: customer.email ?? '', handle: customer.handle ?? '', notes: customer.notes ?? '', marketingOk: customer.marketingOk === 1 });
    setError('');
  }, [customer]);
  if (!customer) return null;
  const isNew = !customer.id;
  const st = customer.id ? loyaltyState(customer.id, history ?? [], rules) : null;
  const eventName = new Map((events ?? []).map((e) => [e.id, e.name]));

  const save = async () => {
    try {
      await saveCustomer({ ...customer, ...f, marketingOk: f.marketingOk ? 1 : 0, firstEventId: customer.firstEventId ?? app.activeEventId });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    }
  };
  const remove = async () => {
    if (!customer.id) return;
    if (!(await app.confirm({ title: `Delete ${customer.name}’s details?`, message: 'Their name, number, email and notes are erased from this device. Their past sales stay, without a name.', confirmLabel: 'Delete', tone: 'danger' }))) return;
    await deleteCustomer(customer.id);
    onClose();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={isNew ? 'New customer' : customer.name}
      size="wide"
      footer={
        <>
          {!isNew && owner ? (
            <Button variant="danger" onClick={remove}>
              <Trash2 size={16} /> Delete on request
            </Button>
          ) : null}
          <span className="grow" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={!f.name.trim()}>
            {isNew ? 'Add' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Name" htmlFor="cd-name" className="span-2">
          <TextInput id="cd-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus />
        </Field>
        <Field label="Mobile number" htmlFor="cd-phone">
          <TextInput id="cd-phone" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        </Field>
        <Field label="Email" htmlFor="cd-email">
          <TextInput id="cd-email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </Field>
        <Field label="Instagram / Facebook / TikTok" htmlFor="cd-handle" className="span-2">
          <TextInput id="cd-handle" value={f.handle} onChange={(e) => setF({ ...f, handle: e.target.value })} placeholder="@handle" />
        </Field>
      </div>
      <Check
        id="cd-consent"
        checked={f.marketingOk}
        onChange={(v) => setF({ ...f, marketingOk: v })}
        label="They agreed to hear about new drops and events"
        sub={customer.consentAt && customer.marketingOk ? `Agreed on ${fmtDate(customer.consentAt)}.` : 'Ask first. Without this, their details are used only for receipts, stamps and orders.'}
      />
      <Field label="Notes" htmlFor="cd-notes">
        <TextArea id="cd-notes" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Favorite designs, sizes, commission ideas…" />
      </Field>
      {error ? <Callout tone="bad">{error}</Callout> : null}
      {st && history && history.length ? (
        <div className="stack tight">
          <h3>History</h3>
          <p className="muted small">
            {st.visits} visit{st.visits === 1 ? '' : 's'} · {peso(st.spent)} spent
            {rules.enabled ? ` · ${st.balance} stamp${st.balance === 1 ? '' : 's'} on the card (${st.rewards ? `${rewardText(rules)} ready` : `${st.toNext} more for ${rewardText(rules)}`})` : ''}
          </p>
          <div className="card flush">
            <div className="list">
              {history.slice(0, 20).map((s: Sale) => (
                <div key={s.id} className={`list-item ${s.status === 'voided' ? 'muted' : ''}`}>
                  <span className="mono small">{s.receiptNo}</span>
                  <span className="main-text">
                    <b>{s.lines.map((l) => `${l.qty}× ${l.name}`).join(', ')}</b>
                    <span>
                      {fmtDate(s.at)} · {eventName.get(s.eventId) ?? 'Event'}
                      {s.status === 'voided' ? ' · voided' : ''}
                    </span>
                  </span>
                  <b className="num">{peso(s.total)}</b>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}

// ---------- vouchers ----------

function VoucherList() {
  const vouchers = useVouchers();
  const events = useEvents();
  const used = useLiveQuery(async () => alive(await db.sales.where('voucherCode').above('').toArray()), []);
  const [editing, setEditing] = useState<Partial<Voucher> | null>(null);
  if (!vouchers || !used) return <Loading />;
  const eventName = new Map((events ?? []).map((e) => [e.id, e.name]));
  const today = todayISO();
  return (
    <div className="stack">
      <div className="row between wrap">
        <p className="muted" style={{ maxWidth: '65ch' }}>
          Codes customers say at the register, like KOMIKET50 for a social media post. Uses are counted from sales; two phones selling offline can go slightly over a limit until their sales are merged.
        </p>
        <Button variant="primary" onClick={() => setEditing({ kind: 'amount', active: 1 })}>
          <Plus size={18} /> New voucher
        </Button>
      </div>
      {vouchers.length === 0 ? (
        <EmptyState icon={<Ticket size={44} />} title="No vouchers yet">
          Make one for a post, a partner or a returning customer.
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Takes off</th>
                <th className="hide-phone">Rules</th>
                <th className="r">Used</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {vouchers.map((v) => {
                const uses = voucherUses(v.code, used).length;
                const expired = !!v.validTo && today > v.validTo;
                const usedUp = v.maxUses !== null && uses >= v.maxUses;
                return (
                  <tr key={v.id} className={`click ${v.active ? '' : 'muted'}`} onClick={() => setEditing(v)}>
                    <td>
                      <b className="mono">{v.code}</b>
                      {v.label ? <div className="muted tiny">{v.label}</div> : null}
                    </td>
                    <td>{v.kind === 'percent' ? `${v.value}%` : peso(v.value)}</td>
                    <td className="hide-phone small">
                      {[
                        v.minSpend ? `min ${peso(v.minSpend)}` : '',
                        v.eventId ? eventName.get(v.eventId) ?? 'one event' : '',
                        v.validFrom || v.validTo ? `${v.validFrom ? fmtIsoDate(v.validFrom) : '…'} – ${v.validTo ? fmtIsoDate(v.validTo) : '…'}` : '',
                        v.perCustomer !== null ? `${v.perCustomer} per customer` : '',
                      ]
                        .filter(Boolean)
                        .join(' · ') || 'Any sale'}
                    </td>
                    <td className="r">
                      {uses}
                      {v.maxUses !== null ? ` / ${v.maxUses}` : ''}
                    </td>
                    <td>{!v.active ? <Badge>Off</Badge> : expired ? <Badge>Ended</Badge> : usedUp ? <Badge tone="warn">Used up</Badge> : <Badge tone="good">Active</Badge>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <VoucherDialog voucher={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function VoucherDialog({ voucher, onClose }: { voucher: Partial<Voucher> | null; onClose: () => void }) {
  const app = useApp();
  const events = useEvents();
  const [f, setF] = useState<Partial<Voucher>>({});
  const [error, setError] = useState('');
  useEffect(() => {
    if (!voucher) return;
    setF({ code: '', label: '', kind: 'amount', value: 0, minSpend: 0, validFrom: '', validTo: '', eventId: null, maxUses: null, perCustomer: null, active: 1, notes: '', ...voucher });
    setError('');
  }, [voucher]);
  if (!voucher) return null;
  const isNew = !voucher.id;
  const save = async () => {
    try {
      await saveVoucher({ ...f, code: f.code ?? '' });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={isNew ? 'New voucher' : `Voucher ${voucher.code}`}
      size="wide"
      footer={
        <>
          {!isNew ? (
            <Button
              variant="danger"
              onClick={async () => {
                if (await app.confirm({ title: `Delete ${voucher.code}?`, message: 'Sales that used it keep their discount.', confirmLabel: 'Delete', tone: 'danger' })) {
                  await deleteVoucher(voucher.id!);
                  onClose();
                }
              }}
            >
              Delete
            </Button>
          ) : null}
          <span className="grow" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={!normalizeCode(f.code ?? '') || !f.value}>
            Save
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Code" htmlFor="vo-code" hint="Letters, numbers and dashes. Customers say or show it at the register.">
          <TextInput id="vo-code" value={f.code ?? ''} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} autoFocus placeholder="KOMIKET50" autoCapitalize="characters" />
        </Field>
        <Field label="What it’s for" htmlFor="vo-label" hint="Shown on the receipt.">
          <TextInput id="vo-label" value={f.label ?? ''} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="Facebook post, partner, returning customer…" />
        </Field>
        <div className="field">
          <span className="label">Takes off</span>
          <Segmented<'amount' | 'percent'>
            label="Voucher type"
            full
            value={f.kind ?? 'amount'}
            onChange={(kind) => setF({ ...f, kind, value: 0 })}
            options={[
              { value: 'amount', label: 'Pesos' },
              { value: 'percent', label: 'Percent' },
            ]}
          />
        </div>
        <Field label={f.kind === 'percent' ? 'Percent off' : 'Pesos off'} htmlFor="vo-value">
          {f.kind === 'percent' ? (
            <NumberInput id="vo-value" value={f.value || null} onChange={(n) => setF({ ...f, value: n ?? 0 })} suffix="%" />
          ) : (
            <MoneyInput id="vo-value" value={f.value || null} onChange={(c) => setF({ ...f, value: c ?? 0 })} />
          )}
        </Field>
        <Field label="Minimum spend" htmlFor="vo-min" hint="After bundle deals. Leave empty for any sale.">
          <MoneyInput id="vo-min" value={f.minSpend || null} onChange={(c) => setF({ ...f, minSpend: (c ?? 0) as Cents })} />
        </Field>
        <Field label="Only at" htmlFor="vo-event">
          <Select id="vo-event" value={f.eventId ?? ''} onChange={(e) => setF({ ...f, eventId: e.target.value || null })}>
            <option value="">Any event</option>
            {(events ?? []).map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Starts" htmlFor="vo-from">
          <TextInput id="vo-from" type="date" value={f.validFrom ?? ''} onChange={(e) => setF({ ...f, validFrom: e.target.value })} />
        </Field>
        <Field label="Ends" htmlFor="vo-to">
          <TextInput id="vo-to" type="date" value={f.validTo ?? ''} onChange={(e) => setF({ ...f, validTo: e.target.value })} />
        </Field>
        <Field label="Total uses" htmlFor="vo-max" hint="Empty for no limit.">
          <NumberInput id="vo-max" decimals={false} min={1} value={f.maxUses ?? null} onChange={(n) => setF({ ...f, maxUses: n && n > 0 ? Math.round(n) : null })} />
        </Field>
        <Field label="Uses per customer" htmlFor="vo-per" hint="Needs the customer on the sale. Empty for no limit.">
          <NumberInput id="vo-per" decimals={false} min={1} value={f.perCustomer ?? null} onChange={(n) => setF({ ...f, perCustomer: n && n > 0 ? Math.round(n) : null })} />
        </Field>
      </div>
      <Toggle id="vo-active" checked={(f.active ?? 1) === 1} onChange={(v) => setF({ ...f, active: v ? 1 : 0 })} label="Active" />
      {error ? <Callout tone="bad">{error}</Callout> : null}
    </Dialog>
  );
}

// ---------- stamp card ----------

function LoyaltyRules() {
  const app = useApp();
  const saved = settingValue<LoyaltySettings>(useSettingRows(), 'loyalty');
  const [f, setF] = useState<LoyaltySettings>(saved);
  useEffect(() => setF(saved), [saved.enabled, saved.pesoPerStamp, saved.stampsForReward, saved.rewardKind, saved.rewardValue]); // eslint-disable-line react-hooks/exhaustive-deps
  const valid = f.pesoPerStamp > 0 && f.stampsForReward >= 1 && f.rewardValue > 0 && (f.rewardKind !== 'percent' || f.rewardValue <= 100);
  const save = async () => {
    await setSetting('loyalty', { ...f, stampsForReward: Math.round(f.stampsForReward) });
    app.toast(f.enabled ? 'Stamp card is on' : 'Stamp card saved (off)', { tone: 'good' });
  };
  return (
    <div className="card pad-lg stack" style={{ maxWidth: 720 }}>
      <Toggle id="ly-on" checked={f.enabled} onChange={(enabled) => setF({ ...f, enabled })} label="Give stamps at the register" />
      <div className="form-grid">
        <Field label="One stamp for every" htmlFor="ly-per" hint="Of what the customer actually pays.">
          <MoneyInput id="ly-per" value={f.pesoPerStamp} onChange={(c) => setF({ ...f, pesoPerStamp: c ?? 0 })} />
        </Field>
        <Field label="Stamps for a reward" htmlFor="ly-n">
          <NumberInput id="ly-n" decimals={false} min={1} value={f.stampsForReward} onChange={(n) => setF({ ...f, stampsForReward: n ?? 1 })} />
        </Field>
        <div className="field">
          <span className="label">Reward</span>
          <Segmented<'amount' | 'percent'>
            label="Reward type"
            full
            value={f.rewardKind}
            onChange={(rewardKind) => setF({ ...f, rewardKind, rewardValue: rewardKind === 'percent' ? 10 : 10000 })}
            options={[
              { value: 'amount', label: 'Pesos off' },
              { value: 'percent', label: 'Percent off' },
            ]}
          />
        </div>
        <Field label={f.rewardKind === 'percent' ? 'Percent off' : 'Pesos off'} htmlFor="ly-value">
          {f.rewardKind === 'percent' ? (
            <NumberInput id="ly-value" value={f.rewardValue} onChange={(n) => setF({ ...f, rewardValue: n ?? 0 })} suffix="%" />
          ) : (
            <MoneyInput id="ly-value" value={f.rewardValue} onChange={(c) => setF({ ...f, rewardValue: c ?? 0 })} />
          )}
        </Field>
      </div>
      <Callout tone="info">
        {valid
          ? `A stamp for every ${peso(f.pesoPerStamp)} spent; ${Math.round(f.stampsForReward)} stamps take ${rewardText(f)} the next purchase.`
          : 'Fill in every box to see how the card works.'}{' '}
        Stamps are counted from each customer&rsquo;s sales, so merging phones never doubles them.
      </Callout>
      <div>
        <Button variant="primary" onClick={save} disabled={!valid}>
          Save
        </Button>
      </div>
    </div>
  );
}
