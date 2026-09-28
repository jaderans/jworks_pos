import { useEffect, useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { Button, Callout } from '../../components/ui';
import { Check, Field, MoneyInput, TextArea, TextInput } from '../../components/form';
import { usePaymentMethods } from '../../hooks/data';
import { createEvent, duplicateEvent, newEventFields, updateEvent } from '../../services/events';
import { saveSpend } from '../../services/spend';
import { toCents, type Cents } from '../../lib/money';
import { todayISO } from '../../lib/time';
import type { JWEvent } from '../../db/types';

interface FormState {
  name: string;
  organizer: string;
  venue: string;
  boothNo: string;
  startDate: string;
  endDate: string;
  openingFloat: Cents | null;
  paymentMethodIds: string[];
  notes: string;
  boothFee: Cents | null;
}

/** Create or edit an event's details. */
export function EventFormDialog({ open, onClose, event, onSaved }: { open: boolean; onClose: () => void; event?: JWEvent | null; onSaved?: (ev: JWEvent) => void }) {
  const methods = usePaymentMethods();
  const [f, setF] = useState<FormState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError('');
    (async () => {
      if (event) {
        setF({ name: event.name, organizer: event.organizer, venue: event.venue, boothNo: event.boothNo, startDate: event.startDate, endDate: event.endDate, openingFloat: event.openingFloat, paymentMethodIds: event.paymentMethodIds, notes: event.notes, boothFee: null });
      } else {
        const base = await newEventFields();
        setF({ name: '', organizer: '', venue: '', boothNo: '', startDate: base.startDate, endDate: base.endDate, openingFloat: base.openingFloat, paymentMethodIds: base.paymentMethodIds, notes: '', boothFee: null });
      }
    })();
  }, [open, event]);

  if (!f) return null;
  const set = (changes: Partial<FormState>) => setF({ ...f, ...changes });
  const active = (methods ?? []).filter((m) => m.active === 1);

  const save = async () => {
    if (!f.name.trim()) {
      setError('Give the event a name.');
      return;
    }
    if (f.endDate && f.startDate && f.endDate < f.startDate) {
      setError('The last day is before the first day.');
      return;
    }
    setBusy(true);
    try {
      const fields = {
        name: f.name.trim(),
        organizer: f.organizer.trim(),
        venue: f.venue.trim(),
        boothNo: f.boothNo.trim(),
        startDate: f.startDate,
        endDate: f.endDate || f.startDate,
        openingFloat: f.openingFloat ?? 0,
        paymentMethodIds: f.paymentMethodIds,
        notes: f.notes,
      };
      let ev: JWEvent;
      if (event) {
        await updateEvent(event.id, fields);
        ev = { ...event, ...fields };
      } else {
        ev = await createEvent(fields);
        if (f.boothFee && f.boothFee > 0) {
          await saveSpend({ eventId: ev.id, type: 'booth_fee', name: 'Booth fee', qty: 1, unitCost: f.boothFee, status: 'bought' });
        }
      }
      onSaved?.(ev);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the event.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={event ? 'Event details' : 'New event'}
      size="wide"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy} onClick={save}>
            {event ? 'Save' : 'Create event'}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Event name" htmlFor="ev-name" className="span-2">
          <TextInput id="ev-name" value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Komiket Iloilo 2026" autoFocus />
        </Field>
        <Field label="Organizer" htmlFor="ev-org">
          <TextInput id="ev-org" value={f.organizer} onChange={(e) => set({ organizer: e.target.value })} />
        </Field>
        <Field label="Venue" htmlFor="ev-venue">
          <TextInput id="ev-venue" value={f.venue} onChange={(e) => set({ venue: e.target.value })} />
        </Field>
        <Field label="First day" htmlFor="ev-start">
          <TextInput id="ev-start" type="date" value={f.startDate} onChange={(e) => set({ startDate: e.target.value, endDate: f.endDate < e.target.value ? e.target.value : f.endDate })} />
        </Field>
        <Field label="Last day" htmlFor="ev-end">
          <TextInput id="ev-end" type="date" value={f.endDate} min={f.startDate} onChange={(e) => set({ endDate: e.target.value })} />
        </Field>
        <Field label="Booth number" htmlFor="ev-booth">
          <TextInput id="ev-booth" value={f.boothNo} onChange={(e) => set({ boothNo: e.target.value })} />
        </Field>
        <Field label="Opening cash float" htmlFor="ev-float" hint="Change you bring for the drawer each day.">
          <MoneyInput id="ev-float" value={f.openingFloat} onChange={(c) => set({ openingFloat: c })} />
        </Field>
        {!event ? (
          <Field label="Booth fee (optional)" htmlFor="ev-fee" hint="Added to Booth Spend as paid. Leave blank if free.">
            <MoneyInput id="ev-fee" value={f.boothFee} onChange={(c) => set({ boothFee: c })} />
          </Field>
        ) : null}
      </div>
      <div className="field">
        <span className="label">Payment methods at this event</span>
        <div className="chip-row">
          {active.map((m) => {
            const on = f.paymentMethodIds.includes(m.id);
            return (
              <button
                key={m.id}
                type="button"
                className="chip"
                aria-pressed={on}
                onClick={() => set({ paymentMethodIds: on ? f.paymentMethodIds.filter((x) => x !== m.id) : [...f.paymentMethodIds, m.id] })}
              >
                {m.name}
              </button>
            );
          })}
        </div>
      </div>
      <Field label="Notes" htmlFor="ev-notes">
        <TextArea id="ev-notes" rows={2} value={f.notes} onChange={(e) => set({ notes: e.target.value })} />
      </Field>
      {error ? <Callout tone="bad">{error}</Callout> : null}
    </Dialog>
  );
}

