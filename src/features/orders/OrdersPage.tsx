import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Ban, Camera, ClipboardList, CloudDownload, HandCoins, Monitor, PackageCheck, Pencil, Plus, Printer, Search, Send, Trash2, UserRound, Volume2, Wallet, X } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { StickDialog } from '../stick/StickDialog';
import { StubsDialog, type StubOrder } from '../stick/Stubs';
import { PhotoImg } from '../../booth/PhotoImg';
import { miniPic } from '../stick/MiniPicker';
import { handOverStick } from '../../services/stick';
import { DEFAULT_STICK, claimNo, minisFor, packFileName, packLabel, packNames, packPeople, type StickSettings } from '../../domain/stick';
import { announceShowcase } from '../../display/channel';
import { refreshStickers } from '../../display/stickers';
import '../stick/stick.css';
import { useApp } from '../../app/AppContext';
import {
  useCustomers, useEventProducts, useMembers, useOrderSales, useOrders, usePaymentMethods, useProducts, useSessions, useSettingRows,
} from '../../hooks/data';
import { settingValue } from '../../db/settings';
import { Dialog } from '../../components/Dialog';
import { Badge, Button, Callout, EmptyState, IconButton, Loading, PageHeader, Segmented } from '../../components/ui';
import { Check, Field, MoneyInput, NumberInput, Select, TextArea, TextInput } from '../../components/form';
import { peso, type Cents } from '../../lib/money';
import { fmtDateTime, fmtTime } from '../../lib/time';
import { effectivePrice, isOnSale } from '../../services/catalog';
import { ORDER_STATUS_LABEL, dueText, isOpenOrder, orderDeleteBlock, orderDiscount, orderMoney, orderServicePrice, orderTotal, suggestedDeposit, type OrderMoney } from '../../domain/orders';
import { claimId } from '../../domain/coupons';
import { CouponField, appliedFrom, useCouponCheck } from '../coupons/CouponField';
import { cancelOrder, createOrder, deleteOrder, pickUpOrder, setOrderStatus, takeDeposit, updateOrder } from '../../services/orders';
import { sendOrderToStudio } from '../../services/studio';
import { getMailer, isEmail, mailerReady } from '../../email/send';
import { flushOutbox, queueEmail } from '../../email/outbox';
import { orderReadyEmail, orderReadyText } from '../../email/templates';
import { PaymentDialog } from '../register/PaymentDialog';
import { FindOrderDialog } from './FindOrderDialog';
import { useCallOrder } from '../../display/voice';
import { ReceiptDialog } from '../register/ReceiptDialog';
import { CustomerPicker } from '../register/CustomerPicker';
import type { BusinessSettings, Customer, JWEvent, Order, OrderLine, OrderStatus, Sale, SalePayment, StickerArt } from '../../db/types';
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
  const stickSettings: StickSettings = { ...DEFAULT_STICK, ...settingValue<Partial<StickSettings>>(useSettingRows(), 'stick') };
  // Finished Couple-of-Stickers designs from Drive, by their number.
  const artList = useLiveQuery(() => db.stickerArt.toArray(), []);
  const art = useMemo(() => new Map((artList ?? []).map((a) => [a.code.toUpperCase(), a])), [artList]);
  const [stickEdit, setStickEdit] = useState<{ order: Order; sale: Sale } | null>(null);
  const [stubs, setStubs] = useState<StubOrder | null>(null);
  const [params, setParams] = useSearchParams();
  const reopen = params.get('stick');
  useEffect(() => {
    if (!reopen || !orders) return;
    const o = orders.find((x) => x.id === reopen);
    setParams({}, { replace: true });
    if (o?.stick) void stickDetails(o);
  }, [reopen, orders]); // eslint-disable-line react-hooks/exhaustive-deps
  /** The stubs, with their booth photo when this laptop has it. */
  const openStubs = async (o: Order) => {
    const photo = o.stick?.photoId ? ((await db.boothPhotos.get(o.stick.photoId))?.blob ?? null) : null;
    const packPhotos = await Promise.all((o.stick?.packs ?? []).map(async (p) => (p.photoId ? ((await db.boothPhotos.get(p.photoId))?.blob ?? null) : null)));
    setStubs({ number: o.number, eventName: ev.name, at: o.createdAt, stick: o.stick!, photo, packPhotos });
  };
  const [checking, setChecking] = useState(false);
  const checkDrive = async () => {
    setChecking(true);
    try {
      const r = await refreshStickers();
      app.toast(`${r.total} design${r.total === 1 ? '' : 's'} in Drive${r.added ? `, ${r.added} new` : ''}`, { tone: 'good' });
    } catch (e) {
      app.toast(e instanceof Error ? e.message : 'Couldn’t check Drive', { tone: 'bad' });
    } finally {
      setChecking(false);
    }
  };
  const stickDetails = async (o: Order) => {
    const sale = o.stick ? await db.sales.get(o.stick.saleId) : undefined;
    if (sale) setStickEdit({ order: o, sale });
    else app.toast('The sale it was paid with isn’t on this device.', { tone: 'bad' });
  };
  /** Show the finished sticker on the customer screen, with the order number. */
  const showOff = (o: Order) => {
    const pack = o.stick?.packs.find((p) => art.has(p.designNo.toUpperCase()));
    const a = pack ? art.get(pack.designNo.toUpperCase()) : undefined;
    if (!o.stick || !pack || !a) return;
    announceShowcase({ number: o.number, name: (packNames(pack) || o.stick.nickname).split(/\s+/)[0], label: packFileName(pack, o.stick.nickname), art: a.blob, cta: 'Get your own Couple-of-Stickers: ask us at the counter!' });
    app.toast(`${o.number} is on the customer screen`, { tone: 'good' });
  };
  const [scope, setScope] = useState<'event' | 'open'>('event');
  const [editing, setEditing] = useState<Order | 'new' | null>(null);
  const [paying, setPaying] = useState<Paying | null>(null);
  const [depositFor, setDepositFor] = useState<Order | null>(null);
  const [cancelling, setCancelling] = useState<Order | null>(null);
  const [created, setCreated] = useState<Order | null>(null);
  const [finding, setFinding] = useState(false);
  const callOrder = useCallOrder();
  const [receipt, setReceipt] = useState<Sale | null>(null);
  const owner = app.can('viewProfit');
  const toStudio = async (o: Order) => {
    try {
      await sendOrderToStudio(o.id, app.member?.name ?? '');
      app.toast(`${o.number} sent to JoshWorks Studio (Money → Booth events)`, { tone: 'good' });
    } catch (e) {
      app.toast(e instanceof Error ? e.message : 'Couldn’t send it', { tone: 'bad' });
    }
  };
  const removeOrder = async (o: Order) => {
    const blocked = orderDeleteBlock(o, orderSales ?? []);
    if (blocked) {
      app.toast(blocked, { tone: 'bad' });
      return;
    }
    const ok = await app.confirm({
      title: `Delete ${o.number}?`,
      message: 'It comes off this list and off Booth events in JoshWorks Studio. If it’s already a job there, Studio shows it under Deleted in the POS for you to delete. You can’t undo this.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    await deleteOrder(o.id);
    app.toast(`${o.number} deleted`, { tone: 'good' });
  };

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
    // Couple-of-Stickers were paid at the register: nothing more to charge.
    if (o.stick) {
      if (!(await app.confirm({ title: `Hand over ${o.number}?`, message: `${o.customerName}’s Couple-of-Stickers. Paid ${peso(o.stick.paid)} by ${o.stick.paidWith}: check their claim stub says ${claimNo(o.number)}.`, confirmLabel: 'Hand over' }))) return;
      await handOverStick(o);
      app.toast(`${o.number} handed over`, { tone: 'good' });
      return;
    }
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
    // Couple-of-Stickers customers hold a stub with just the number: call that.
    callOrder(o.stick ? claimNo(o.number) : o.number, nameOf(o));
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
          <>
            <Button onClick={() => void checkDrive()} disabled={checking}>
              <CloudDownload size={18} /> {checking ? 'Checking Drive…' : 'Check Drive for designs'}
            </Button>
            <Button onClick={() => setFinding(true)}>
              <Search size={18} /> Find an order
            </Button>
            <Button variant="primary" onClick={() => setEditing('new')}>
              <Plus size={18} /> New order
            </Button>
          </>
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
                    onCall={() => callOrder(o.stick ? claimNo(o.number) : o.number, nameOf(o), true)}
                    onStudio={owner ? () => toStudio(o) : undefined}
                    onDelete={owner ? () => void removeOrder(o) : undefined}
                    art={art}
                    onStick={o.stick ? () => void stickDetails(o) : undefined}
                    onStubs={o.stick ? () => void openStubs(o) : undefined}
                    onPhoto={o.stick ? (pack) => navigate(`/booth?order=${o.id}${pack !== undefined ? `&pack=${pack}` : ''}`) : undefined}
                    onShowOff={o.stick ? () => showOff(o) : undefined}
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
              <div key={o.id} className="list-item order-closed">
                <b className="mono">{o.number}</b>
                <span className="main-text">
                  <b>{nameOf(o)}</b>
                  <span>{o.lines.map((l) => `${l.qty} × ${l.name}`).join(', ')}</span>
                </span>
                <Badge tone={o.status === 'picked-up' ? 'good' : undefined}>{ORDER_STATUS_LABEL[o.status]}</Badge>
                <span className="muted tiny nowrap">{fmtDateTime(o.statusAt)}</span>
                <span className="row order-closed-actions">
                  <IconButton label={`Edit ${o.number}`} size="sm" plain onClick={() => setEditing(o)}>
                    <Pencil size={15} />
                  </IconButton>
                  {owner ? (
                    <>
                      <IconButton label={`Send ${o.number} to Studio`} size="sm" plain onClick={() => toStudio(o)}>
                        <Send size={15} />
                      </IconButton>
                      <IconButton label={`Delete ${o.number}`} size="sm" plain onClick={() => void removeOrder(o)}>
                        <Trash2 size={15} />
                      </IconButton>
                    </>
                  ) : null}
                </span>
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
      {stickEdit ? <StickDialog sale={stickEdit.sale} ev={ev} existing={stickEdit.order} onClose={() => setStickEdit(null)} /> : null}
      <StubsDialog o={stubs} paper={stickSettings.stubPaper} onClose={() => setStubs(null)} />
      <FindOrderDialog open={finding} onClose={() => setFinding(false)} />
      <CreatedDialog order={created} name={created ? nameOf(created) : ''} money={created ? money(created) : null} onClose={() => setCreated(null)} />
    </div>
  );
}

