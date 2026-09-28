import { useEffect, useMemo, useState } from 'react';
import { ReceiptText } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { useMembers, usePaymentMethods, useSales, useSettingRows } from '../../hooks/data';
import { settingValue } from '../../db/settings';
import { Dialog } from '../../components/Dialog';
import { Badge, Button, Callout, EmptyState, Loading, PageHeader } from '../../components/ui';
import { Field, SearchInput, Select, TextArea } from '../../components/form';
import { peso, sum } from '../../lib/money';
import { fmtDateTime, fmtTime } from '../../lib/time';
import { changeSalePayments, voidSale } from '../../services/sales';
import { ReceiptDialog } from '../register/ReceiptDialog';
import type { BusinessSettings, Sale, SalePayment } from '../../db/types';

export default function SalesLogPage() {
  const app = useApp();
  const ev = app.activeEvent;
  const sales = useSales(ev?.id);
  const members = useMembers();
  const methods = usePaymentMethods();
  const settingRows = useSettingRows();
  const business = settingValue<BusinessSettings>(settingRows, 'business');
  const [q, setQ] = useState('');
  const [method, setMethod] = useState('all');
  const [status, setStatus] = useState<'all' | 'completed' | 'voided'>('all');
  const [open, setOpen] = useState<Sale | null>(null);
  const [receipt, setReceipt] = useState<Sale | null>(null);

  const memberName = useMemo(() => new Map((members ?? []).map((m) => [m.id, m.name])), [members]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (sales ?? []).filter(
      (s) =>
        (status === 'all' || s.status === status) &&
        (method === 'all' || s.payments.some((p) => p.methodId === method)) &&
        (!needle ||
          s.receiptNo.toLowerCase().includes(needle) ||
          s.lines.some((l) => l.name.toLowerCase().includes(needle)) ||
          s.payments.some((p) => p.ref.toLowerCase().includes(needle)) ||
          s.note.toLowerCase().includes(needle)),
    );
  }, [sales, q, method, status]);

  if (!ev) return <div className="page"><EmptyState title="Pick an event">Sales are listed per event. Choose one from the top bar.</EmptyState></div>;
  if (!sales) return <Loading />;
  const completed = shown.filter((s) => s.status === 'completed');

  return (
    <div className="page">
      <PageHeader eyebrow={ev.name} title="Sales log" subtitle={`${completed.length} sale${completed.length === 1 ? '' : 's'} · ${peso(sum(completed.map((s) => s.total)))} shown. Each sale keeps the price it was sold at.`} />
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
        </Select>
      </div>
      {shown.length === 0 ? (
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
              {shown.map((s) => (
                <tr key={s.id} className={`click ${s.status === 'voided' ? 'voided' : ''}`} onClick={() => setOpen(s)}>
                  <td className="nowrap">
                    <b className="mono">{s.receiptNo}</b>
                    <div className="muted tiny">{fmtTime(s.at)}</div>
                  </td>
                  <td>
                    {s.lines.map((l) => `${l.qty} × ${l.name}`).join(', ')}
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
              ))}
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
