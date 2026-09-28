import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowDownUp, CalendarPlus, Gift, Lock, Minus, PackageOpen, PauseCircle, Percent, Plus, ScanLine, ShoppingCart, Trash2, X } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import {
  useBundleRules, useCategories, useEventProducts, usePaymentMethods, useProducts, useSales, useSessions, useSettingRows, useStockMoves,
} from '../../hooks/data';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { settingValue } from '../../db/settings';
import { Dialog } from '../../components/Dialog';
import { Badge, Button, Callout, EmptyState, IconButton, Segmented } from '../../components/ui';
import { Field, MoneyInput, NumberInput, SearchInput, TextInput } from '../../components/form';
import { peso, percentOf, type Cents } from '../../lib/money';
import { fmtTime, relativeTime } from '../../lib/time';
import { uid } from '../../lib/ids';
import { priceCart, type CartDiscount, type PricedCart } from '../../domain/cart';
import { onHandByProduct, soldByProduct } from '../../domain/stock';
import { effectivePrice, findByCode, isOnSale, setEventProduct, updateProduct } from '../../services/catalog';
import { completeSale, openSession } from '../../services/sales';
import { updateEvent } from '../../services/events';
import { useCart, type CartApi, type CartState } from './useCart';
import { PaymentDialog } from './PaymentDialog';
import { ReceiptDialog } from './ReceiptDialog';
import { CashMoveDialog, CloseRegisterDialog } from './SessionDialogs';
import { CameraScanner } from '../../barcode/CameraScanner';
import { useWedgeScanner } from '../../barcode/useWedgeScanner';
import type { BusinessSettings, JWEvent, Product, Sale, Session } from '../../db/types';
import './register.css';

export function RegisterPage() {
  const app = useApp();
  const ev = app.activeEvent;
  const navigate = useNavigate();

  if (ev === undefined) return <div className="loading">Loading…</div>;
  if (!ev) {
    return (
      <div className="page narrow">
        <EmptyState
          icon={<CalendarPlus size={48} />}
          title="Pick an event to start selling"
          action={
            app.can('manageEvents') ? (
              <Button variant="primary" onClick={() => navigate('/events?new=1')}>
                Create an event
              </Button>
            ) : undefined
          }
        >
          Every sale belongs to an event, so its report, booth spend and payouts stay together.
        </EmptyState>
      </div>
    );
  }
  if (ev.status === 'closed' || ev.status === 'reported') {
    return (
      <div className="page narrow">
        <EmptyState icon={<Lock size={48} />} title={`${ev.name} is ${ev.status === 'closed' ? 'closed' : 'reported'}`} action={
          app.can('manageEvents') ? (
            <Button onClick={() => updateEvent(ev.id, { status: 'live' })}>Reopen it for selling</Button>
          ) : undefined
        }>
          Closed events keep their sales but don&rsquo;t take new ones.
        </EmptyState>
      </div>
    );
  }
  return <Register key={ev.id} ev={ev} />;
}

