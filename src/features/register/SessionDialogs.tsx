import { useEffect, useMemo, useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { Button, Callout, Segmented } from '../../components/ui';
import { Field, MoneyInput, NumberInput, TextArea, TextInput } from '../../components/form';
import { peso, sum, type Cents } from '../../lib/money';
import { fmtTime } from '../../lib/time';
import { DENOMINATIONS, countTotal, drawerState } from '../../domain/summary';
import { addCashMove, closeSession } from '../../services/sales';
import { backupBlob, backupFileName, exportAll } from '../../services/backup';
import { downloadBlob, shareBlob, canShareFiles } from '../../lib/files';
import { useApp } from '../../app/AppContext';
import type { Sale, Session } from '../../db/types';

export function CashMoveDialog({ session, open, onClose }: { session: Session; open: boolean; onClose: () => void }) {
  const app = useApp();
  const [kind, setKind] = useState<'in' | 'out'>('out');
  const [amount, setAmount] = useState<Cents | null>(null);
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (open) {
      setAmount(null);
      setReason('');
      setKind('out');
    }
  }, [open]);
  const save = async () => {
    if (!amount || amount <= 0) return;
    await addCashMove(session.id, kind, amount, reason, app.member?.id ?? null);
    app.toast(`${kind === 'in' ? 'Cash in' : 'Cash out'} ${peso(amount)} recorded`, { tone: 'good' });
    onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Cash in or out"
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!amount || amount <= 0} onClick={save}>
            Record
          </Button>
        </>
      }
    >
      <p className="muted small">For cash that isn&rsquo;t a sale: buying water, paying the tricycle, adding coins for change. It keeps the drawer count honest.</p>
      <Segmented label="Direction" full value={kind} onChange={setKind} options={[{ value: 'out', label: 'Cash out' }, { value: 'in', label: 'Cash in' }]} />
      <Field label="Amount" htmlFor="cm-amount">
        <MoneyInput id="cm-amount" value={amount} onChange={setAmount} autoFocus onEnter={save} />
      </Field>
      <Field label="What for" htmlFor="cm-reason">
        <TextInput id="cm-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={kind === 'out' ? 'e.g. Water for the team' : 'e.g. Extra ₱20 coins'} />
      </Field>
    </Dialog>
  );
}

