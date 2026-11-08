import { useEffect, useMemo, useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { Button, Callout, Segmented } from '../../components/ui';
import { Field, MoneyInput, NumberInput, Select, TextArea, TextInput } from '../../components/form';
import { peso, sum, type Cents } from '../../lib/money';
import { isoDate, fmtTime } from '../../lib/time';
import { DENOMINATIONS, countTotal, drawerState, moveMethod } from '../../domain/summary';
import { addCashMove, closeSession, removeCashMove, updateCashMove } from '../../services/sales';
import { useEvent, usePaymentMethods } from '../../hooks/data';
import { backupBlob, backupFileName, exportAll } from '../../services/backup';
import { downloadBlob, shareBlob, canShareFiles } from '../../lib/files';
import { useApp } from '../../app/AppContext';
import type { CashMove, Sale, Session } from '../../db/types';

/**
 * Money in or out of a register that isn't a sale, in cash or GCash and the
 * like. Pass a move to fix one recorded wrong, or to remove it.
 */
export function CashMoveDialog({ session, move, open, onClose }: { session: Session; move?: CashMove | null; open: boolean; onClose: () => void }) {
  const app = useApp();
  const methods = usePaymentMethods();
  const ev = useEvent(session.eventId);
  const [kind, setKind] = useState<'in' | 'out'>('out');
  const [amount, setAmount] = useState<Cents | null>(null);
  const [reason, setReason] = useState('');
  const [methodId, setMethodId] = useState('cash');
  const [error, setError] = useState('');
  useEffect(() => {
    if (open) {
      setAmount(move?.amount ?? null);
      setReason(move?.reason ?? '');
      setKind(move?.kind ?? 'out');
      setMethodId(move && moveMethod(move).kind !== 'cash' ? moveMethod(move).id : 'cash');
      setError('');
    }
  }, [open, move]);
  // The drawer's cash, then the event's other payment methods (GCash and the like).
  const others = (methods ?? []).filter((m) => m.kind !== 'cash' && m.active === 1 && m.deleted !== 1 && (!ev || ev.paymentMethodIds.includes(m.id) || m.id === methodId));
  const how = (): CashMove['method'] => {
    const m = others.find((x) => x.id === methodId);
    return m ? { id: m.id, name: m.name, kind: m.kind } : undefined;
  };
  const save = async () => {
    if (!amount || amount <= 0) return;
    const method = how();
    try {
      if (move) await updateCashMove(session.id, move.id, { kind, amount, reason, method });
      else await addCashMove(session.id, kind, amount, reason, app.member?.id ?? null, method);
      app.toast(`${kind === 'in' ? 'In' : 'Out'} ${peso(amount)} (${method?.name ?? 'Cash'}) ${move ? 'saved' : 'recorded'}`, { tone: 'good' });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t save it');
    }
  };
  const remove = async () => {
    if (!move || !(await app.confirm({ title: 'Remove this cash move?', message: `${move.kind === 'in' ? 'In' : 'Out'} ${peso(move.amount)} (${moveMethod(move).name}) comes off register ${session.letter}.`, confirmLabel: 'Remove', tone: 'danger' }))) return;
    await removeCashMove(session.id, move.id);
    app.toast('Cash move removed', { tone: 'good' });
    onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={move ? `Cash move on register ${session.letter}` : 'Cash in or out'}
      size="sm"
      footer={
        <>
          {move ? (
            <Button variant="danger" onClick={remove}>
              Remove
            </Button>
          ) : null}
          <span className="grow" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!amount || amount <= 0} onClick={save}>
            {move ? 'Save' : 'Record'}
          </Button>
        </>
      }
    >
      <p className="muted small">For money that isn&rsquo;t a sale: buying water, paying the tricycle, adding coins for change, or a GCash cash-in or cash-out. Only cash changes the drawer count.</p>
      <Segmented label="Direction" full value={kind} onChange={setKind} options={[{ value: 'out', label: 'Out' }, { value: 'in', label: 'In' }]} />
      <Field label="Money" htmlFor="cm-method" hint={methodId === 'cash' ? 'The drawer’s cash.' : 'Not the drawer: it changes the GCash (or bank) total.'}>
        <Select id="cm-method" value={methodId} onChange={(e) => setMethodId(e.target.value)}>
          <option value="cash">Cash</option>
          {others.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Amount" htmlFor="cm-amount">
        <MoneyInput id="cm-amount" value={amount} onChange={setAmount} autoFocus onEnter={save} />
      </Field>
      <Field label="What for" htmlFor="cm-reason">
        <TextInput id="cm-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={kind === 'out' ? 'e.g. Water for the team' : 'e.g. Extra ₱20 coins'} />
      </Field>
      {error ? <Callout tone="bad">{error}</Callout> : null}
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
    // Closing the register sends the end-of-day summary (sales, registers, inventory) to the owner's email.
    if (s)
      void import('../../email/automation')
        .then((m) => m.queueDaySummary(s.eventId, isoDate(s.openedAt), 'closed'))
        .then((r) => {
          if (r.queued) app.toast('The end-of-day summary is on its way to your email.', { tone: 'good' });
        })
        .catch(() => undefined);
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