function Register({ ev }: { ev: JWEvent }) {
  const app = useApp();
  const products = useProducts();
  const categories = useCategories();
  const eps = useEventProducts(ev.id);
  const rules = useBundleRules();
  const methods = usePaymentMethods();
  const sales = useSales(ev.id);
  const sessions = useSessions(ev.id);
  const moves = useStockMoves();
  const settingRows = useSettingRows();
  const held = useLiveQuery(() => db.heldSales.where('eventId').equals(ev.id).toArray(), [ev.id]);
  const business = settingValue<BusinessSettings>(settingRows, 'business');
  const cart = useCart(ev.id);

  const [search, setSearch] = useState('');
  const [cat, setCat] = useState<string>('all');
  const [paying, setPaying] = useState(false);
  const [receipt, setReceipt] = useState<Sale | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [cashMove, setCashMove] = useState(false);
  const [closingSession, setClosingSession] = useState<Session | null>(null);
  const [heldOpen, setHeldOpen] = useState(false);
  const [phoneCart, setPhoneCart] = useState(false);
  const [lineKey, setLineKey] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [priceFor, setPriceFor] = useState<Product | null>(null);
  const [showUnpriced, setShowUnpriced] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const session = sessions?.find((s) => s.deviceId === app.device.deviceId && s.closedAt === null);
  const epMap = useMemo(() => new Map((eps ?? []).map((e) => [e.productId, e])), [eps]);
  const sold = useMemo(() => soldByProduct(sales ?? []), [sales]);
  const onHand = useMemo(() => onHandByProduct(moves ?? []), [moves]);
  const hasStockData = useMemo(() => new Set((moves ?? []).map((m) => m.productId)), [moves]);
  const activeRules = useMemo(() => (rules ?? []).filter((r) => r.active === 1 && (r.eventId === null || r.eventId === ev.id)), [rules, ev.id]);
  const eventMethods = useMemo(
    () => ev.paymentMethodIds.map((id) => (methods ?? []).find((m) => m.id === id)).filter((m): m is NonNullable<typeof m> => !!m && m.active === 1 && m.deleted !== 1),
    [ev.paymentMethodIds, methods],
  );
  const onSale = useMemo(() => (products ?? []).filter((p) => isOnSale(p, epMap.get(p.id))), [products, epMap]);
  const usedCats = useMemo(() => (categories ?? []).filter((c) => onSale.some((p) => p.categoryId === c.id)), [categories, onSale]);

  const matching = useMemo(() => {
    const q = search.trim().toLowerCase();
    return onSale.filter(
      (p) =>
        (cat === 'all' || p.categoryId === cat) &&
        (!q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || p.barcode.toLowerCase() === q),
    );
  }, [onSale, search, cat]);
  const shown = useMemo(() => matching.filter((p) => effectivePrice(p, epMap.get(p.id)) !== null), [matching, epMap]);
  const unpriced = useMemo(() => matching.filter((p) => effectivePrice(p, epMap.get(p.id)) === null), [matching, epMap]);

  const discounts: CartDiscount[] = useMemo(
    () => [
      ...ev.discounts.filter((d) => cart.state.presetIds.includes(d.id)).map((d) => ({ id: d.id, label: d.label, kind: d.kind, value: d.kind === 'amount' ? d.value : d.value })),
      ...cart.state.custom,
    ],
    [ev.discounts, cart.state.presetIds, cart.state.custom],
  );
  const priced = useMemo(() => priceCart(cart.state.items, activeRules, discounts), [cart.state.items, activeRules, discounts]);

  const stockLeft = useCallback(
    (p: Product): number | null => {
      if (p.trackStock !== 1) return null;
      const ep = epMap.get(p.id);
      const soldHere = sold.get(p.id) ?? 0;
      const inCart = cart.state.items.filter((i) => i.productId === p.id).reduce((a, i) => a + i.qty, 0);
      if (ep && ep.stockBrought !== null) return ep.stockBrought - soldHere - inCart;
      // No count entered yet: don't claim it's out of stock.
      if (!hasStockData.has(p.id)) return null;
      return (onHand.get(p.id) ?? 0) - inCart;
    },
    [epMap, sold, onHand, hasStockData, cart.state.items],
  );

  const addProduct = useCallback(
    (p: Product) => {
      const price = effectivePrice(p, epMap.get(p.id));
      if (price === null) {
        if (app.can('editPrices')) setPriceFor(p);
        else app.toast(`${p.name} has no price yet. Ask the owner to set one.`, { tone: 'bad' });
        return;
      }
      cart.add(p, price);
    },
    [epMap, cart, app],
  );

  const onCode = useCallback(
    async (code: string) => {
      const p = await findByCode(code);
      if (!p || !isOnSale(p, epMap.get(p.id))) {
        app.toast(`No product on sale with code ${code}`, { tone: 'bad' });
        return;
      }
      addProduct(p);
      app.toast(`Added ${p.name}`, { ms: 1400 });
    },
    [addProduct, app, epMap],
  );
  useWedgeScanner(onCode, !!session && !paying && !receipt);

  const pay = async (payments: Parameters<typeof completeSale>[0]['payments']) => {
    if (!session) return;
    const sale = await completeSale({ eventId: ev.id, session, device: app.device, cashierId: app.member?.id ?? null, priced, payments, note: cart.state.note });
    if (ev.status === 'planning') await updateEvent(ev.id, { status: 'live' });
    cart.clear();
    setPaying(false);
    setPhoneCart(false);
    setReceipt(sale);
  };

  const holdSale = async () => {
    if (!cart.state.items.length) return;
    const label = priced.lines.map((l) => `${l.qty} × ${l.name}`).slice(0, 3).join(', ');
    await db.heldSales.put({ id: uid(), eventId: ev.id, at: Date.now(), label, cart: cart.state });
    cart.clear();
    app.toast('Sale on hold. Find it under Held sales.', { tone: 'good' });
  };

  const clearCart = async () => {
    if (!cart.state.items.length) return;
    if (await app.confirm({ title: 'Clear this sale?', message: 'Everything in the cart will be removed.', confirmLabel: 'Clear', tone: 'danger' })) cart.clear();
  };

  const togglePreset = async (id: string) => {
    const d = ev.discounts.find((x) => x.id === id);
    if (!d) return;
    if (!cart.state.presetIds.includes(id) && d.needsPin && !(await app.askOwner(`Apply ${d.label}`))) return;
    cart.togglePreset(id);
  };

  const closeDialog = closingSession ? (
    <CloseRegisterDialog session={closingSession} sales={sales ?? []} open onClose={() => setClosingSession(null)} />
  ) : null;

  // The close dialog sits in the same place whether or not the register is open,
  // so its result stays on screen after the session closes.
  if (!session)
    return (
      <>
        <OpenRegister ev={ev} />
        {closeDialog}
      </>
    );
  const cartPanel = (
    <CartPanel
      priced={priced}
      cart={cart}
      ev={ev}
      onCharge={() => setPaying(true)}
      onHold={holdSale}
      onClear={clearCart}
      onLine={(k) => setLineKey(k)}
      onCustom={() => setCustomOpen(true)}
      onTogglePreset={togglePreset}
    />
  );

  return (
    <>
    <div className="register">
      <section className="reg-left" aria-label="Products">
        <div className="reg-toolbar">
          <div className="row wrap between">
            <div className="reg-session">
              <b>Register {session.letter}</b>
              <span className="muted small">
                Opened {fmtTime(session.openedAt)} · float {peso(session.openingFloat)}
              </span>
            </div>
            <div className="actions">
              {held && held.length ? (
                <Button size="sm" onClick={() => setHeldOpen(true)}>
                  <PauseCircle size={16} /> Held ({held.length})
                </Button>
              ) : null}
              <Button size="sm" onClick={() => setCashMove(true)}>
                <ArrowDownUp size={16} /> Cash in/out
              </Button>
              <Button size="sm" onClick={() => setClosingSession(session)}>
                <Lock size={16} /> Close register
              </Button>
            </div>
          </div>
          <div className="row">
            <div className="grow">
              <SearchInput
                inputRef={searchRef}
                value={search}
                onChange={setSearch}
                placeholder="Search or type a code"
                ariaLabel="Search products or type a barcode"
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  const q = search.trim();
                  if (!q) return;
                  e.preventDefault();
                  const exact = onSale.find((p) => p.barcode.toLowerCase() === q.toLowerCase() || p.sku.toLowerCase() === q.toLowerCase());
                  const target = exact ?? (shown.length === 1 ? shown[0] : null);
                  if (target) {
                    addProduct(target);
                    setSearch('');
                  } else void onCode(q).then(() => setSearch(''));
                }}
              />
            </div>
            <Button onClick={() => setScanOpen(true)} aria-label="Scan with the camera">
              <ScanLine size={18} /> <span className="hide-phone">Scan</span>
            </Button>
          </div>
          {usedCats.length > 1 ? (
            <div className="chip-row cats" role="group" aria-label="Categories">
              <button type="button" className="chip" aria-pressed={cat === 'all'} onClick={() => setCat('all')}>
                All
              </button>
              {usedCats.map((c) => (
                <button key={c.id} type="button" className="chip" aria-pressed={cat === c.id} onClick={() => setCat(c.id)}>
                  {c.name}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="reg-grid">
          {shown.map((p) => {
            const price = effectivePrice(p, epMap.get(p.id));
            const left = stockLeft(p);
            const deal = activeRules.find((r) => r.productIds.includes(p.id));
            return (
              <button key={p.id} type="button" className={`tile ${price === null ? 'noprice' : ''}`} onClick={() => addProduct(p)}>
                <b className="name">{p.name}</b>
                <span className="meta">
                  {deal ? <span className="deal">{deal.qty} for {peso(deal.price)}</span> : null}
                  {left !== null ? <span className={`stock ${left <= 0 ? 'out' : left <= 3 ? 'low' : ''}`}>{left <= 0 ? 'Out of stock' : `${left} left`}</span> : null}
                </span>
                <span className="price">{price === null ? 'No price yet' : peso(price)}</span>
              </button>
            );
          })}
          {shown.length === 0 ? (
            <div style={{ gridColumn: '1 / -1' }}>
              <EmptyState icon={<PackageOpen size={40} />} title={matching.length ? 'No prices set yet' : onSale.length ? 'Nothing matches' : 'No products on sale yet'}>
                {matching.length
                  ? 'Set prices for this event in Event → Edit prices, or tap a product below to price it now.'
                  : onSale.length
                    ? 'Try another search or category.'
                    : 'Add products in Products, then set prices for this event.'}
              </EmptyState>
            </div>
          ) : null}
          {unpriced.length && app.can('editPrices') ? (
            <div style={{ gridColumn: '1 / -1' }}>
              <button type="button" className="btn ghost sm" onClick={() => setShowUnpriced((v) => !v)} aria-expanded={showUnpriced}>
                {showUnpriced ? 'Hide' : 'Show'} {unpriced.length} product{unpriced.length === 1 ? '' : 's'} without a price
              </button>
            </div>
          ) : null}
          {showUnpriced && app.can('editPrices')
            ? unpriced.map((p) => (
                <button key={p.id} type="button" className="tile noprice" onClick={() => addProduct(p)}>
                  <b className="name">{p.name}</b>
                  <span className="price">Tap to set a price</span>
                </button>
              ))
            : null}
        </div>
      </section>

      <aside className="reg-cart" aria-label="Current sale">
        {cartPanel}
      </aside>

      <div className="phone-cartbar">
        <button type="button" className="pcb-summary" onClick={() => setPhoneCart(true)} aria-label="Open the cart">
          <ShoppingCart size={20} />
          <span>
            <b>{priced.itemCount} item{priced.itemCount === 1 ? '' : 's'}</b>
            <span className="muted small"> · view cart</span>
          </span>
        </button>
        <Button variant="primary" size="lg" disabled={!priced.lines.length} onClick={() => setPaying(true)}>
          Charge {peso(priced.total)}
        </Button>
      </div>

      <Dialog open={phoneCart} onClose={() => setPhoneCart(false)} title="Current sale" fullPhone>
        <div className="phone-cart">{cartPanel}</div>
      </Dialog>

      <PaymentDialog open={paying} onClose={() => setPaying(false)} total={priced.total} methods={eventMethods} onPay={pay} />
      <ReceiptDialog
        sale={receipt}
        business={business}
        eventName={ev.name}
        onClose={() => {
          setReceipt(null);
          searchRef.current?.focus({ preventScroll: true });
        }}
      />
      <CameraScanner open={scanOpen} onClose={() => setScanOpen(false)} onCode={(c) => void onCode(c)} />
      <CashMoveDialog session={session} open={cashMove} onClose={() => setCashMove(false)} />
      <HeldSalesDialog open={heldOpen} onClose={() => setHeldOpen(false)} held={held ?? []} cart={cart} />
      <LineDialog lineKey={lineKey} onClose={() => setLineKey(null)} cart={cart} />
      <CustomDiscountDialog open={customOpen} onClose={() => setCustomOpen(false)} ev={ev} cart={cart} base={priced.subtotal - priced.bundleTotal} />
      <QuickPriceDialog product={priceFor} ev={ev} onClose={() => setPriceFor(null)} onPriced={(p, price) => cart.add(p, price)} />
    </div>
    {closeDialog}
    </>
  );
}

function CartPanel({
  priced,
  cart,
  ev,
  onCharge,
  onHold,
  onClear,
  onLine,
  onCustom,
  onTogglePreset,
}: {
  priced: PricedCart;
  cart: CartApi;
  ev: JWEvent;
  onCharge: () => void;
  onHold: () => void;
  onClear: () => void;
  onLine: (key: string) => void;
  onCustom: () => void;
  onTogglePreset: (id: string) => void;
}) {
  const empty = priced.lines.length === 0;
  return (
    <div className="cart">
      <div className="cart-head">
        <h2>Current sale</h2>
        <div className="actions">
          <IconButton label="Put this sale on hold" size="sm" onClick={onHold} disabled={empty}>
            <PauseCircle size={18} />
          </IconButton>
          <IconButton label="Clear the sale" size="sm" onClick={onClear} disabled={empty}>
            <Trash2 size={18} />
          </IconButton>
        </div>
      </div>
      <div className="cart-lines">
        {empty ? (
          <div className="cart-empty">
            <ShoppingCart size={36} aria-hidden="true" />
            <p>Tap a product or scan a code to start a sale.</p>
          </div>
        ) : (
          priced.lines.map((l) => (
            <div key={l.key} className="cart-line">
              <button type="button" className="cl-main" onClick={() => onLine(l.key)} aria-label={`Edit ${l.name}`}>
                <b>{l.name}</b>
                <span className="muted small">
                  {l.free ? (
                    <span className="good strong">
                      <Gift size={12} /> Free{l.freeReason ? `: ${l.freeReason}` : ''}
                    </span>
                  ) : (
                    `${peso(l.unitPrice)} each`
                  )}
                  {l.bundleOff ? <span className="good"> · bundle −{peso(l.bundleOff)}</span> : null}
                </span>
              </button>
              <div className="qty" role="group" aria-label={`Quantity of ${l.name}`}>
                <button type="button" aria-label="One less" onClick={() => cart.setQty(l.key, l.qty - 1)}>
                  <Minus size={16} />
                </button>
                <span className="num">{l.qty}</span>
                <button type="button" aria-label="One more" onClick={() => cart.setQty(l.key, l.qty + 1)}>
                  <Plus size={16} />
                </button>
              </div>
              <span className="cl-total num">{l.free ? 'Free' : peso(l.gross)}</span>
            </div>
          ))
        )}
      </div>
      <div className="cart-foot">
        {ev.discounts.length || !empty ? (
          <div className="chip-row">
            {ev.discounts.map((d) => (
              <button key={d.id} type="button" className="chip" aria-pressed={cart.state.presetIds.includes(d.id)} onClick={() => onTogglePreset(d.id)} disabled={empty}>
                <Percent size={14} /> {d.label}
              </button>
            ))}
            <button type="button" className="chip" onClick={onCustom} disabled={empty}>
              <Plus size={14} /> Discount
            </button>
          </div>
        ) : null}
        <div className="cart-sums">
          <div className="row between small">
            <span>Subtotal</span>
            <span className="num">{peso(priced.subtotal)}</span>
          </div>
          {priced.bundles.map((b) => (
            <div key={b.ruleId} className="row between small good">
              <span>
                {b.name}
                {b.times > 1 ? ` ×${b.times}` : ''}
              </span>
              <span className="num">−{peso(b.savings)}</span>
            </div>
          ))}
          {priced.discounts.map((d) => (
            <div key={d.id} className="row between small good">
              <span className="row" style={{ gap: 4 }}>
                {d.label}
                {cart.state.custom.some((c) => c.id === d.id) ? (
                  <button type="button" className="icon-btn plain sm" aria-label={`Remove ${d.label}`} onClick={() => cart.removeCustom(d.id)}>
                    <X size={14} />
                  </button>
                ) : null}
              </span>
              <span className="num">−{peso(d.amount)}</span>
            </div>
          ))}
          <div className="row between total-row">
            <span>Total</span>
            <span className="num">{peso(priced.total)}</span>
          </div>
        </div>
        <TextInput aria-label="Note for this sale" placeholder="Note (optional)" value={cart.state.note} onChange={(e) => cart.setNote(e.target.value)} />
        <Button variant="primary" size="lg" block className="charge-btn" disabled={empty} onClick={onCharge}>
          Charge {peso(priced.total)}
        </Button>
      </div>
    </div>
  );
}

function OpenRegister({ ev }: { ev: JWEvent }) {
  const app = useApp();
  const [float, setFloat] = useState<Cents | null>(ev.openingFloat);
  const [busy, setBusy] = useState(false);
  const open = async () => {
    setBusy(true);
    await openSession(ev.id, app.device, float ?? 0, app.member?.id ?? null);
    if (ev.status === 'planning') await updateEvent(ev.id, { status: 'live' });
    setBusy(false);
  };
  return (
    <div className="page narrow">
      <div className="card pad-lg stack">
        <span className="eyebrow">{ev.name}</span>
        <h1>Open register {app.device.letter}</h1>
        <p className="muted">Count the cash you&rsquo;re starting with. It&rsquo;s the float the drawer is checked against when you close.</p>
        {ev.status === 'planning' ? <Callout tone="info">Opening the register marks {ev.name} as Live.</Callout> : null}
        <Field label="Opening cash float" htmlFor="float">
          <MoneyInput id="float" large value={float} onChange={setFloat} onEnter={open} autoFocus />
        </Field>
        <Button variant="primary" size="lg" disabled={busy} onClick={open}>
          Open register
        </Button>
      </div>
    </div>
  );
}

function HeldSalesDialog({ open, onClose, held, cart }: { open: boolean; onClose: () => void; held: { id: string; at: number; label: string; cart: unknown }[]; cart: CartApi }) {
  const app = useApp();
  const restore = async (h: (typeof held)[number]) => {
    if (cart.state.items.length) {
      const ok = await app.confirm({ title: 'Replace the current sale?', message: 'The items in the cart now will be removed.', confirmLabel: 'Replace' });
      if (!ok) return;
    }
    cart.replace(h.cart as CartState);
    await db.heldSales.delete(h.id);
    onClose();
  };
  return (
    <Dialog open={open} onClose={onClose} title="Held sales">
      {held.length === 0 ? <p className="muted">No sales on hold.</p> : null}
      <div className="card flush">
        <div className="list">
          {held.map((h) => (
            <div key={h.id} className="list-item">
              <PauseCircle size={20} className="muted" />
              <span className="main-text">
                <b>{h.label}</b>
                <span>Held {relativeTime(h.at)}</span>
              </span>
              <Button size="sm" variant="teal" onClick={() => restore(h)}>
                Resume
              </Button>
              <IconButton label="Delete held sale" size="sm" onClick={() => db.heldSales.delete(h.id)}>
                <Trash2 size={16} />
              </IconButton>
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  );
}

function LineDialog({ lineKey, onClose, cart }: { lineKey: string | null; onClose: () => void; cart: CartApi }) {
  const app = useApp();
  const line = cart.state.items.find((i) => i.key === lineKey);
  const [reason, setReason] = useState('');
  useEffect(() => setReason(line?.freeReason ?? ''), [lineKey]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!line) return null;
  return (
    <Dialog
      open={!!line}
      onClose={onClose}
      title={line.name}
      size="sm"
      footer={
        <>
          <Button
            variant="danger"
            onClick={() => {
              cart.remove(line.key);
              onClose();
            }}
          >
            Remove
          </Button>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <Field label="Quantity" htmlFor="line-qty">
        <NumberInput id="line-qty" decimals={false} min={1} value={line.qty} onChange={(n) => n && n > 0 && cart.setQty(line.key, n)} />
      </Field>
      <div className="stack tight">
        <h3>Give it for free</h3>
        <p className="muted small">For giveaways and freebies. It&rsquo;s counted as a free item in the report.</p>
        {line.free ? (
          <Button onClick={() => cart.setFree(line.key, false)}>Charge for it again</Button>
        ) : (
          <div className="row">
            <TextInput aria-label="Reason" placeholder="Reason, e.g. Passport prize" value={reason} onChange={(e) => setReason(e.target.value)} />
            <Button
              onClick={async () => {
                if (!(await app.askOwner(`Give ${line.name} for free`))) return;
                cart.setFree(line.key, true, reason.trim());
              }}
            >
              <Gift size={16} /> Free
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  );
}

function CustomDiscountDialog({ open, onClose, ev, cart, base }: { open: boolean; onClose: () => void; ev: JWEvent; cart: CartApi; base: Cents }) {
  const app = useApp();
  const [kind, setKind] = useState<'amount' | 'percent'>('amount');
  const [amount, setAmount] = useState<Cents | null>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [label, setLabel] = useState('Discount');
  useEffect(() => {
    if (open) {
      setAmount(null);
      setPct(null);
      setLabel('Discount');
      setKind('amount');
    }
  }, [open]);
  const value = kind === 'amount' ? (amount ?? 0) : percentOf(base, pct ?? 0);
  const overLimit = base > 0 && value > percentOf(base, ev.cashierDiscountLimitPct);
  const apply = async () => {
    if (value <= 0) return;
    if (overLimit && !(await app.askOwner(`A discount over ${ev.cashierDiscountLimitPct}%`))) return;
    cart.addCustom({ id: uid(), label: label.trim() || 'Discount', kind, value: kind === 'amount' ? (amount ?? 0) : (pct ?? 0), manual: true });
    onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add a discount"
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={value <= 0} onClick={apply}>
            Apply {value > 0 ? `−${peso(value)}` : ''}
          </Button>
        </>
      }
    >
      <Segmented label="Discount type" full value={kind} onChange={setKind} options={[{ value: 'amount', label: 'Pesos off' }, { value: 'percent', label: '% off' }]} />
      {kind === 'amount' ? (
        <Field label="Amount off" htmlFor="disc-amt">
          <MoneyInput id="disc-amt" value={amount} onChange={setAmount} autoFocus onEnter={apply} />
        </Field>
      ) : (
        <Field label="Percent off" htmlFor="disc-pct">
          <NumberInput id="disc-pct" value={pct} onChange={setPct} suffix="%" autoFocus />
        </Field>
      )}
      <Field label="Label on the receipt" htmlFor="disc-label">
        <TextInput id="disc-label" value={label} onChange={(e) => setLabel(e.target.value)} />
      </Field>
      {overLimit && app.role !== 'owner' ? <Callout tone="warn">This is over the {ev.cashierDiscountLimitPct}% cashier limit, so it needs the owner PIN.</Callout> : null}
    </Dialog>
  );
}

function QuickPriceDialog({ product, ev, onClose, onPriced }: { product: Product | null; ev: JWEvent; onClose: () => void; onPriced: (p: Product, price: Cents) => void }) {
  const [price, setPrice] = useState<Cents | null>(null);
  useEffect(() => setPrice(null), [product]);
  if (!product) return null;
  const done = async (scope: 'event' | 'base') => {
    if (price === null) return;
    if (scope === 'event') await setEventProduct(ev.id, product.id, { price });
    else await updateProduct(product.id, { price });
    onPriced(product, price);
    onClose();
  };
  return (
    <Dialog
      open={!!product}
      onClose={onClose}
      title={`Price for ${product.name}`}
      size="sm"
      footer={
        <>
          <Button onClick={() => done('base')} disabled={price === null}>
            Save as base price
          </Button>
          <Button variant="primary" onClick={() => done('event')} disabled={price === null}>
            Use at this event
          </Button>
        </>
      }
    >
      <p className="muted small">This product has no price yet. The base price carries over to future events; an event price applies only to {ev.name}.</p>
      <Field label="Price" htmlFor="qp-price">
        <MoneyInput id="qp-price" large value={price} onChange={setPrice} autoFocus onEnter={() => done('event')} />
      </Field>
      <Badge tone="outline">{product.sku || product.barcode}</Badge>
    </Dialog>
  );
}
