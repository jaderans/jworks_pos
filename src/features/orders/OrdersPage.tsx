import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Ban, ClipboardList, HandCoins, PackageCheck, Pencil, Plus, Trash2, UserRound, Wallet, X } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import {
  useCustomers, useEventProducts, useMembers, useOrderSales, useOrders, usePaymentMethods, useProducts, useSessions, useSettingRows,
} from '../../hooks/data';
import { settingValue } from '../../db/settings';
import { Dialog } from '../../components/Dialog';
import { Badge, Button, Callout, EmptyState, IconButton, Loading, PageHeader, Segmented } from '../../components/ui';
import { Check, Field, MoneyInput, NumberInput, Select, TextArea, TextInput } from '../../components/form';
import { peso, type Cents } from '../../lib/money';
import { fmtDateTime } from '../../lib/time';
import { effectivePrice, isOnSale } from '../../services/catalog';
import { ORDER_STATUS_LABEL, dueText, isOpenOrder, orderMoney, orderTotal, suggestedDeposit, type OrderMoney } from '../../domain/orders';
import { cancelOrder, createOrder, pickUpOrder, setOrderStatus, takeDeposit, updateOrder } from '../../services/orders';
import { getMailer, isEmail, mailerReady } from '../../email/send';
import { flushOutbox, queueEmail } from '../../email/outbox';
import { orderReadyEmail, orderReadyText } from '../../email/templates';
import { PaymentDialog } from '../register/PaymentDialog';
import { ReceiptDialog } from '../register/ReceiptDialog';
import { CustomerPicker } from '../register/CustomerPicker';
import type { BusinessSettings, Customer, JWEvent, Order, OrderLine, OrderStatus, Sale, SalePayment } from '../../db/types';
import './orders.css';

export default function OrdersPage() {
  const app = useApp();
  const ev = app.activeEvent;
  if (ev === undefined) return <Loading />;
  if (!ev)
    return (
      <div className="page narrow">
        <EmptyState icon={<ClipboardList size={44} />} title="Pick an event first">
          Orders are taken at an event’s booth. Choose the event at the top of the screen.
        </EmptyState>
      </div>
    );
  return <Orders ev={ev} />;
}

const COLUMNS: { status: OrderStatus; hint: string }[] = [
  { status: 'new', hint: 'Taken, not started' },
  { status: 'in-progress', hint: 'Being printed or drawn' },
  { status: 'ready', hint: 'Waiting for the customer' },
];

type Paying = { kind: 'deposit' | 'pickup'; order: Order; amount: Cents };