export function CloseRegisterDialog({ session, sales, open, onClose }: { session: Session; sales: Sale[]; open: boolean; onClose: () => void }) {
  const app = useApp();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState('');
  const [done, setDone] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setCounts({});
      setNotes('');
      setDone(null);
    }
  }, [open]);

  const drawer = useMemo(() => drawerState(session, sales), [session, sales]);
  const counted = countTotal(counts);
  const diff = counted - drawer.expected;
  const mine = sales.filter((s) => s.sessionId === session.id && s.status === 'completed');
  const nonCash = useMemo(() => {
    const m = new Map<string, { name: string; amount: Cents; count: number }>();
    for (const s of mine) for (const p of s.payments) if (p.kind !== 'cash') {
      const v = m.get(p.methodId) ?? { name: p.name, amount: 0, count: 0 };
      v.amount += p.amount;
      v.count += 1;
      m.set(p.methodId, v);
    }
    return [...m.values()];
  }, [mine]);

  const close = async () => {
    const ok = await app.confirm({
      title: 'Close the register?',
      message: diff === 0 ? 'The drawer balances.' : `The drawer is ${diff > 0 ? 'over' : 'short'} by ${peso(Math.abs(diff))}. Close anyway? The difference is recorded.`,
      confirmLabel: 'Close register',
    });
    if (!ok) return;
    setBusy(true);
    const s = await closeSession(session.id, counts, notes, app.member?.id ?? null);
    setBusy(false);
    setDone(s ?? null);
  };

  const saveBackup = async (share: boolean) => {
    const file = await exportAll(false);
    const blob = backupBlob(file);
    const name = backupFileName(file, 'backup');
    if (share && (await shareBlob(blob, name, 'JoshWorks POS backup'))) return;
    downloadBlob(blob, name);
    app.toast('Backup file saved to Downloads', { tone: 'good' });
  };

  if (done) {
    return (
      <Dialog open={open} onClose={onClose} title="Register closed" footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
        <Callout tone={diff === 0 ? 'good' : 'warn'} title={diff === 0 ? 'Balanced to the peso' : diff > 0 ? `Over by ${peso(diff)}` : `Short by ${peso(-diff)}`}>
          Expected {peso(drawer.expected)} · counted {peso(counted)}
        </Callout>
        <div className="stack">
          <h3>Save a backup now</h3>
          <p className="muted small">Keeps today&rsquo;s sales safe even if this phone is lost. Send it to your email, Drive or Messenger when you&rsquo;re online.</p>
          <div className="actions">
            {canShareFiles() ? (
              <Button variant="teal" onClick={() => saveBackup(true)}>
                Share backup file
              </Button>
            ) : null}
            <Button onClick={() => saveBackup(false)}>Download backup file</Button>
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Close register ${session.letter}`}
      size="wide"
      fullPhone
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy} onClick={close}>
            Close register
          </Button>
        </>
      }
    >
      <div className="grid-2">
        <div className="stack">
          <h3>Count the cash</h3>
          <div className="denoms">
            {DENOMINATIONS.map((d) => (
              <label key={d.key} className="denom" htmlFor={`den-${d.key}`}>
                <span>{d.label}</span>
                <NumberInput id={`den-${d.key}`} ariaLabel={`Number of ${d.label}`} decimals={false} min={0} value={counts[d.key] ?? null} onChange={(n) => setCounts((c) => ({ ...c, [d.key]: n ?? 0 }))} />
                <span className="num muted">{peso((counts[d.key] ?? 0) * d.value)}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="stack">
          <h3>Drawer</h3>
          <div className="waterfall card">
            <div className="wf-row"><span>Opening float ({fmtTime(session.openedAt)})</span><span className="v">{peso(drawer.opening)}</span></div>
            <div className="wf-row"><span>Cash sales</span><span className="v">{peso(drawer.cashSales)}</span></div>
            {drawer.cashIn ? <div className="wf-row"><span>Cash in</span><span className="v">{peso(drawer.cashIn)}</span></div> : null}
            {drawer.cashOut ? <div className="wf-row"><span>Cash out</span><span className="v">−{peso(drawer.cashOut)}</span></div> : null}
            <div className="wf-row total"><span>Expected in the drawer</span><span className="v">{peso(drawer.expected)}</span></div>
            <div className="wf-row total"><span>Counted</span><span className="v">{peso(counted)}</span></div>
            <div className={`wf-row final`} style={diff === 0 ? undefined : { background: 'var(--warn-soft)', color: 'var(--warn)' }}>
              <span>{diff === 0 ? 'Balanced' : diff > 0 ? 'Over' : 'Short'}</span>
              <span className="v">{peso(Math.abs(diff))}</span>
            </div>
          </div>
          {nonCash.length ? (
            <div className="stack tight">
              <h3>Check your apps</h3>
              <p className="muted small">These should match what arrived in each account today.</p>
              {nonCash.map((n) => (
                <div key={n.name} className="row between small">
                  <span>
                    {n.name} · {n.count} payment{n.count === 1 ? '' : 's'}
                  </span>
                  <b className="num">{peso(n.amount)}</b>
                </div>
              ))}
              <div className="row between small">
                <span>All non-cash</span>
                <b className="num">{peso(sum(nonCash.map((n) => n.amount)))}</b>
              </div>
            </div>
          ) : null}
          <Field label="Notes" htmlFor="close-notes">
            <TextArea id="close-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything to remember about today" />
          </Field>
        </div>
      </div>
    </Dialog>
  );
}
