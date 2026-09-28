import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { usePaymentMethods } from '../../hooks/data';
import { Badge, Button, IconButton, Segmented, Toggle } from '../../components/ui';
import { Field, MoneyInput, NumberInput, TextInput } from '../../components/form';
import { EventFormDialog } from '../events/EventFormDialog';
import { deleteEvent, EVENT_STATUS_LABEL, updateEvent } from '../../services/events';
import { peso } from '../../lib/money';
import { fmtDateRange } from '../../lib/time';
import { uid } from '../../lib/ids';
import type { DiscountPreset, EventStatus, JWEvent } from '../../db/types';

export default function EventSettingsTab({ ev }: { ev: JWEvent }) {
  const app = useApp();
  const navigate = useNavigate();
  const methods = usePaymentMethods();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<DiscountPreset>({ id: '', label: '', kind: 'amount', value: 0, needsPin: false });

  const toggleMethod = (id: string) => {
    const on = ev.paymentMethodIds.includes(id);
    void updateEvent(ev.id, { paymentMethodIds: on ? ev.paymentMethodIds.filter((x) => x !== id) : [...ev.paymentMethodIds, id] });
  };

  const addDiscount = async () => {
    if (!draft.label.trim() || draft.value <= 0) return;
    await updateEvent(ev.id, { discounts: [...ev.discounts, { ...draft, id: uid(), label: draft.label.trim() }] });
    setDraft({ id: '', label: '', kind: 'amount', value: 0, needsPin: false });
  };

  return (
    <div className="stack loose">
      <div className="card">
        <div className="card-head">
          <h2>Details</h2>
          <Button size="sm" onClick={() => setEditing(true)}>
            <Pencil size={16} /> Edit
          </Button>
        </div>
        <div className="grid-2 small">
          <div>
            <span className="eyebrow">Dates</span>
            <p>{fmtDateRange(ev.startDate, ev.endDate)}</p>
          </div>
          <div>
            <span className="eyebrow">Venue · booth</span>
            <p>{[ev.venue, ev.boothNo && `Booth ${ev.boothNo}`].filter(Boolean).join(' · ') || '—'}</p>
          </div>
          <div>
            <span className="eyebrow">Organizer</span>
            <p>{ev.organizer || '—'}</p>
          </div>
          <div>
            <span className="eyebrow">Opening float</span>
            <p>{peso(ev.openingFloat)}</p>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Status</h2>
        <Segmented<EventStatus>
          label="Event status"
          value={ev.status}
          onChange={(v) => updateEvent(ev.id, { status: v })}
          options={(['planning', 'live', 'closed', 'reported'] as EventStatus[]).map((s) => ({ value: s, label: EVENT_STATUS_LABEL[s] }))}
        />
        <p className="sub">Planning: getting ready. Live: selling. Closed: no more sales. Reported: done and filed.</p>
      </div>

      <div className="card">
        <h2>Payment methods</h2>
        <p className="sub">Only these show on the pay screen at this event. Add QR codes and new methods in Settings.</p>
        <div className="chip-row">
          {(methods ?? [])
            .filter((m) => m.active === 1)
            .map((m) => (
              <button key={m.id} type="button" className="chip" aria-pressed={ev.paymentMethodIds.includes(m.id)} onClick={() => toggleMethod(m.id)}>
                {m.name}
              </button>
            ))}
        </div>
      </div>

      <div className="card">
        <h2>Discounts at this event</h2>
        <p className="sub">One-tap discounts on the register, like a passport or org promo.</p>
        {ev.discounts.length ? (
          <div className="stack tight">
            {ev.discounts.map((dd) => (
              <div key={dd.id} className="row between">
                <span>
                  <b>{dd.label}</b> · {dd.kind === 'amount' ? `${peso(dd.value)} off` : `${dd.value}% off`} {dd.needsPin ? <Badge tone="warn">Owner PIN</Badge> : null}
                </span>
                <IconButton label={`Remove ${dd.label}`} size="sm" onClick={() => updateEvent(ev.id, { discounts: ev.discounts.filter((x) => x.id !== dd.id) })}>
                  <Trash2 size={16} />
                </IconButton>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted small">No preset discounts.</p>
        )}
        <div className="row wrap" style={{ alignItems: 'flex-end' }}>
          <Field label="Label" htmlFor="dp-label">
            <TextInput id="dp-label" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="e.g. Passport" />
          </Field>
          <Segmented label="Kind" value={draft.kind} onChange={(v) => setDraft({ ...draft, kind: v, value: 0 })} options={[{ value: 'amount', label: '₱ off' }, { value: 'percent', label: '% off' }]} />
          <div style={{ width: 130 }}>
            {draft.kind === 'amount' ? (
              <MoneyInput ariaLabel="Amount off" value={draft.value || null} onChange={(c) => setDraft({ ...draft, value: c ?? 0 })} />
            ) : (
              <NumberInput ariaLabel="Percent off" value={draft.value || null} onChange={(n) => setDraft({ ...draft, value: n ?? 0 })} suffix="%" />
            )}
          </div>
          <Toggle id="dp-pin" checked={draft.needsPin} onChange={(v) => setDraft({ ...draft, needsPin: v })} label="Needs PIN" />
          <Button onClick={addDiscount} disabled={!draft.label.trim() || draft.value <= 0}>
            <Plus size={16} /> Add
          </Button>
        </div>
        <Field label="Cashier discount limit" htmlFor="limit" hint="Typed discounts above this % of a sale need the owner PIN.">
          <div style={{ maxWidth: 160 }}>
            <NumberInput id="limit" value={ev.cashierDiscountLimitPct} onChange={(n) => updateEvent(ev.id, { cashierDiscountLimitPct: Math.max(0, Math.min(100, n ?? 0)) })} suffix="%" />
          </div>
        </Field>
      </div>

      <div className="card">
        <h2>Targets</h2>
        <div className="form-grid">
          <Field label="Sales target" htmlFor="t-sales">
            <MoneyInput id="t-sales" value={ev.targets.sales} onChange={(c) => updateEvent(ev.id, { targets: { ...ev.targets, sales: c } })} placeholder="None" />
          </Field>
          <Field label="Contacts to capture" htmlFor="t-leads">
            <NumberInput id="t-leads" decimals={false} value={ev.targets.leads} onChange={(n) => updateEvent(ev.id, { targets: { ...ev.targets, leads: n } })} placeholder="None" />
          </Field>
        </div>
      </div>

      <div className="card">
        <h2>Delete</h2>
        <p className="sub">Only events without sales can be deleted. Close finished events instead so their records stay.</p>
        <div>
          <Button
            variant="danger"
            onClick={async () => {
              if (!(await app.confirm({ title: `Delete ${ev.name}?`, confirmLabel: 'Delete', tone: 'danger' }))) return;
              try {
                await deleteEvent(ev.id);
                app.setActiveEventId(null);
                navigate('/events');
              } catch (e) {
                app.toast(e instanceof Error ? e.message : 'Could not delete', { tone: 'bad' });
              }
            }}
          >
            <Trash2 size={16} /> Delete event
          </Button>
        </div>
      </div>
      <EventFormDialog open={editing} event={ev} onClose={() => setEditing(false)} />
    </div>
  );
}