export function DuplicateEventDialog({ source, onClose, onDone }: { source: JWEvent | null; onClose: () => void; onDone: (ev: JWEvent) => void }) {
  const [name, setName] = useState('');
  const [start, setStart] = useState(todayISO());
  const [end, setEnd] = useState(todayISO());
  const [opts, setOpts] = useState({ copyPrices: true, copyStock: false, copyRoster: true, copyDeals: true, copyBundles: true });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (source) {
      setName(`${source.name} (copy)`);
      setStart(todayISO());
      setEnd(todayISO());
    }
  }, [source]);
  if (!source) return null;
  const go = async () => {
    setBusy(true);
    const ev = await duplicateEvent(source.id, { name, startDate: start, endDate: end < start ? start : end, ...opts });
    setBusy(false);
    onDone(ev);
    onClose();
  };
  return (
    <Dialog
      open={!!source}
      onClose={onClose}
      title={`New event from ${source.name}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy || !name.trim()} onClick={go}>
            Create event
          </Button>
        </>
      }
    >
      <p className="muted small">Settings, payment methods and discounts carry over. Sales, booth spend and payouts start fresh.</p>
      <Field label="Name" htmlFor="dup-name">
        <TextInput id="dup-name" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="form-grid">
        <Field label="First day" htmlFor="dup-start">
          <TextInput id="dup-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="Last day" htmlFor="dup-end">
          <TextInput id="dup-end" type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
        </Field>
      </div>
      <div className="stack tight">
        <Check id="dup-prices" checked={opts.copyPrices} onChange={(v) => setOpts({ ...opts, copyPrices: v })} label="Event prices" />
        <Check id="dup-stock" checked={opts.copyStock} onChange={(v) => setOpts({ ...opts, copyStock: v })} label="Stock brought counts" />
        <Check id="dup-roster" checked={opts.copyRoster} onChange={(v) => setOpts({ ...opts, copyRoster: v })} label="Team roster and role weights" />
        <Check id="dup-deals" checked={opts.copyDeals} onChange={(v) => setOpts({ ...opts, copyDeals: v })} label="Partner deals" />
        <Check id="dup-bundles" checked={opts.copyBundles} onChange={(v) => setOpts({ ...opts, copyBundles: v })} label="Event-only bundle deals" />
      </div>
    </Dialog>
  );
}

export const DEFAULT_FLOAT = toCents(2000);
