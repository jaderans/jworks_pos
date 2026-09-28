import { useEffect, useMemo, useState } from 'react';
import { Banknote, Plus, Smartphone, Trash2, Landmark, CreditCard } from 'lucide-react';
import { Dialog } from '../../components/Dialog';
import { Button, Callout, IconButton } from '../../components/ui';
import { Field, MoneyInput, TextInput } from '../../components/form';
import { peso, roundUpTo, sum, type Cents } from '../../lib/money';
import { checkPayments } from '../../domain/cart';
import type { PaymentMethod, SalePayment } from '../../db/types';

const iconFor = (kind: PaymentMethod['kind']) =>
  kind === 'cash' ? <Banknote size={20} /> : kind === 'ewallet' ? <Smartphone size={20} /> : kind === 'bank' ? <Landmark size={20} /> : <CreditCard size={20} />;

interface Row {
  methodId: string;
  amount: Cents | null;
  tendered: Cents | null;
  ref: string;
}

/** Quick cash buttons: exact, then the next round amounts a customer might hand over. */
function quickCash(total: Cents): Cents[] {
  const out = new Set<Cents>([total]);
  for (const step of [20, 50, 100, 500, 1000]) {
    const v = roundUpTo(total, step);
    if (v > total) out.add(v);
  }
  return [...out].sort((a, b) => a - b).slice(0, 5);
}