function OrderCard({
  order: o, money: m, customer, maker, otherEvent, onEdit, onCancel, onDeposit, onStart, onReady, onHandOver, onCall, onStudio, onDelete, art, onStick, onStubs, onShowOff, onPhoto,
}: {
  art?: Map<string, StickerArt>;
  /** Couple-of-Stickers: take their photo at the booth, for this order. */
  /** Take their photo at our booth: for the whole order, or one pack. */
  onPhoto?: (pack?: number) => void;
  /** Couple-of-Stickers: change the details, print the stubs again, show it on the customer screen. */
  onStick?: () => void;
  onStubs?: () => void;
  onShowOff?: () => void;
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
  /** Call the order out loud again. */
  onCall: () => void;
  /** Owner only: send it to JoshWorks Studio as a job. */
  onStudio?: () => void;
  /** Owner only. */
  onDelete?: () => void;
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
          {onStubs ? (
            <IconButton label={`Stubs for ${o.number}`} size="sm" plain onClick={onStubs}>
              <Printer size={15} />
            </IconButton>
          ) : null}
          <IconButton label={`Edit ${o.number}`} size="sm" plain onClick={onStick ?? onEdit}>
            <Pencil size={15} />
          </IconButton>
          <IconButton label={`Cancel ${o.number}`} size="sm" plain onClick={onCancel}>
            <Ban size={15} />
          </IconButton>
          {onStudio ? (
            <IconButton label={`Send ${o.number} to Studio`} size="sm" plain onClick={onStudio}>
              <Send size={15} />
            </IconButton>
          ) : null}
          {onDelete ? (
            <IconButton label={`Delete ${o.number}`} size="sm" plain onClick={onDelete}>
              <Trash2 size={15} />
            </IconButton>
          ) : null}
        </div>
      </div>
      {o.stick ? (
        <StickInfo o={o} art={art} onShowOff={onShowOff} onPhoto={onPhoto} />
      ) : (
        <ul className="order-lines">
          {o.lines.map((l, i) => (
            <li key={i}>
              {l.qty} × {l.name}
            </li>
          ))}
        </ul>
      )}
      <div className="row wrap" style={{ gap: 6 }}>
        {due && !o.stick ? <Badge tone={late && o.status !== 'ready' ? 'warn' : undefined}>Due {due}</Badge> : null}
        {maker ? <Badge tone="teal">{maker}</Badge> : null}
        {otherEvent ? <Badge>Earlier event</Badge> : null}
        {o.coupon ? <Badge tone="yellow">Coupon {o.coupon.code}</Badge> : null}
      </div>
      <div className="row between small">
        <span className="muted">
          {o.stick ? `${peso(o.stick.paid)} by ${o.stick.paidWith}` : <>{peso(m.total)}{m.paid ? ` · ${peso(m.paid)} paid` : ' · no deposit'}</>}
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
          <>
            <Button size="sm" variant="primary" onClick={onHandOver}>
              <HandCoins size={15} /> Hand over
            </Button>
            <Button size="sm" variant="ghost" onClick={onCall}>
              <Volume2 size={15} /> Call
            </Button>
          </>
        )}
        {m.balance > 0 && o.status !== 'ready' && !o.stick ? (
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
  const [designNo, setDesignNo] = useState('');
  const [deposit, setDeposit] = useState<Cents | null>(null);
  const [depositEdited, setDepositEdited] = useState(false);
  const [takeNow, setTakeNow] = useState(true);
  const [couponCode, setCouponCode] = useState('');
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
    setDesignNo(o?.designNo ?? '');
    setDeposit(null);
    setDepositEdited(false);
    setTakeNow(true);
    setCouponCode(o?.coupon?.code ?? '');
    setError('');
  }, [order]); // eslint-disable-line react-hooks/exhaustive-deps

  const epMap = useMemo(() => new Map((eps ?? []).map((e) => [e.productId, e])), [eps]);
  const onSale = useMemo(() => (products ?? []).filter((p) => isOnSale(p, epMap.get(p.id))), [products, epMap]);
  const couponCheck = useCouponCheck(couponCode, orderServicePrice({ lines }), order && order !== 'new' ? claimId('order', order.id) : null);
  const coupon = appliedFrom(couponCheck);
  const off = orderDiscount({ lines, coupon });
  const total = orderTotal({ lines, coupon });
  const suggested = suggestedDeposit(total);
  const depositAmount = depositEdited ? (deposit ?? 0) : suggested;

  if (!order) return null;
  const isNew = order === 'new';
  const closed = !isNew && !isOpenOrder(order);
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
      const fields = { customerId: customer?.id ?? null, customerName: customer?.name ?? customerName, contact, lines, designerId: designerId || null, dueAt, notes, couponCode, designNo };
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
        {closed ? (
          <>
            <ul className="order-lines">
              {lines.map((l, i) => (
                <li key={i}>
                  {l.qty} × {l.name}
                </li>
              ))}
            </ul>
            <p className="muted small">Total {peso(orderTotal(order))}. A closed order keeps its items and price; the rest can still be fixed.</p>
          </>
        ) : (
          <>
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
              <b>
                {off ? <span className="muted small">{peso(total + off)} − coupon {peso(off)} = </span> : null}Total {peso(total)}
              </b>
            </div>
            {lines.some((l) => !l.productId) || couponCode ? (
              <CouponField id="or-coupon" code={couponCode} onCode={setCouponCode} check={couponCheck} hint="From a JoshWorks event. It comes off the custom pieces (₱2,500 or more), not catalog products." />
            ) : null}
          </>
        )}
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
        <Field label="Design no." htmlFor="or-design" hint="For custom stickers: the number on the design file in Drive, e.g. CS01 for CS01-Couple.png.">
          <TextInput id="or-design" value={designNo} onChange={(e) => setDesignNo(e.target.value.toUpperCase())} placeholder="CS01" maxLength={12} />
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

