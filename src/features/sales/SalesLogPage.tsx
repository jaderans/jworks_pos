import { useEffect, useMemo, useState } from 'react';
import { ArrowDownUp, Mail, ReceiptText } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { useApp } from '../../app/AppContext';
import { useMembers, usePaymentMethods, useSales, useSessions, useSettingRows } from '../../hooks/data';
import { settingValue } from '../../db/settings';
import { Dialog } from '../../components/Dialog';
import { Badge, Button, Callout, EmptyState, Loading, PageHeader } from '../../components/ui';
import { Field, SearchInput, Select, TextArea } from '../../components/form';
import { peso } from '../../lib/money';
import { fmtDateTime, fmtTime } from '../../lib/time';
import { changeSalePayments, voidSale } from '../../services/sales';
import { moneyIn, moveMethod } from '../../domain/summary';
import { ReceiptDialog } from '../register/ReceiptDialog';
import { CashMoveDialog } from '../register/SessionDialogs';
import type { BusinessSettings, CashMove, Sale, SalePayment, Session } from '../../db/types';
import './sales.css';

type Row = { type: 'sale'; at: number; sale: Sale } | { type: 'move'; at: number; move: CashMove; session: Session };

export default function SalesLogPage() {
  const app = useApp();
  const ev = app.activeEvent;
  const sales = useSales(ev?.id);
  const sessions = useSessions(ev?.id);
  const members = useMembers();
  const methods = usePaymentMethods();
  const settingRows = useSettingRows();
  const business = settingValue<BusinessSettings>(settingRows, 'business');
  const [q, setQ] = useState('');
  const [method, setMethod] = useState('all');
  const [status, setStatus] = useState<'all' | 'completed' | 'voided' | 'moves'>('all');
  const [register, setRegister] = useState('all');
  const [open, setOpen] = useState<Sale | null>(null);
  const [fixing, setFixing] = useState<{ move: CashMove; session: Session } | null>(null);
  const [receipt, setReceipt] = useState<Sale | null>(null);
  // Emailed receipts on this device: the latest status per sale.
  const emailed = useLiveQuery(async () => {
    const rows = await db.outbox.where('saleId').above('').toArray();
    return new Map(rows.sort((a, b) => a.at - b.at).map((o) => [o.saleId, o]));
  }, []);

  const memberName = useMemo(() => new Map((members ?? []).map((m) => [m.id, m.name])), [members]);
  // One register letter can have several sessions (opened and closed again).
  const letters = useMemo(() => [...new Set((sessions ?? []).map((x) => x.letter))].sort(), [sessions]);
  const regSessions = useMemo(() => (sessions ?? []).filter((x) => register === 'all' || x.letter === register), [sessions, register]);
  const regSales = useMemo(() => {
    const ids = new Set(regSessions.map((x) => x.id));
    return (sales ?? []).filter((x) => register === 'all' || ids.has(x.sessionId));
  }, [sales, regSessions, register]);
  const money = useMemo(() => moneyIn(regSales, regSessions), [regSales, regSessions]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const cashMethod = (methods ?? []).find((m) => m.id === method)?.kind === 'cash';
    const saleRows: Row[] = regSales
      .filter(
        (s) =>
          status !== 'moves' &&
          (status === 'all' || s.status === status) &&
          (method === 'all' || s.payments.some((p) => p.methodId === method)) &&
          (!needle ||
            s.receiptNo.toLowerCase().includes(needle) ||
            s.lines.some((l) => l.name.toLowerCase().includes(needle)) ||
            s.payments.some((p) => p.ref.toLowerCase().includes(needle)) ||
            s.note.toLowerCase().includes(needle)),
      )
      .map((sale) => ({ type: 'sale', at: sale.at, sale }));
    const moveRows: Row[] =
      status === 'all' || status === 'moves'
        ? regSessions.flatMap((session) =>
            (session.cashMoves ?? [])
              .filter((m) => method === 'all' || (moveMethod(m).kind === 'cash' ? cashMethod : moveMethod(m).id === method))
              .filter((m) => !needle || m.reason.toLowerCase().includes(needle) || moveMethod(m).name.toLowerCase().includes(needle))
              .map((move) => ({ type: 'move' as const, at: move.at, move, session })),
          )
        : [];
    return [...saleRows, ...moveRows].sort((a, b) => b.at - a.at);
  }, [regSales, regSessions, q, method, status, methods]);

  if (!ev) return <div className="page"><EmptyState title="Pick an event">Sales are listed per event. Choose one from the top bar.</EmptyState></div>;
  if (!sales || !sessions) return <Loading />;
  const counted = regSales.filter((s) => s.status === 'completed' && s.deleted !== 1 && !s.kind).length;

  /** Fixing a move: the owner, on the phone running that register (or once it's closed), so two phones never write it at once. */
  const fixMove = async (move: CashMove, session: Session) => {
    if (session.closedAt === null && session.deviceId !== app.device.deviceId) {
      app.toast(`Register ${session.letter} is still open on another phone. Fix the move there, or after it’s closed.`, { tone: 'bad' });
      return;
    }
    if (!(await app.askOwner(`Change a cash move on register ${session.letter}`))) return;
    setFixing({ move, session });
  };

  return (
    <div className="page">
      <PageHeader eyebrow={ev.name} title="Sales log" subtitle={`${counted} sale${counted === 1 ? '' : 's'}, with order deposits, services and cash in and out. Each sale keeps the price it was sold at.`} />
      <section className="card money-panel" aria-label="Money in">
        <div className="money-head">
          <span className="eyebrow">Money in{register === 'all' ? '' : ` · register ${register}`}</span>
          <b className="money-total num">{peso(money.total)}</b>
        </div>
        <div className="money-methods">
          {money.methods.map((l) => (
            <div key={l.key} className="money-method">
              <span className="name">{l.name}</span>
              <b className="num">{peso(l.amount)}</b>
              {l.moves ? (
                <span className="muted tiny">
                  {peso(l.taken)} taken {l.moves > 0 ? '+' : '−'} {peso(Math.abs(l.moves))} in/out
                </span>
              ) : null}
            </div>
          ))}
          {money.methods.length === 0 ? <p className="muted small">Nothing yet.</p> : null}
        </div>
        <div className="money-parts">
          <span>
            Booth sales <b className="num">{peso(money.sales)}</b>
          </span>
          {money.deposits ? (
            <span>
              Order deposits <b className="num">{peso(money.deposits)}</b>
            </span>
          ) : null}
          {money.depositsApplied ? (
            <span>
              Deposits already counted, used at pickup <b className="num">−{peso(money.depositsApplied)}</b>
            </span>
          ) : null}
          {money.services ? (
            <span>
              Services <b className="num">{peso(money.services)}</b>
            </span>
          ) : null}
          {money.movesIn || money.movesOut ? (
            <span>
              Cash in and out{' '}
              <b className="num">
                {money.movesIn - money.movesOut < 0 ? '−' : '+'}
                {peso(Math.abs(money.movesIn - money.movesOut))}
              </b>
            </span>
          ) : null}
        </div>
        {money.openRegisters ? (
          <p className="muted small">
            {money.openRegisters === 1 ? 'The open drawer' : `The ${money.openRegisters} open drawers`} should hold <b>{peso(money.drawers)}</b> in cash now, floats included.
          </p>
        ) : null}
      </section>
      <div className="row wrap">
        <div className="grow" style={{ minWidth: 220 }}>
          <SearchInput value={q} onChange={setQ} placeholder="Receipt no., product, reference or note" />
        </div>
        <Select aria-label="Payment method" value={method} onChange={(e) => setMethod(e.target.value)} style={{ width: 'auto' }}>
          <option value="all">All payments</option>
          {(methods ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
        <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} style={{ width: 'auto' }}>
          <option value="all">All sales</option>
          <option value="completed">Completed</option>
          <option value="voided">Voided</option>
          <option value="moves">Cash in and out</option>
        </Select>
        {letters.length > 1 ? (
          <Select aria-label="Register" value={register} onChange={(e) => setRegister(e.target.value)} style={{ width: 'auto' }}>
            <option value="all">All registers</option>
            {letters.map((l) => (
              <option key={l} value={l}>
                Register {l}
              </option>
            ))}
          </Select>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={<ReceiptText size={44} />} title={sales.length ? 'No sales match' : 'No sales yet'}>
          {sales.length ? 'Try a different search or filter.' : 'Sales appear here as soon as they are made, even offline.'}
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Receipt</th>
                <th>Items</th>
                <th className="hide-phone">Payment</th>
                <th className="hide-phone">Cashier</th>
                <th className="r">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                if (row.type === 'move') {
                  const { move: m, session: sess } = row;
                  return (
                    <tr key={m.id} className="click cash-move" onClick={() => void fixMove(m, sess)}>
                      <td className="nowrap">
                        <b>{m.kind === 'in' ? 'In' : 'Out'}</b>
                        <div className="muted tiny">{fmtTime(m.at)}</div>
                      </td>
                      <td>
                        <Badge>
                          <ArrowDownUp size={12} aria-hidden="true" /> Cash in/out · register {sess.letter}
                        </Badge>{' '}
                        {m.reason || <span className="muted">No reason given</span>}
                      </td>
                      <td className="hide-phone small">{moveMethod(m).name}</td>
                      <td className="hide-phone small">{m.by ? memberName.get(m.by) ?? '—' : '—'}</td>
                      <td className={`r strong ${m.kind === 'out' ? 'bad' : 'good'}`}>
                        {m.kind === 'out' ? '−' : '+'}
                        {peso(m.amount)}
                      </td>
                    </tr>
                  );
                }
                const s = row.sale;
                return (
                <tr key={s.id} className={`click ${s.status === 'voided' ? 'voided' : ''}`} onClick={() => setOpen(s)}>
                  <td className="nowrap">
                    <b className="mono">{s.receiptNo}</b>
                    <div className="muted tiny">
                      {fmtTime(s.at)}
                      {emailed?.get(s.id) ? (
                        <span
                          className={`email-mark ${emailed.get(s.id)!.status}`}
                          title={emailed.get(s.id)!.status === 'sent' ? `Emailed to ${emailed.get(s.id)!.to}` : emailed.get(s.id)!.status === 'failed' ? `Email failed: ${emailed.get(s.id)!.error}` : 'Email waiting to send'}
                        >
                          {' '}
                          <Mail size={12} aria-hidden="true" /> {emailed.get(s.id)!.status === 'sent' ? 'emailed' : emailed.get(s.id)!.status === 'failed' ? 'email failed' : 'email waiting'}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    {s.kind === 'deposit' ? <Badge tone="teal">Deposit</Badge> : s.kind === 'service' ? <Badge tone="yellow">Service</Badge> : null} {s.lines.map((l) => `${l.qty} × ${l.name}`).join(', ')}
                    {s.status === 'voided' ? (
                      <div>
                        <Badge tone="bad">Voided</Badge>
                      </div>
                    ) : null}
                  </td>
                  <td className="hide-phone small">{s.payments.map((p) => p.name).join(' + ')}</td>
                  <td className="hide-phone small">{s.cashierId ? memberName.get(s.cashierId) ?? '—' : '—'}</td>
                  <td className="r strong">{peso(s.total)}</td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <SaleDialog
        sale={open ? (sales.find((s) => s.id === open.id) ?? open) : null}
        onClose={() => setOpen(null)}
        onReceipt={(s) => {
          setOpen(null);
          setReceipt(s);
        }}
        cashierName={open?.cashierId ? memberName.get(open.cashierId) : undefined}
      />
      <ReceiptDialog sale={receipt} business={business} eventName={ev.name} onClose={() => setReceipt(null)} primaryLabel="Close" />
      {fixing ? (
        <CashMoveDialog
          session={sessions.find((x) => x.id === fixing.session.id) ?? fixing.session}
          move={fixing.move}
          open
          onClose={() => setFixing(null)}
        />
      ) : null}
    </div>
  );
}

function SaleDialog({ sale, onClose, onReceipt, cashierName }: { sale: Sale | null; onClose: () => void; onReceipt: (s: Sale) => void; cashierName?: string }) {
  const app = useApp();
  const methods = usePaymentMethods();
  const [mode, setMode] = useState<'view' | 'void' | 'payment'>('view');
  const [reason, setReason] = useState('');
  const [newMethod, setNewMethod] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    setMode('view');
    setReason('');
    setError('');
    setNewMethod(sale?.payments[0]?.methodId ?? '');
  }, [sale?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!sale) return null;

  const doVoid = async () => {
    if (!reason.trim()) {
      setError('Say why the sale is voided. It goes in the report.');
      return;
    }
    if (!(await app.askOwner(`Void ${sale.receiptNo}`))) return;
    await voidSale(sale.id, reason, app.member?.id ?? null);
    app.toast(`${sale.receiptNo} voided. Its items are back in stock.`, { tone: 'good' });
    onClose();
  };

  const doPayment = async () => {
    const m = (methods ?? []).find((x) => x.id === newMethod);
    if (!m) return;
    if (!(await app.askOwner(`Change the payment on ${sale.receiptNo}`))) return;
    const payments: SalePayment[] = [{ methodId: m.id, name: m.name, kind: m.kind, amount: sale.total, tendered: m.kind === 'cash' ? sale.total : null, ref: '' }];
    try {
      await changeSalePayments(sale.id, payments);
      app.toast(`${sale.receiptNo} is now paid by ${m.name}`, { tone: 'good' });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change the payment.');
    }
  };

  return (
    <Dialog
      open={!!sale}
      onClose={onClose}
      title={`Sale ${sale.receiptNo}`}
      footer={
        mode === 'view' ? (
          <>
            <Button onClick={() => onReceipt(sale)}>Show receipt</Button>
            {sale.status === 'completed' ? <Button onClick={() => setMode('payment')}>Change payment</Button> : null}
            {sale.status === 'completed' ? (
              <Button variant="danger" onClick={() => setMode('void')}>
                Void sale
              </Button>
            ) : null}
          </>
        ) : mode === 'void' ? (
          <>
            <Button onClick={() => setMode('view')}>Back</Button>
            <Button variant="danger" onClick={doVoid}>
              Void {peso(sale.total)}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={() => setMode('view')}>Back</Button>
            <Button variant="primary" onClick={doPayment}>
              Save payment
            </Button>
          </>
        )
      }
    >
      <p className="muted small">
        {fmtDateTime(sale.at)}
        {cashierName ? ` · ${cashierName}` : ''}
      </p>
      {sale.status === 'voided' ? <Callout tone="bad" title="Voided">{sale.voidReason || 'No reason given.'}</Callout> : null}
      <div className="receipt">
        {sale.lines.map((l, i) => (
          <div key={i} className="rline">
            <span>
              {l.qty} × {l.name} {l.free ? <Badge tone="good">Free</Badge> : null}
            </span>
            <span className="num">{l.free ? 'Free' : peso(l.gross)}</span>
          </div>
        ))}
        {sale.discounts.map((d) => (
          <div key={d.id} className="rline good">
            <span>{d.label}</span>
            <span className="num">−{peso(d.amount)}</span>
          </div>
        ))}
        <div className="rline total">
          <span>Total</span>
          <span className="num">{peso(sale.total)}</span>
        </div>
        {sale.payments.map((p, i) => (
          <div key={i} className="rline small">
            <span>
              {p.name}
              {p.ref ? ` · ref ${p.ref}` : ''}
            </span>
            <span className="num">{peso(p.amount)}</span>
          </div>
        ))}
        {sale.note ? <p className="small muted">Note: {sale.note}</p> : null}
      </div>
      {mode === 'void' ? (
        <Field label="Why is it voided?" htmlFor="void-reason" error={error || undefined} hint="The sale drops out of every total and its items go back into stock.">
          <TextArea id="void-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer changed their mind, rang up twice" autoFocus />
        </Field>
      ) : null}
      {mode === 'payment' ? (
        <>
          <Field label="It was actually paid by" htmlFor="new-method" hint="For a sale recorded under the wrong method, like Cash that was really GCash.">
            <Select id="new-method" value={newMethod} onChange={(e) => setNewMethod(e.target.value)}>
              {(methods ?? [])
                .filter((m) => m.active === 1)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
            </Select>
          </Field>
          {error ? <Callout tone="bad">{error}</Callout> : null}
        </>
      ) : null}
    </Dialog>
  );
}