export function PaymentDialog({
  open,
  onClose,
  total,
  methods,
  onPay,
}: {
  open: boolean;
  onClose: () => void;
  total: Cents;
  methods: PaymentMethod[];
  onPay: (payments: SalePayment[]) => Promise<void>;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [split, setSplit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const byId = useMemo(() => new Map(methods.map((m) => [m.id, m])), [methods]);

  useEffect(() => {
    if (!open) return;
    const cash = methods.find((m) => m.kind === 'cash') ?? methods[0];
    setRows(cash ? [{ methodId: cash.id, amount: total, tendered: null, ref: '' }] : []);
    setSplit(false);
    setError('');
    setBusy(false);
  }, [open, total, methods]);

  const payments: SalePayment[] = rows
    .filter((r) => byId.has(r.methodId))
    .map((r) => {
      const m = byId.get(r.methodId)!;
      const amount = r.amount ?? 0;
      return { methodId: m.id, name: m.name, kind: m.kind, amount, tendered: m.kind === 'cash' ? (r.tendered ?? amount) : null, ref: r.ref };
    });
  const check = checkPayments(total, payments);
  const missingRef = rows.find((r) => byId.get(r.methodId)?.requireRef === 1 && !r.ref.trim());
  const remaining = total - sum(rows.map((r) => r.amount ?? 0));

  const pickSingle = (methodId: string) => {
    setRows([{ methodId, amount: total, tendered: null, ref: '' }]);
    setError('');
  };

  const update = (i: number, changes: Partial<Row>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...changes } : r)));

  const submit = async () => {
    if (!check.ok) {
      setError(check.message);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onPay(payments);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The sale could not be saved.');
      setBusy(false);
    }
  };

  const single = !split && rows.length === 1 ? rows[0] : null;
  const singleMethod = single ? byId.get(single.methodId) : undefined;

  return (
    <Dialog
      open={open}
      onClose={busy ? () => undefined : onClose}
      title={`Charge ${peso(total)}`}
      size="wide"
      fullPhone
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Back to cart
          </Button>
          <Button variant="primary" size="lg" onClick={submit} disabled={busy || !check.ok}>
            {busy ? 'Saving…' : missingRef ? 'Complete without reference' : 'Complete sale'}
          </Button>
        </>
      }
    >
      {methods.length === 0 ? <Callout tone="warn">This event has no payment methods turned on. Add them in Event → Settings.</Callout> : null}

      {!split ? (
        <div className="stack">
          <div className="pay-methods">
            {methods.map((m) => (
              <button key={m.id} type="button" className={`pay-method ${single?.methodId === m.id ? 'on' : ''}`} onClick={() => pickSingle(m.id)} aria-pressed={single?.methodId === m.id}>
                {iconFor(m.kind)}
                <span>{m.name}</span>
              </button>
            ))}
          </div>

          {single && singleMethod?.kind === 'cash' ? (
            <div className="stack">
              <Field label="Cash received" htmlFor="cash-in">
                <MoneyInput id="cash-in" large value={single.tendered ?? null} onChange={(c) => update(0, { tendered: c })} placeholder={String(total / 100)} onEnter={submit} autoFocus />
              </Field>
              <div className="chip-row">
                {quickCash(total).map((v) => (
                  <button key={v} type="button" className={`chip ${single.tendered === v ? 'on' : ''}`} onClick={() => update(0, { tendered: v })}>
                    {v === total ? `Exact ${peso(v)}` : peso(v)}
                  </button>
                ))}
              </div>
              <div className="change-box" aria-live="polite">
                <span>Change</span>
                <b>{single.tendered !== null && single.tendered < total ? '—' : peso(Math.max(0, (single.tendered ?? total) - total))}</b>
              </div>
              {single.tendered !== null && single.tendered < total ? <p className="bad small strong">Cash received is less than {peso(total)}.</p> : null}
            </div>
          ) : null}

          {single && singleMethod && singleMethod.kind !== 'cash' ? (
            <div className="ewallet">
              {singleMethod.qr ? <img src={singleMethod.qr} alt={`${singleMethod.name} QR code`} className="qr-img" /> : null}
              <div className="stack">
                <div>
                  <span className="eyebrow">Pay {peso(total)} to</span>
                  <h2>{singleMethod.accountName || singleMethod.name}</h2>
                  {singleMethod.accountNumber ? <p className="mono">{singleMethod.accountNumber}</p> : null}
                  {!singleMethod.qr ? <p className="muted small">Tip: add your {singleMethod.name} QR image in Settings → Payment methods so customers can scan it here.</p> : null}
                </div>
                <Field label="Reference number" htmlFor="ref" hint={singleMethod.requireRef ? 'From the customer’s confirmation screen. Check it before you hand over the items.' : 'Optional'}>
                  <TextInput id="ref" value={single.ref} onChange={(e) => update(0, { ref: e.target.value })} inputMode="numeric" autoComplete="off" autoFocus placeholder="e.g. 1012 345 678901" />
                </Field>
              </div>
            </div>
          ) : null}

          <Button
            variant="link"
            onClick={() => {
              setSplit(true);
              setRows((rs) => rs.map((r) => ({ ...r, amount: r.amount })));
            }}
          >
            Split between payment methods
          </Button>
        </div>
      ) : (
        <div className="stack">
          <p className="muted">Split {peso(total)} across methods. Each row takes part of the total.</p>
          {rows.map((r, i) => {
            const m = byId.get(r.methodId);
            return (
              <div key={i} className="card" style={{ gap: 8 }}>
                <div className="row wrap">
                  <select className="select" style={{ width: 'auto', flex: 1, minWidth: 140 }} aria-label="Payment method" value={r.methodId} onChange={(e) => update(i, { methodId: e.target.value })}>
                    {methods.map((mm) => (
                      <option key={mm.id} value={mm.id}>
                        {mm.name}
                      </option>
                    ))}
                  </select>
                  <div style={{ width: 160 }}>
                    <MoneyInput ariaLabel="Amount" value={r.amount} onChange={(c) => update(i, { amount: c })} />
                  </div>
                  <IconButton label="Remove this payment" disabled={rows.length <= 1} onClick={() => setRows((rs) => rs.filter((_, k) => k !== i))}>
                    <Trash2 size={18} />
                  </IconButton>
                </div>
                {m?.kind === 'cash' ? (
                  <div className="row wrap">
                    <span className="small muted">Cash received</span>
                    <div style={{ width: 160 }}>
                      <MoneyInput ariaLabel="Cash received" value={r.tendered} onChange={(c) => update(i, { tendered: c })} placeholder={String((r.amount ?? 0) / 100)} />
                    </div>
                    <span className="small">Change {peso(Math.max(0, (r.tendered ?? r.amount ?? 0) - (r.amount ?? 0)))}</span>
                  </div>
                ) : (
                  <TextInput aria-label="Reference number" placeholder={m?.requireRef ? 'Reference number' : 'Reference number (optional)'} value={r.ref} onChange={(e) => update(i, { ref: e.target.value })} />
                )}
              </div>
            );
          })}
          <div className="row between wrap">
            <Button
              size="sm"
              onClick={() => {
                const next = methods.find((m) => !rows.some((r) => r.methodId === m.id)) ?? methods[0];
                if (next) setRows((rs) => [...rs, { methodId: next.id, amount: Math.max(0, remaining), tendered: null, ref: '' }]);
              }}
            >
              <Plus size={16} /> Add a method
            </Button>
            <span className={`strong ${remaining === 0 ? 'good' : 'warn'}`}>{remaining === 0 ? 'Fully covered' : remaining > 0 ? `${peso(remaining)} still to cover` : `${peso(-remaining)} too much`}</span>
          </div>
          <Button variant="link" onClick={() => pickSingle(rows[0]?.methodId ?? methods[0]?.id)}>
            Back to a single payment
          </Button>
        </div>
      )}

      {error ? <Callout tone="bad">{error}</Callout> : null}
    </Dialog>
  );
}