/** A Couple-of-Stickers order on its card: the packs, the mini stickers, and whether the design is in Drive yet. */
function StickInfo({ o, art, onShowOff, onPhoto }: { o: Order; art?: Map<string, StickerArt>; onShowOff?: () => void; onPhoto?: (pack?: number) => void }) {
  const s = o.stick!;
  const ready = s.packs.some((p) => art?.has(p.designNo.toUpperCase()));
  return (
    <div className="stick-info">
      <span className="muted">
        Claim stub <b>{claimNo(o.number)}</b> · ready {fmtTime(s.readyFrom)}–{fmtTime(s.readyTo)}
      </span>
      {s.packs.map((p, i) => {
        const a = art?.get(p.designNo.toUpperCase());
        return (
          <div key={i} className="stack tight">
            <b>
              {packLabel(p)} · {p.making === 'illustrating' ? 'Illustrating' : 'Printing'}
              {packNames(p) ? ` · ${packNames(p)}` : ''}
            </b>
            {packPeople(p).some((x) => x.who.trim()) ? (
              <span className="small">
                {packPeople(p)
                  .filter((x) => x.name.trim() || x.who.trim())
                  .map((x) => `${x.name.trim() || '?'}${x.who.trim() ? ` (${x.who.trim()})` : ''}`)
                  .join(', ')}
              </span>
            ) : null}
            <div className="stick-design">
              {a ? <ArtThumb blob={a.blob} name={a.name} /> : null}
              <span className="small">
                {packFileName(p, s.nickname)}.png{a ? ' · in Drive' : ' · not in Drive yet'}
              </span>
            </div>
            {p.photoId ? (
              <BoothPhotoLine id={p.photoId} name={packFileName(p, s.nickname)} url={p.photoUrl} />
            ) : s.photo === 'booth' && s.packs.length > 1 && onPhoto ? (
              <Button size="sm" variant="ghost" onClick={() => onPhoto(i)}>
                <Camera size={15} /> Take pack {i + 1}’s photo
              </Button>
            ) : null}
            {minisFor(p) ? (
              <div className="stick-minis" aria-label={`Mini stickers for pack ${i + 1}`}>
                {p.minis.length ? p.minis.map((n) => (miniPic(n) ? <img key={n} src={miniPic(n)} alt={n} title={n} /> : <span key={n}>{n}</span>)) : <span className="muted small">Mini stickers to pick</span>}
              </div>
            ) : null}
            {p.addOns?.length ? <span className="stick-addons">{p.addOns.map((a, k) => <span key={k} className="stick-addon">+ {a}</span>)}</span> : null}
            {p.note ? <span className="muted small">{p.note}</span> : null}
          </div>
        );
      })}
      {s.addOns.length ? <span className="small">Also {s.addOns.join(', ')}</span> : null}
      {s.softCopy && s.email ? <span className="small">Soft copy to {s.email}</span> : null}
      {s.photoId ? (
        <BoothPhotoLine id={s.photoId} name={`${claimNo(o.number)}-${s.nickname}`} url={s.photoUrl} />
      ) : s.photo === 'booth' && !s.packs.every((p) => p.photoId) ? (
        onPhoto ? (
          <Button size="sm" variant="teal" onClick={() => onPhoto()}>
            <Camera size={15} /> {s.packs.length > 1 ? 'Take one photo of everyone' : 'Take their photo'}
          </Button>
        ) : (
          <span className="small">Photo: our photo booth</span>
        )
      ) : (
        <span className="small">{s.photo === 'message' ? 'Photo: they’ll message it' : ''}</span>
      )}
      {onShowOff ? (
        <Button size="sm" variant="ghost" onClick={onShowOff} disabled={!ready} title={ready ? undefined : 'Once the design is in Drive (Check Drive for designs)'}>
          <Monitor size={15} /> Show on customer screen
        </Button>
      ) : null}
    </div>
  );
}

function ArtThumb({ blob, name }: { blob: Blob; name: string }) {
  const url = useMemo(() => URL.createObjectURL(blob), [blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return <img src={url} alt={name} />;
}

/** Their photo from our booth, when it's on this laptop; its Drive link otherwise. */
function BoothPhotoLine({ id, name, url }: { id: string; name: string; url?: string }) {
  const photo = useLiveQuery(() => db.boothPhotos.get(id), [id]);
  return (
    <span className="stick-design">
      {photo ? <PhotoImg photo={photo} /> : null}
      <span className="small">
        Their photo: {name}
        {url ? (
          <>
            {' '}
            (<a href={url} target="_blank" rel="noreferrer">Drive</a>)
          </>
        ) : null}
      </span>
    </span>
  );
}
