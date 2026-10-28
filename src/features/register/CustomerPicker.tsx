import { useEffect, useMemo, useState } from 'react';
import { UserPlus } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { useCustomerSales, useCustomers, useSettingRows } from '../../hooks/data';
import { settingValue } from '../../db/settings';
import { Dialog } from '../../components/Dialog';
import { Button, Callout, Initials } from '../../components/ui';
import { Check, Field, SearchInput, TextInput } from '../../components/form';
import { loyaltyState } from '../../domain/loyalty';
import { saveCustomer } from '../../services/customers';
import type { Customer, LoyaltySettings } from '../../db/types';

const blank = { name: '', phone: '', email: '', handle: '', marketingOk: false };

/** Pick who this sale is for, or add them in a few taps. */
export function CustomerPicker({ open, onClose, onPick, eventId }: { open: boolean; onClose: () => void; onPick: (c: Customer) => void; eventId: string | null }) {
  const app = useApp();
  const customers = useCustomers();
  const sales = useCustomerSales();
  const rules = settingValue<LoyaltySettings>(useSettingRows(), 'loyalty');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState(blank);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQ('');
    setAdding(false);
    setF(blank);
    setError('');
  }, [open]);

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const digits = needle.replace(/\D/g, '');
    const all = customers ?? [];
    if (!needle) return all.slice(0, 8);
    return all
      .filter(
        (c) =>
          c.name.toLowerCase().includes(needle) ||
          c.email.includes(needle) ||
          c.handle.toLowerCase().includes(needle.replace(/^@/, '')) ||
          (digits.length >= 3 && c.phone.replace(/\D/g, '').includes(digits)),
      )
      .slice(0, 12);
  }, [customers, q]);

  const startAdding = () => {
    const typed = q.trim();
    const isPhone = /^[\d+\s-]{7,}$/.test(typed);
    const isEmail = typed.includes('@') && !typed.startsWith('@');
    setF({ ...blank, name: isPhone || isEmail ? '' : typed.replace(/^@/, ''), phone: isPhone ? typed : '', email: isEmail ? typed : '' });
    setAdding(true);
    setError('');
  };

  const add = async () => {
    setBusy(true);
    setError('');
    try {
      const c = await saveCustomer({ ...f, marketingOk: f.marketingOk ? 1 : 0, firstEventId: eventId });
      app.toast(`Added ${c.name}`, { tone: 'good' });
      onPick(c);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the customer.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={adding ? 'New customer' : 'Who is this sale for?'}
      footer={
        adding ? (
          <>
            <Button onClick={() => setAdding(false)}>Back</Button>
            <Button variant="primary" onClick={add} disabled={busy || !f.name.trim()}>
              Add and use
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={startAdding}>
              <UserPlus size={16} /> New customer
            </Button>
          </>
        )
      }
    >
      {adding ? (
        <div className="stack">
          <div className="form-grid">
            <Field label="Name" htmlFor="cu-name" className="span-2">
              <TextInput id="cu-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus />
            </Field>
            <Field label="Mobile number" htmlFor="cu-phone">
              <TextInput id="cu-phone" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="0917…" />
            </Field>
            <Field label="Email" htmlFor="cu-email" hint="For emailed receipts.">
              <TextInput id="cu-email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
            </Field>
            <Field label="Instagram / Facebook / TikTok" htmlFor="cu-handle" className="span-2">
              <TextInput id="cu-handle" value={f.handle} onChange={(e) => setF({ ...f, handle: e.target.value })} placeholder="@handle" />
            </Field>
          </div>
          <Check
            id="cu-consent"
            checked={f.marketingOk}
            onChange={(v) => setF({ ...f, marketingOk: v })}
            label="They agreed to hear about new drops and events"
            sub="Ask first. Without this, their details are used only for receipts, stamps and orders."
          />
          {error ? <Callout tone="bad">{error}</Callout> : null}
        </div>
      ) : (
        <div className="stack">
          <SearchInput value={q} onChange={setQ} placeholder="Name, mobile, email or @handle" ariaLabel="Search customers" />
          {matches.length === 0 ? (
            <p className="muted small">{q.trim() ? 'No one matches. Add them as a new customer.' : 'No customers yet. Add the first one.'}</p>
          ) : (
            <div className="card flush">
              <div className="list">
                {matches.map((c) => {
                  const st = rules.enabled ? loyaltyState(c.id, sales ?? [], rules) : null;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      className="list-item click"
                      style={{ border: 0, borderBottom: '1px solid var(--line)', background: 'none', textAlign: 'left', width: '100%' }}
                      onClick={() => onPick(c)}
                    >
                      <Initials name={c.name} />
                      <span className="main-text">
                        <b>{c.name}</b>
                        <span>{[c.phone, c.handle, c.email].filter(Boolean).join(' · ') || 'No contact details'}</span>
                      </span>
                      {st ? (
                        <span className="badge teal">
                          {st.balance} stamp{st.balance === 1 ? '' : 's'}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