function Orders({ ev }: { ev: JWEvent }) {
  const app = useApp();
  const navigate = useNavigate();
  const orders = useOrders();
  const orderSales = useOrderSales();
  const customers = useCustomers();
  const members = useMembers();
  const sessions = useSessions(ev.id);
  const methods = usePaymentMethods();
  const business = settingValue<BusinessSettings>(useSettingRows(), 'business');
  const [scope, setScope] = useState<'event' | 'open'>('event');
  const [editing, setEditing] = useState<Order | 'new' | null>(null);
  const [paying, setPaying] = useState<Paying | null>(null);
  const [depositFor, setDepositFor] = useState<Order | null>(null);
  const [cancelling, setCancelling] = useState<Order | null>(null);
  const [created, setCreated] = useState<Order | null>(null);
  const [receipt, setReceipt] = useState<Sale | null>(null);

  const session = sessions?.find((s) => s.deviceId === app.device.deviceId && s.closedAt === null);
  const eventMethods = useMemo(
    () => ev.paymentMethodIds.map((id) => (methods ?? []).find((m) => m.id === id)).filter((m): m is NonNullable<typeof m> => !!m && m.active === 1 && m.deleted !== 1),
    [ev.paymentMethodIds, methods],
  );
  const customerOf = (o: Order) => (o.customerId ? customers?.find((c) => c.id === o.customerId) : undefined);
  const nameOf = (o: Order) => customerOf(o)?.name ?? o.customerName ?? 'Customer';
  const memberName = new Map((members ?? []).map((m) => [m.id, m.name]));

  if (!orders || !orderSales || !customers) return <Loading />;
  const inScope = orders.filter((o) => (scope === 'event' ? o.eventId === ev.id : isOpenOrder(o)));
  const open = inScope.filter(isOpenOrder);
  const closed = inScope.filter((o) => !isOpenOrder(o));
  const money = (o: Order) => orderMoney(o, orderSales);

  /** Taking money needs this device's register open for the event. */
  const registerOpen = () => {
    if (session) return true;
    app.toast('Open the register on this device to take money.', { tone: 'bad', action: { label: 'Open register', onClick: () => navigate('/sell') } });
    return false;
  };

  const pay = async (payments: SalePayment[]) => {
    if (!paying || !session) return;
    const t = { session, device: app.device, cashierId: app.member?.id ?? null, payments };
    const sale = paying.kind === 'deposit' ? await takeDeposit(paying.order, paying.amount, t) : await pickUpOrder(paying.order, t);
    setPaying(null);
    setReceipt(sale);
    app.toast(paying.kind === 'deposit' ? `Deposit taken for ${paying.order.number}` : `${paying.order.number} handed over`, { tone: 'good' });
  };

  const handOver = async (o: Order) => {
    if (!registerOpen() || !session) return;
    const m = money(o);
    if (m.balance > 0) {
      setPaying({ kind: 'pickup', order: o, amount: m.balance });
      return;
    }
    if (!(await app.confirm({ title: `Hand over ${o.number}?`, message: 'It’s fully paid. The items come out of stock.', confirmLabel: 'Hand over' }))) return;
    const sale = await pickUpOrder(o, { session, device: app.device, cashierId: app.member?.id ?? null, payments: [] });
    setReceipt(sale);
  };

  const markReady = async (o: Order) => {
    await setOrderStatus(o.id, 'ready');
    const c = customerOf(o);
    const to = c?.email || (isEmail(o.contact) ? o.contact : '');
    const m = money(o);
    if (to && mailerReady(await getMailer())) {
      await queueEmail({
        kind: 'test',
        saleId: null,
        to,
        toName: nameOf(o),
        mail: orderReadyEmail(business, { number: o.number, customerName: nameOf(o), eventName: ev.name, items: o.lines.map((l) => `${l.qty} × ${l.name}`), balance: m.balance }),
      });
      void flushOutbox();
      app.toast(`${o.number} is ready. ${nameOf(o)} is getting an email.`, { tone: 'good' });
      return;
    }
    const text = orderReadyText(business, { number: o.number, customerName: nameOf(o), eventName: ev.name, balance: m.balance });
    try {
      await navigator.clipboard.writeText(text);
      app.toast(`${o.number} is ready. A message for ${nameOf(o)} is copied; paste it in Messenger or SMS.`, { tone: 'good' });
    } catch {
      app.toast(`${o.number} is ready.`, { tone: 'good' });
    }
  };

  return (
    <div className="page orders-page">
      <PageHeader
        title="Orders"
        subtitle="Pre-orders and commissions: take a deposit now, hand it over later. Deposits sit in the drawer but count as sales only at pickup."
        actions={
          <Button variant="primary" onClick={() => setEditing('new')}>
            <Plus size={18} /> New order
          </Button>
        }
      />
      <div className="row between wrap">
        <Segmented<'event' | 'open'>
          label="Which orders"
          value={scope}
          onChange={setScope}
          options={[
            { value: 'event', label: `This event (${orders.filter((o) => o.eventId === ev.id).length})` },
            { value: 'open', label: `All open (${orders.filter(isOpenOrder).length})` },
          ]}
        />
        {!session ? (
          <span className="muted small">
            <Wallet size={14} /> Open the register on this device to take deposits.
          </span>
        ) : null}
      </div>

      {open.length === 0 && closed.length === 0 ? (
        <EmptyState icon={<ClipboardList size={44} />} title="No orders yet">
          Take one when a customer wants a custom name sticker, a size you don’t have on the table, or a commission.
        </EmptyState>
      ) : (
        <div className="order-board">
          {COLUMNS.map((col) => {
            const list = open.filter((o) => o.status === col.status);
            return (
              <section key={col.status} className="order-col" aria-label={ORDER_STATUS_LABEL[col.status]}>
                <div className="order-col-head">
                  <b>{ORDER_STATUS_LABEL[col.status]}</b>
                  <Badge>{list.length}</Badge>
                </div>
                <p className="muted tiny">{col.hint}</p>
                {list.map((o) => (
                  <OrderCard
                    key={o.id}
                    order={o}
                    money={money(o)}
                    customer={nameOf(o)}
                    maker={o.designerId ? memberName.get(o.designerId) : undefined}
                    otherEvent={o.eventId !== ev.id}
                    onEdit={() => setEditing(o)}
                    onCancel={() => setCancelling(o)}
                    onDeposit={() => registerOpen() && setDepositFor(o)}
                    onStart={() => setOrderStatus(o.id, 'in-progress')}
                    onReady={() => markReady(o)}
                    onHandOver={() => handOver(o)}
                  />
                ))}
              </section>
            );
          })}
        </div>
      )}

      {closed.length ? (
        <details className="card">
          <summary className="strong">Picked up and cancelled ({closed.length})</summary>
          <div className="list" style={{ marginTop: 8 }}>
            {closed.map((o) => (
              <div key={o.id} className="list-item">
                <b className="mono">{o.number}</b>
                <span className="main-text">
                  <b>{nameOf(o)}</b>
                  <span>{o.lines.map((l) => `${l.qty} × ${l.name}`).join(', ')}</span>
                </span>
                <Badge tone={o.status === 'picked-up' ? 'good' : undefined}>{ORDER_STATUS_LABEL[o.status]}</Badge>
                <span className="muted tiny nowrap">{fmtDateTime(o.statusAt)}</span>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      <OrderDialog
        ev={ev}
        order={editing}
        canTakeMoney={!!session}
        onClose={() => setEditing(null)}
        onCreated={(o, deposit) => {
          setEditing(null);
          if (deposit > 0 && registerOpen()) setPaying({ kind: 'deposit', order: o, amount: deposit });
          else setCreated(o);
        }}
      />
      <DepositDialog
        order={depositFor}
        money={depositFor ? money(depositFor) : null}
        onClose={() => setDepositFor(null)}
        onNext={(amount) => {
          if (depositFor) setPaying({ kind: 'deposit', order: depositFor, amount });
          setDepositFor(null);
        }}
      />
      <CancelDialog
        order={cancelling}
        money={cancelling ? money(cancelling) : null}
        onClose={() => setCancelling(null)}
        onCancel={async (deposits) => {
          if (!cancelling) return;
          if (deposits === 'refund' && money(cancelling).paid && !(await app.askOwner(`Refund the deposit for ${cancelling.number}`))) return;
          await cancelOrder(cancelling, deposits, app.member?.id ?? null);
          app.toast(`${cancelling.number} cancelled`, { tone: 'good' });
          setCancelling(null);
        }}
      />
      <PaymentDialog
        open={!!paying}
        onClose={() => {
          if (paying?.kind === 'deposit') setCreated(paying.order);
          setPaying(null);
        }}
        total={paying?.amount ?? 0}
        methods={eventMethods}
        onPay={pay}
      />
      <ReceiptDialog
        sale={receipt}
        business={business}
        eventName={ev.name}
        primaryLabel="Done"
        onClose={() => {
          const o = receipt?.kind === 'deposit' ? orders.find((x) => x.id === receipt.orderId) : undefined;
          setReceipt(null);
          if (o) setCreated(o);
        }}
      />
      <CreatedDialog order={created} name={created ? nameOf(created) : ''} money={created ? money(created) : null} onClose={() => setCreated(null)} />
    </div>
  );
}

function OrderCard({
  order: o, money: m, customer, maker, otherEvent, onEdit, onCancel, onDeposit, onStart, onReady, onHandOver,
}: {
  order: Order;
  money: OrderMoney;
  customer: string;
  maker?: string;
  otherEvent: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onDeposit: () => void;
  onStart: () => void;
  onReady: () => void;
  onHandOver: () => void;
}) {
  const due = dueText(o.dueAt);
  const late = !!o.dueAt && new Date(o.dueAt).getTime() < Date.now();
  return (
    <article className="order-card" aria-label={`Order ${o.number}`}>
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div>
          <div className="order-no">{o.number}</div>
          <div className="strong">{customer}</div>
        </div>
        <div className="row" style={{ gap: 2 }}>
          <IconButton label={`Edit ${o.number}`} size="sm" plain onClick={onEdit}>
            <Pencil size={15} />
          </IconButton>
          <IconButton label={`Cancel ${o.number}`} size="sm" plain onClick={onCancel}>
            <Ban size={15} />
          </IconButton>
        </div>
      </div>
      <ul className="order-lines">
        {o.lines.map((l, i) => (
          <li key={i}>
            {l.qty} × {l.name}
          </li>
        ))}
      </ul>
      <div className="row wrap" style={{ gap: 6 }}>
        {due ? <Badge tone={late && o.status !== 'ready' ? 'warn' : undefined}>Due {due}</Badge> : null}
        {maker ? <Badge tone="teal">{maker}</Badge> : null}
        {otherEvent ? <Badge>Earlier event</Badge> : null}
      </div>
      <div className="row between small">
        <span className="muted">
          {peso(m.total)}
          {m.paid ? ` · ${peso(m.paid)} paid` : ' · no deposit'}
        </span>
        <b className={m.balance ? '' : 'good'}>{m.balance ? `${peso(m.balance)} due` : 'Paid'}</b>
      </div>
      {o.notes ? <p className="muted tiny">{o.notes}</p> : null}
      <div className="actions">
        {o.status === 'new' ? (
          <Button size="sm" onClick={onStart}>
            Start
          </Button>
        ) : null}
        {o.status !== 'ready' ? (
          <Button size="sm" onClick={onReady}>
            <PackageCheck size={15} /> Ready
          </Button>
        ) : (
          <Button size="sm" variant="primary" onClick={onHandOver}>
            <HandCoins size={15} /> Hand over
          </Button>
        )}
        {m.balance > 0 && o.status !== 'ready' ? (
          <Button size="sm" variant="ghost" onClick={onDeposit}>
            <Wallet size={15} /> Deposit
          </Button>
        ) : null}
      </div>
    </article>
  );
}

const blankLine = (): OrderLine => ({ productId: null, name: '', categoryId: null, designerId: null, qty: 1, unitPrice: 0 });

function OrderDialog({
  ev, order, canTakeMoney, onClose, onCreated,
}: {
  ev: JWEvent;
  order: Order | 'new' | null;
  canTakeMoney: boolean;
  onClose: () => void;
  onCreated: (o: Order, deposit: Cents) => void;
}) {
  const app = useApp();
  const products = useProducts();
  const eps = useEventProducts(ev.id);
  const members = useMembers();
  const customers = useCustomers();
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [contact, setContact] = useState('');
  const [designerId, setDesignerId] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [notes, setNotes] = useState('');
  const [deposit, setDeposit] = useState<Cents | null>(null);
  const [depositEdited, setDepositEdited] = useState(false);
  const [takeNow, setTakeNow] = useState(true);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!order) return;
    const o = order === 'new' ? null : order;
    setLines(o ? o.lines.map((l) => ({ ...l })) : []);
    setCustomer(o?.customerId ? (customers ?? []).find((c) => c.id === o.customerId) ?? null : null);
    setCustomerName(o?.customerName ?? '');
    setContact(o?.contact ?? '');
    setDesignerId(o?.designerId ?? '');
    setDueAt(o?.dueAt ?? '');
    setNotes(o?.notes ?? '');
    setDeposit(null);
    setDepositEdited(false);
    setTakeNow(true);
    setError('');
  }, [order]); // eslint-disable-line react-hooks/exhaustive-deps

  const epMap = useMemo(() => new Map((eps ?? []).map((e) => [e.productId, e])), [eps]);
  const onSale = useMemo(() => (products ?? []).filter((p) => isOnSale(p, epMap.get(p.id))), [products, epMap]);
  const total = orderTotal({ lines });
  const suggested = suggestedDeposit(total);
  const depositAmount = depositEdited ? (deposit ?? 0) : suggested;

  if (!order) return null;
  const isNew = order === 'new';
  const setLine = (i: number, patch: Partial<OrderLine>) => setLines(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const addProduct = (id: string) => {
    const p = onSale.find((x) => x.id === id);
    if (!p) return;
    setLines([...lines, { productId: p.id, name: p.name, categoryId: p.categoryId, designerId: p.designerId, qty: 1, unitPrice: effectivePrice(p, epMap.get(p.id)) ?? 0 }]);
  };

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const fields = { customerId: customer?.id ?? null, customerName: customer?.name ?? customerName, contact, lines, designerId: designerId || null, dueAt, notes };
      if (isNew) {
        const o = await createOrder({ eventId: ev.id, ...fields }, app.device);
        onCreated(o, canTakeMoney && takeNow ? Math.min(depositAmount, total) : 0);
      } else {
        await updateOrder(order.id, fields);
        onClose();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the order.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={isNew ? 'New order' : `Order ${order.number}`}
      size="wide"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={busy || !lines.length}>
            {isNew ? (canTakeMoney && takeNow && depositAmount > 0 ? `Save and take ${peso(Math.min(depositAmount, total))}` : 'Save order') : 'Save'}
          </Button>
        </>
      }
    >
      <div className="stack tight">
        <span className="label strong small">Customer</span>
        {customer ? (
          <div className="row">
            <UserRound size={18} />
            <b className="grow">{customer.name}</b>
            <IconButton label="Choose a different customer" size="sm" onClick={() => setCustomer(null)}>
              <X size={16} />
            </IconButton>
          </div>
        ) : (
          <div className="form-grid">
            <Field label="Name" htmlFor="or-name">
              <TextInput id="or-name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Who it’s for" />
            </Field>
            <Field label="Mobile, email or @handle" htmlFor="or-contact" hint="To tell them it’s ready.">
              <TextInput id="or-contact" value={contact} onChange={(e) => setContact(e.target.value)} />
            </Field>
            <div className="span-2">
              <Button size="sm" onClick={() => setPicking(true)}>
                <UserRound size={15} /> Pick a saved customer
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="stack tight">
        <span className="label strong small">Items</span>
        {lines.map((l, i) => (
          <div key={i} className="order-line-edit">
            {l.productId ? (
              <b className="grow">{l.name}</b>
            ) : (
              <TextInput aria-label="What it is" className="grow" value={l.name} onChange={(e) => setLine(i, { name: e.target.value })} placeholder="e.g. Custom name sticker, A5 portrait" autoFocus />
            )}
            <div style={{ width: 92 }}>
              <NumberInput ariaLabel={`How many ${l.name || 'pieces'}`} decimals={false} min={1} value={l.qty} onChange={(n) => setLine(i, { qty: Math.max(1, Math.round(n ?? 1)) })} />
            </div>
            <div style={{ width: 130 }}>
              <MoneyInput ariaLabel={`Price each of ${l.name || 'the piece'}`} value={l.unitPrice} onChange={(c) => setLine(i, { unitPrice: c ?? 0 })} />
            </div>
            <IconButton label={`Remove ${l.name || 'item'}`} size="sm" onClick={() => setLines(lines.filter((_, k) => k !== i))}>
              <Trash2 size={15} />
            </IconButton>
          </div>
        ))}
        <div className="row wrap">
          <Select aria-label="Add a product" value="" onChange={(e) => addProduct(e.target.value)} style={{ width: 'auto', minWidth: 220 }}>
            <option value="">Add a product…</option>
            {onSale.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {effectivePrice(p, epMap.get(p.id)) !== null ? ` · ${peso(effectivePrice(p, epMap.get(p.id)))}` : ''}
              </option>
            ))}
          </Select>
          <Button size="sm" onClick={() => setLines([...lines, blankLine()])}>
            <Plus size={15} /> Custom piece
          </Button>
          <span className="grow" />
          <b>Total {peso(total)}</b>
        </div>
      </div>

      <div className="form-grid">
        <Field label="Ready by" htmlFor="or-due">
          <TextInput id="or-due" type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
        </Field>
        <Field label="Who makes it" htmlFor="or-maker">
          <Select id="or-maker" value={designerId} onChange={(e) => setDesignerId(e.target.value)}>
            <option value="">Anyone</option>
            {(members ?? [])
              .filter((m) => m.active === 1)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Notes" htmlFor="or-notes" className="span-2">
          <TextArea id="or-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Size, colors, the name to print, reference photo on Kaye’s phone…" />
        </Field>
      </div>

      {isNew ? (
        canTakeMoney ? (
          <div className="stack tight">
            <Check id="or-take" checked={takeNow} onChange={setTakeNow} label="Take a deposit now" sub="It goes in the drawer or GCash today, and counts as a sale when they pick it up." />
            {takeNow ? (
              <Field label="Deposit" htmlFor="or-dep" hint={`Half is ${peso(suggested)}.`}>
                <MoneyInput
                  id="or-dep"
                  value={depositAmount}
                  onChange={(c) => {
                    setDeposit(c);
                    setDepositEdited(true);
                  }}
                />
              </Field>
            ) : null}
          </div>
        ) : (
          <Callout tone="info">Open the register on this device to take a deposit. You can also take it later from the order card.</Callout>
        )
      ) : null}
      {error ? <Callout tone="bad">{error}</Callout> : null}
      <CustomerPicker
        open={picking}
        onClose={() => setPicking(false)}
        eventId={ev.id}
        onPick={(c) => {
          setCustomer(c);
          setPicking(false);
        }}
      />
    </Dialog>
  );
}

function DepositDialog({ order, money, onClose, onNext }: { order: Order | null; money: OrderMoney | null; onClose: () => void; onNext: (amount: Cents) => void }) {
  const [amount, setAmount] = useState<Cents | null>(null);
  useEffect(() => {
    if (money) setAmount(Math.min(money.balance, suggestedDeposit(money.total)));
  }, [order?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!order || !money) return null;
  const ok = !!amount && amount > 0 && amount <= money.balance;
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Deposit for ${order.number}`}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!ok} onClick={() => amount && onNext(amount)}>
            Take {amount ? peso(amount) : ''}
          </Button>
        </>
      }
    >
      <p className="muted small">
        {peso(money.total)} total · {peso(money.paid)} paid · {peso(money.balance)} due
      </p>
      <Field label="Amount" htmlFor="dp-amount" error={amount && amount > money.balance ? `No more than ${peso(money.balance)}.` : undefined}>
        <MoneyInput id="dp-amount" large value={amount} onChange={setAmount} autoFocus />
      </Field>
    </Dialog>
  );
}

function CancelDialog({ order, money, onClose, onCancel }: { order: Order | null; money: OrderMoney | null; onClose: () => void; onCancel: (deposits: 'refund' | 'keep') => void }) {
  const [choice, setChoice] = useState<'refund' | 'keep'>('refund');
  if (!order || !money) return null;
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Cancel ${order.number}?`}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Keep the order</Button>
          <Button variant="danger" onClick={() => onCancel(choice)}>
            Cancel the order
          </Button>
        </>
      }
    >
      {money.paid ? (
        <div className="stack tight">
          <p>{peso(money.paid)} was paid as a deposit.</p>
          <Segmented<'refund' | 'keep'>
            label="The deposit"
            full
            value={choice}
            onChange={setChoice}
            options={[
              { value: 'refund', label: 'Refund it' },
              { value: 'keep', label: 'Keep it' },
            ]}
          />
          <p className="muted small">{choice === 'refund' ? 'Its sale is voided, so it leaves the drawer total. Hand the money back. Needs the owner PIN.' : 'It counts as a sale (a kept deposit), with no items.'}</p>
        </div>
      ) : (
        <p className="muted">No deposit was taken.</p>
      )}
    </Dialog>
  );
}

/** The queue number to show the customer (they can take a photo of it). */
function CreatedDialog({ order, name, money, onClose }: { order: Order | null; name: string; money: OrderMoney | null; onClose: () => void }) {
  if (!order || !money) return null;
  const due = dueText(order.dueAt);
  return (
    <Dialog
      open
      onClose={onClose}
      title="Order saved"
      size="sm"
      footer={
        <Button variant="primary" size="lg" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="order-ticket" role="status">
        <span className="eyebrow">Order number</span>
        <b>{order.number}</b>
        <span>{name}</span>
        {due ? <span className="muted small">Ready by {due}</span> : null}
        <span className="small">{money.balance ? `${peso(money.paid)} paid · ${peso(money.balance)} at pickup` : 'Fully paid'}</span>
      </div>
      <p className="muted small center">Show this to the customer. They can take a photo of it.</p>
    </Dialog>
  );
}
