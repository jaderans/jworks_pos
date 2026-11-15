import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { ArrowDownUp, CalendarPlus, Camera, Disc3, Gift, Lock, Minus, Monitor, Search, PackageOpen, PauseCircle, Percent, Plus, ScanLine, ShoppingCart, Ticket, Trash2, UserPlus, UserRound, X } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import {
  useBundleRules, useCategories, useCustomerSales, useCustomers, useEventProducts, usePaymentMethods, useProducts, useSales, useSessions, useSettingRows,
  useSaleCoupon, useStockMoves, useVoucherSales, useVouchers, useLocal } from '../../hooks/data';
import { useLiveQuery } from 'dexie-react-hooks';
import { alive, db } from '../../db/db';
import { settingValue } from '../../db/settings';
import { Dialog } from '../../components/Dialog';
import { Badge, Button, Callout, EmptyState, IconButton, Segmented } from '../../components/ui';
import { Field, MoneyInput, NumberInput, SearchInput, TextInput } from '../../components/form';
import { peso, percentOf, type Cents } from '../../lib/money';
import { fmtTime, relativeTime, todayISO } from '../../lib/time';
import { uid } from '../../lib/ids';
import { priceCart, type CartDiscount, type PricedCart } from '../../domain/cart';
import { onHandByProduct, soldByProduct } from '../../domain/stock';
import { checkVoucher, loyaltyDiscount, loyaltyState, normalizeCode, rewardText, type LoyaltyState, type VoucherCheck } from '../../domain/loyalty';
import { displayCart, emptyDisplayCart, type DisplayState, type DisplayWheel } from '../../domain/display';
import { offText, termsText } from '../../domain/coupons';
import { displaySender, type DisplaySender, type ScreenStatus } from '../../display/channel';
import { playLanding, playSpin, unlockAudio } from '../../display/sound';
import { wheelSoundChoice } from '../../display/wheelSounds';
import { DEFAULT_DISPLAY, type DisplaySettings } from '../../display/slides';
import { SPIN_MS } from '../../domain/wheelSpin';
import { DEFAULT_STICK, packOf, type StickSettings } from '../../domain/stick';
import { StickDialog } from '../stick/StickDialog';
import { StubsDialog, type StubOrder } from '../stick/Stubs';
import type { DisplayStick } from '../../domain/display';
import { openCustomerScreen, useSecondScreen } from '../../display/screens';
import { pickText, spinNudge, spinsLeft, wheelQualifies, wheelSlices } from '../../domain/wheel';
import { spinWheel, type Spin } from '../../services/wheel';
import { effectivePrice, findByCode, isOnSale, setEventProduct, updateProduct } from '../../services/catalog';
import { completeSale, openSession } from '../../services/sales';
import { issueEarnedCoupon } from '../../services/coupons';
import { updateEvent } from '../../services/events';
import { useCart, type CartApi, type CartState } from './useCart';
import { PaymentDialog } from './PaymentDialog';
import { ReceiptDialog, receiptText } from './ReceiptDialog';
import { CashMoveDialog, CloseRegisterDialog } from './SessionDialogs';
import { CustomerPicker } from './CustomerPicker';
import { FindOrderDialog } from '../orders/FindOrderDialog';
import { DealsReview, PriceReview } from './PriceReview';
import { CameraScanner } from '../../barcode/CameraScanner';
import { useWedgeScanner } from '../../barcode/useWedgeScanner';
import type { BusinessSettings, Customer, JWEvent, LoyaltySettings, Product, Sale, Session, Order } from '../../db/types';
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
  const navigate = useNavigate();
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
  const stickSettings: StickSettings = { ...DEFAULT_STICK, ...settingValue<Partial<StickSettings>>(settingRows, 'stick') };
  /** The sale whose Couple-of-Stickers details are being filled in. */
  const [stickFor, setStickFor] = useState<Sale | null>(null);
  /** What the customer screen shows of it: the draft, then the saved order with its number. */
  const [stickView, setStickView] = useState<DisplayStick | null>(null);
  const [stickOrder, setStickOrder] = useState<Order | null>(null);
  /** A saved order whose details are open again (back from the photo booth): the dialog edits it, never makes another. */
  const [stickEdit, setStickEdit] = useState<Order | null>(null);
  const [stubsFor, setStubsFor] = useState<StubOrder | null>(null);
  const hasPacks = (sale: Sale) => {
    const byId = new Map((products ?? []).map((p) => [p.id, p]));
    return sale.lines.some((l) => {
      const p = byId.get(l.productId);
      return !!p && !!packOf(p, stickSettings);
    });
  };
  const loyaltyRules = settingValue<LoyaltySettings>(settingRows, 'loyalty');
  const cart = useCart(ev.id);
  const customers = useCustomers();
  const customerSales = useCustomerSales();
  const vouchers = useVouchers();
  const voucherSales = useVoucherSales(cart.state.voucherCode);

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
  const [customerOpen, setCustomerOpen] = useState(false);
  const [voucherOpen, setVoucherOpen] = useState(false);
  const [payWith, setPayWith] = useState<string[]>([]);
  const [spin, setSpin] = useState<(Spin & { id: string; sound: DisplayWheel['sound']; landsAt: number }) | null>(null);
  const [spinning, setSpinning] = useState(false);
  /** The wheel is up on the customer screen, waiting for the customer to tap it. */
  const [invite, setInvite] = useState<{ id: string; saleId: string; sound: DisplayWheel['sound']; left: number } | null>(null);
  /** Couple-of-Stickers packs won on the wheel, waiting for their details until the sale's last spin lands. */
  const wonPacks = useRef<Sale[]>([]);
  const [landedTick, setLandedTick] = useState(0);
  const displaySaved = useLocal<Partial<DisplaySettings>>('display', DEFAULT_DISPLAY);
  const displaySettings: DisplaySettings = { ...DEFAULT_DISPLAY, ...(displaySaved ?? {}) };
  const [findOpen, setFindOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const secondScreen = useSecondScreen();
  const earned = useSaleCoupon(receipt?.id);

  const session = sessions?.find((s) => s.deviceId === app.device.deviceId && s.closedAt === null);

  // Back from the photo booth (or sent from the Sales log): that sale's receipt again, with its wheel
  // still to spin and its Couple-of-Stickers order; `stick` opens the order's details too.
  const [params, setParams] = useSearchParams();
  const backTo = params.get('sale');
  const backStick = params.get('stick');
  useEffect(() => {
    if (!backTo || !session) return;
    setParams({}, { replace: true });
    void (async () => {
      const paid = await db.sales.get(backTo);
      if (!paid || paid.deleted === 1 || paid.eventId !== ev.id) return;
      // A pack won on the wheel was paid by a ₱0 prize sale: the receipt is the sale that spun.
      const sale = paid.prizeFor ? ((await db.sales.get(paid.prizeFor)) ?? paid) : paid;
      setReceipt(sale);
      const orders = alive(await db.orders.where('eventId').equals(ev.id).toArray());
      const own = orders.find((o) => o.stick?.saleId === sale.id);
      if (own?.stick) {
        setStickOrder(own);
        setStickView({ number: own.number, nickname: own.stick.nickname, packs: own.stick.packs, addOns: own.stick.addOns, readyFrom: own.stick.readyFrom, readyTo: own.stick.readyTo, photo: own.stick.photo, paid: own.stick.paid, paidWith: own.stick.paidWith });
      }
      const open = backStick ? orders.find((o) => o.id === backStick) : undefined;
      if (open?.stick) {
        setStickEdit(open);
        setStickFor(open.id === own?.id ? sale : paid);
      }
    })();
  }, [backTo, session?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const epMap = useMemo(() => new Map((eps ?? []).map((e) => [e.productId, e])), [eps]);
  const sold = useMemo(() => soldByProduct(sales ?? []), [sales]);
  const onHand = useMemo(() => onHandByProduct(moves ?? []), [moves]);
  // Counted means a batch, an opening count or an adjustment; sales alone don't make a product "out of stock".
  const hasStockData = useMemo(() => new Set((moves ?? []).filter((m) => m.kind !== 'sale' && m.kind !== 'void').map((m) => m.productId)), [moves]);
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

  const customer = useMemo(() => (customers ?? []).find((c) => c.id === cart.state.customerId) ?? null, [customers, cart.state.customerId]);
  const loyalty = useMemo(
    () => (customer && loyaltyRules.enabled ? loyaltyState(customer.id, customerSales ?? [], loyaltyRules) : null),
    [customer, customerSales, loyaltyRules],
  );
  // What the cart costs after bundle deals: vouchers check their minimum spend against it.
  const base = useMemo(() => {
    const p = priceCart(cart.state.items, activeRules, []);
    return p.subtotal - p.bundleTotal;
  }, [cart.state.items, activeRules]);
  const voucherCheck = useMemo<VoucherCheck | null>(() => {
    const code = cart.state.voucherCode;
    if (!code) return null;
    return checkVoucher((vouchers ?? []).find((v) => v.code === code), {
      code,
      today: todayISO(),
      eventId: ev.id,
      base,
      customerId: cart.state.customerId,
      sales: voucherSales ?? [],
    });
  }, [cart.state.voucherCode, cart.state.customerId, vouchers, voucherSales, base, ev.id]);
  const rewardOn = cart.state.useReward && !!loyalty && loyalty.rewards > 0;

  const discounts: CartDiscount[] = useMemo(
    () => [
      ...ev.discounts.filter((d) => cart.state.presetIds.includes(d.id)).map((d) => ({ id: d.id, label: d.label, kind: d.kind, value: d.kind === 'amount' ? d.value : d.value })),
      ...cart.state.custom,
      ...(voucherCheck?.ok ? [voucherCheck.discount] : []),
      ...(rewardOn ? [loyaltyDiscount(loyaltyRules)] : []),
    ],
    [ev.discounts, cart.state.presetIds, cart.state.custom, voucherCheck, rewardOn, loyaltyRules],
  );
  const priced = useMemo(() => priceCart(cart.state.items, activeRules, discounts), [cart.state.items, activeRules, discounts]);

  /** Check a typed code before it goes on the sale. */
  const checkCode = useCallback(
    async (typed: string): Promise<VoucherCheck> => {
      const code = normalizeCode(typed);
      const [v] = alive(await db.vouchers.where('code').equals(code).toArray());
      const used = alive(await db.sales.where('voucherCode').equals(code).toArray());
      return checkVoucher(v, { code, today: todayISO(), eventId: ev.id, base, customerId: cart.state.customerId, sales: used });
    },
    [ev.id, base, cart.state.customerId],
  );

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
    const sale = await completeSale({
      eventId: ev.id,
      session,
      device: app.device,
      cashierId: app.member?.id ?? null,
      priced,
      payments,
      note: cart.state.note,
      customerId: cart.state.customerId,
      voucherCode: voucherCheck?.ok ? cart.state.voucherCode : undefined,
    });
    // A big enough sale earns a service coupon; it shows on the receipt. It never holds up the sale.
    await issueEarnedCoupon(sale).catch(() => null);
    if (ev.status === 'planning') await updateEvent(ev.id, { status: 'live' });
    cart.clear();
    setPaying(false);
    setPhoneCart(false);
    setReceipt(sale);
    // Couple-of-Stickers: the details for the stubs, straight away.
    if (hasPacks(sale)) setStickFor(sale);
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

  // What the customer screen shows, sent on every change.
  const display = useMemo<DisplayState>(() => {
    const base = { v: 1 as const, eventId: ev.id, business: business.name || 'JoshWorks', eventName: ev.name };
    if (!session) return { ...base, mode: 'closed', cart: emptyDisplayCart(), customer: null, pay: null, thanks: null };
    const cartView = displayCart(priced, activeRules);
    const who = customer
      ? { name: customer.name, loyalty: loyalty && loyaltyRules.enabled ? (loyalty.rewards ? `${rewardText(loyaltyRules)} ready to use` : `${loyalty.balance} stamp${loyalty.balance === 1 ? '' : 's'} · ${loyalty.toNext} more for ${rewardText(loyaltyRules)}`) : null }
      : null;
    // Another spin waiting for their tap (the first, or the next one).
    if (receipt && invite && ev.wheel) {
      return {
        ...base,
        mode: 'wheel',
        cart: cartView,
        customer: who,
        pay: null,
        thanks: null,
        wheel: { id: invite.id, slices: wheelSlices(ev.wheel), waiting: true, turn: 0, won: false, label: '', detail: '', sound: invite.sound, more: invite.left - 1, tally: spin?.won.length ? spin.won : undefined },
      };
    }
    if (receipt && stickView && spin && spin.left === 0 && Date.now() > spin.landsAt) {
      return { ...base, mode: 'order', cart: cartView, customer: who, pay: null, thanks: null, stick: stickView };
    }
    if (receipt && spin) {
      return {
        ...base,
        mode: 'wheel',
        cart: cartView,
        customer: who,
        pay: null,
        thanks: null,
        wheel: {
          id: spin.id,
          slices: spin.slices,
          waiting: false,
          turn: spin.turn,
          won: !!spin.prize,
          label: spin.label,
          detail:
            spin.prize?.kind === 'spin'
              ? 'Get ready to spin again!'
              : spin.prize?.kind === 'pick'
                ? `Pick ${pickText(spin.prize)} from our prize pile at the counter!`
              : spin.prize?.kind === 'voucher' && spin.voucher
                ? `Your code: ${spin.voucher.code}`
                : spin.prize?.kind === 'service'
                  ? 'We’ll make it for you: ask us at the counter.'
                  : spin.prize
                    ? 'Collect it at the counter.'
                    : spin.left > 0
                      ? 'Better luck on your next spin!'
                      : 'Thank you for shopping!',
          sound: spin.sound,
          more: spin.left,
          tally: spin.nth > 1 || spin.left > 0 ? spin.won : undefined,
        },
      };
    }
    if (receipt && stickView) {
      return { ...base, mode: 'order', cart: cartView, customer: who, pay: null, thanks: null, stick: stickView };
    }
    if (receipt) {
      const buyer = receipt.customerId ? (customers ?? []).find((c) => c.id === receipt.customerId) : undefined;
      const card = buyer && loyaltyRules.enabled ? loyaltyState(buyer.id, customerSales ?? [], loyaltyRules) : null;
      const couponLine = earned ? `Service coupon ${earned.coupon.code}: ${termsText(earned.batch, business.name || 'JoshWorks')}` : undefined;
      return {
        ...base,
        mode: 'thanks',
        cart: cartView,
        customer: who,
        pay: null,
        thanks: {
          receiptNo: receipt.receiptNo,
          total: receipt.total,
          change: receipt.change,
          paidWith: receipt.payments.map((p) => p.name).join(' + '),
          receipt: receiptText(receipt, business, ev.name, couponLine),
          coupon: earned ? { code: earned.coupon.code, text: `${offText(earned.batch)} a ${business.name || 'JoshWorks'} service of ${peso(earned.batch.minSpend)} or more` } : null,
          loyalty: card ? `${card.balance} stamp${card.balance === 1 ? '' : 's'} on your card` : null,
        },
      };
    }
    if (paying) {
      const picked = payWith.map((id) => eventMethods.find((m) => m.id === id)).filter((m): m is NonNullable<typeof m> => !!m);
      const withQr = picked.find((m) => m.kind !== 'cash' && m.qr);
      return { ...base, mode: 'paying', cart: cartView, customer: who, pay: { amount: priced.total, method: picked.map((m) => m.name).join(' + ') || 'Cash', qr: withQr?.qr ?? null }, thanks: null };
    }
    // Close to a spin: the customer screen says how much more.
    const near = spinNudge(ev.wheel, { total: priced.total, lines: priced.lines }, (categories ?? []).find((c) => c.id === ev.wheel?.minItems?.categoryId)?.name);
    return { ...base, mode: 'cart', cart: cartView, customer: who, pay: null, thanks: null, spin: near && ev.wheel ? { ...near, slices: wheelSlices(ev.wheel) } : null };
  }, [categories, business, ev.id, ev.name, ev.wheel, session, priced, activeRules, customer, loyalty, loyaltyRules, receipt, spin, invite, stickView, landedTick, customers, customerSales, earned, paying, payWith, eventMethods]);

  /**
   * Spin for a sale: the customer tapped the wheel on their screen, or the
   * cashier spun it. The screen plays the sounds when it can (it was clicked);
   * otherwise this window does.
   */
  const spinFor = async (sale: Sale, from: 'customer' | 'cashier') => {
    if (!session || spinningRef.current) return;
    spinningRef.current = true;
    setSpinning(true);
    if (from === 'cashier') void unlockAudio();
    const st = screen.status();
    const sound: DisplayWheel['sound'] = !displaySettings.wheelSound ? 'none' : from === 'customer' || (st.open && st.sound) ? 'screen' : 'register';
    try {
      const s = await spinWheel({ ev, saleId: sale.id, session, device: app.device, by: app.member?.id ?? null });
      // The same id as the waiting wheel, so it spins on from where it was turning.
      setSpin({ ...s, id: inviteRef.current?.id ?? uid(), sound, landsAt: Date.now() + SPIN_MS });
      setInvite(null);
      window.setTimeout(() => setLandedTick((n) => n + 1), SPIN_MS + 200);
      // A Couple-of-Stickers pack won on the wheel is made like a bought one: its details open once the last spin has landed.
      const won = s.prizeSale;
      if (won && hasPacks(won)) wonPacks.current.push(won);
      if (s.left === 0 && wonPacks.current.length) window.setTimeout(() => setStickFor(wonPacks.current.shift() ?? null), SPIN_MS + 1200);
      // They tapped for this one: once it has landed, the next spin waits on their screen for another tap.
      if (s.left > 0 && from === 'customer')
        window.setTimeout(() => {
          if (receiptRef.current?.id === sale.id) letThemSpinRef.current(sale, s.left);
        }, SPIN_MS + 2600);
      if (sound === 'register') {
        const c = await wheelSoundChoice(displaySettings);
        if (c) {
          playSpin(s.slices, s.turn, SPIN_MS, c);
          window.setTimeout(() => playLanding(!!s.prize, c), SPIN_MS + 150);
        }
      }
    } catch (e) {
      app.toast(e instanceof Error ? e.message : 'Couldn’t spin the wheel', { tone: 'bad' });
    } finally {
      spinningRef.current = false;
      setSpinning(false);
    }
  };
  // The customer's tap arrives from the screen: spin for the sale waiting on it.
  const spinningRef = useRef(false);
  const inviteRef = useRef(invite);
  inviteRef.current = invite;
  const tapRef = useRef<(id: string) => void>(() => undefined);
  tapRef.current = (id: string) => {
    if (receipt && invite?.id === id && !spinningRef.current) void spinFor(receipt, 'customer');
  };
  const receiptRef = useRef(receipt);
  receiptRef.current = receipt;
  const screen = useCustomerScreen(display, (id) => tapRef.current(id));
  const [screenOpen, setScreenOpen] = useState(false);
  const [screenSound, setScreenSound] = useState(false);
  useEffect(() => {
    const t = window.setInterval(() => {
      const st = screen.status();
      setScreenOpen(st.open);
      setScreenSound(st.sound);
    }, 2000);
    return () => window.clearInterval(t);
  }, [screen]);
  /** Where the wheel will be heard, so silence never surprises anyone. */
  const soundNote = !displaySettings.wheelSound
    ? 'Wheel sounds are off (Settings → Customer screen).'
    : screenOpen && !screenSound
      ? 'Sound plays on this laptop until someone clicks the customer screen once (Full screen and sound).'
      : null;
  /** The wheel waits on the customer screen for their tap; `left` counts this spin too. */
  const letThemSpin = (sale: Sale, left: number) => {
    const st = screen.status();
    setInvite({ id: uid(), saleId: sale.id, sound: displaySettings.wheelSound && st.sound ? 'screen' : 'none', left });
  };
  const letThemSpinRef = useRef(letThemSpin);
  letThemSpinRef.current = letThemSpin;
  /** Spins this sale still has: from the last spin, or what it earned. */
  const spinsToGo = spin ? spin.left : receipt ? spinsLeft(receipt, ev.wheel) : 0;
  const spinsWord = (n: number) => `${n} spin${n === 1 ? '' : 's'}`;
  const spinButtons = (sale: Sale) => (
    <div className="row wrap">
      {screenOpen ? (
        <Button variant="teal" onClick={() => letThemSpin(sale, spinsToGo)}>
          <Disc3 size={18} /> Let them spin
        </Button>
      ) : null}
      <Button variant={screenOpen ? undefined : 'teal'} onClick={() => void spinFor(sale, 'cashier')} disabled={spinning}>
        <Disc3 size={18} /> {screenOpen ? 'Spin for them' : 'Spin the wheel'}
      </Button>
    </div>
  );
  const wheelBox =
    receipt && (spin || wheelQualifies(receipt, ev.wheel)) ? (
      spin && Date.now() < spin.landsAt ? (
        <Callout tone="info" title={spin.nth > 1 ? `The wheel is spinning (spin ${spin.nth})…` : 'The wheel is spinning…'}>
          It lands in a few seconds{screenOpen ? ' on the customer screen' : ''}.
        </Callout>
      ) : spin && !invite ? (
        <>
          <Callout tone={spin.prize ? 'good' : 'info'} title={spin.prize ? `They won: ${spin.label}` : 'Try again: no prize this time'}>
            {spin.detail}
            {spin.won.length > 1 ? <span className="muted small" style={{ display: 'block' }}>Won on this sale: {spin.won.join(', ')}</span> : null}
          </Callout>
          {spin.left > 0 ? (
            <div className="wheel-cta">
              <span>
                <b>{spinsWord(spin.left)} left for this sale.</b> {screenOpen ? 'Let them tap it again, or spin it for them.' : 'Spin it again.'}
              </span>
              {spinButtons(receipt)}
            </div>
          ) : null}
        </>
      ) : invite ? (
        <div className="wheel-cta">
          <span>
            <b>Waiting for them to tap the wheel</b> on the customer screen{invite.left > 1 ? ` (${spinsWord(invite.left)} left)` : ''}.
            {spin ? <span className="muted small" style={{ display: 'block' }}>Last spin: {spin.prize ? `won ${spin.label}` : 'Try again'}{spin.won.length ? `. Won on this sale: ${spin.won.join(', ')}` : ''}</span> : null}
          </span>
          <div className="row wrap">
            <Button variant="teal" onClick={() => void spinFor(receipt, 'cashier')} disabled={spinning}>
              <Disc3 size={18} /> Spin for them
            </Button>
            <Button variant="ghost" onClick={() => setInvite(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="wheel-cta">
          <span>
            <b>This sale spins the prize wheel{spinsToGo > 1 ? ` ${spinsToGo} times` : ''}.</b> {screenOpen ? 'Let them tap it on the customer screen, or spin it for them.' : 'It spins on the customer screen when one is open.'}
            {soundNote ? <span className="muted small" style={{ display: 'block' }}>{soundNote}</span> : null}
          </span>
          {spinButtons(receipt)}
        </div>
      )
    ) : null;

  const stickBox =
    receipt && hasPacks(receipt) ? (
      stickOrder ? (
        <Callout tone="good" title={`Couple-of-Stickers ${stickOrder.number} is on Orders`}>
          <div className="row wrap">
            <span>
              For {stickOrder.customerName}. Their number is on the claim stub.
            </span>
            <Button size="sm" onClick={() => setStickFor(receipt)}>
              Details
            </Button>
            <Button size="sm" onClick={() => setStubsFor({ number: stickOrder.number, eventName: ev.name, at: stickOrder.createdAt, stick: stickOrder.stick! })}>
              See the stubs
            </Button>
          </div>
        </Callout>
      ) : (
        <div className="wheel-cta">
          <span>
            <b>Couple-of-Stickers:</b> their name, the packs and the mini stickers go on the stubs.
          </span>
          <Button variant="teal" onClick={() => setStickFor(receipt)}>
            Fill in the details
          </Button>
        </div>
      )
    ) : null;

  const showCustomerScreen = async () => {
    const r = await openCustomerScreen();
    if (r === 'blocked') app.toast('The browser blocked the customer screen. Allow pop-ups for this site, then try again.', { tone: 'bad' });
    else if (r === 'moved') app.toast('The customer screen is on the second monitor. Click Full screen there.', { tone: 'good' });
    else if (secondScreen) app.toast('Drag the customer screen to the second monitor, then click Full screen there.', { tone: 'info' });
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
      customer={customer}
      loyalty={loyalty}
      loyaltyRules={loyaltyRules}
      voucherCheck={voucherCheck}
      onCustomer={() => setCustomerOpen(true)}
      onVoucher={() => setVoucherOpen(true)}
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
              <Button size="sm" className="hide-phone" variant={secondScreen ? 'teal' : undefined} onClick={() => void showCustomerScreen()}>
                <Monitor size={16} /> {secondScreen ? 'Customer screen (2nd monitor)' : 'Customer screen'}
              </Button>
              {app.can('orders') || app.can('printOrders') ? (
                <Button size="sm" onClick={() => setFindOpen(true)}>
                  <Search size={16} /> Find order
                </Button>
              ) : null}
              {app.can('printOrders') ? (
                <Button size="sm" className="hide-phone" onClick={() => navigate('/booth')}>
                  <Camera size={16} /> Photo booth
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

      <PaymentDialog open={paying} onClose={() => setPaying(false)} total={priced.total} methods={eventMethods} onPay={pay} onMethods={setPayWith} />
      <ReceiptDialog
        sale={receipt}
        business={business}
        eventName={ev.name}
        extra={
          <>
            {stickBox}
            {wheelBox}
          </>
        }
        onClose={() => {
          setReceipt(null);
          setSpin(null);
          setInvite(null);
          // Packs won on spins left unfinished still get their details.
          if (wonPacks.current.length) setStickFor(wonPacks.current.shift() ?? null);
          setStickView(null);
          setStickOrder(null);
          setStickEdit(null);
          searchRef.current?.focus({ preventScroll: true });
        }}
      />
      {stickFor ? (
        <StickDialog
          sale={stickFor}
          ev={ev}
          existing={[stickEdit, stickOrder].find((o) => o?.stick?.saleId === stickFor.id) ?? undefined}
          onClose={() => {
            setStickEdit(null);
            setStickFor(!spin || spin.left === 0 ? (wonPacks.current.shift() ?? null) : null);
          }}
          onDraft={(d) => setStickView((v) => d ?? (v?.number ? v : null))}
          onSaved={(o) => {
            setStickOrder(o);
            setStickView({ number: o.number, nickname: o.stick!.nickname, packs: o.stick!.packs, addOns: o.stick!.addOns, readyFrom: o.stick!.readyFrom, readyTo: o.stick!.readyTo, photo: o.stick!.photo, paid: o.stick!.paid, paidWith: o.stick!.paidWith });
          }}
        />
      ) : null}
      <StubsDialog o={stubsFor} paper={stickSettings.stubPaper} onClose={() => setStubsFor(null)} />
      <CameraScanner open={scanOpen} onClose={() => setScanOpen(false)} onCode={(c) => void onCode(c)} />
      <CashMoveDialog session={session} open={cashMove} onClose={() => setCashMove(false)} />
      <FindOrderDialog open={findOpen} onClose={() => setFindOpen(false)} />
      <HeldSalesDialog open={heldOpen} onClose={() => setHeldOpen(false)} held={held ?? []} cart={cart} />
      <LineDialog lineKey={lineKey} onClose={() => setLineKey(null)} cart={cart} />
      <CustomDiscountDialog open={customOpen} onClose={() => setCustomOpen(false)} ev={ev} cart={cart} base={priced.subtotal - priced.bundleTotal} />
      <QuickPriceDialog product={priceFor} ev={ev} onClose={() => setPriceFor(null)} onPriced={(p, price) => cart.add(p, price)} />
      <CustomerPicker
        open={customerOpen}
        onClose={() => setCustomerOpen(false)}
        eventId={ev.id}
        onPick={(c) => {
          cart.setCustomer(c.id);
          setCustomerOpen(false);
        }}
      />
      <VoucherDialog
        open={voucherOpen}
        onClose={() => setVoucherOpen(false)}
        check={checkCode}
        onApply={(code) => {
          cart.setVoucher(code);
          setVoucherOpen(false);
        }}
      />
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
  customer,
  loyalty,
  loyaltyRules,
  voucherCheck,
  onCustomer,
  onVoucher,
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
  customer: Customer | null;
  loyalty: LoyaltyState | null;
  loyaltyRules: LoyaltySettings;
  voucherCheck: VoucherCheck | null;
  onCustomer: () => void;
  onVoucher: () => void;
}) {
  const empty = priced.lines.length === 0;
  const removable = (id: string) => cart.state.custom.some((c) => c.id === id) || id === 'voucher' || id === 'loyalty';
  const removeDiscount = (id: string) => {
    if (id === 'voucher') cart.setVoucher('');
    else if (id === 'loyalty') cart.setUseReward(false);
    else cart.removeCustom(id);
  };
  const stampLine = loyalty
    ? `${loyalty.balance} stamp${loyalty.balance === 1 ? '' : 's'} · ${
        loyalty.rewards ? `${loyalty.rewards} reward${loyalty.rewards === 1 ? '' : 's'} ready` : `${loyalty.toNext} more for ${rewardText(loyaltyRules)}`
      }`
    : '';
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
        <div className="cart-customer">
          {customer ? (
            <div className="cust-chip">
              <UserRound size={18} aria-hidden="true" />
              <span className="grow">
                <b>{customer.name}</b>
                {stampLine ? <span className="muted tiny">{stampLine}</span> : null}
              </span>
              <IconButton label={`Remove ${customer.name} from this sale`} size="sm" plain onClick={() => cart.setCustomer(null)}>
                <X size={16} />
              </IconButton>
            </div>
          ) : (
            <button type="button" className="chip" onClick={onCustomer}>
              <UserPlus size={14} /> Customer
            </button>
          )}
          {loyalty && loyalty.rewards > 0 ? (
            <button type="button" className="chip" aria-pressed={cart.state.useReward} onClick={() => cart.setUseReward(!cart.state.useReward)} disabled={empty}>
              <Gift size={14} /> Use reward ({rewardText(loyaltyRules)})
            </button>
          ) : null}
        </div>
        {voucherCheck && !voucherCheck.ok ? (
          <p className="small bad" role="alert">
            {voucherCheck.reason}{' '}
            <button type="button" className="btn link small" onClick={() => cart.setVoucher('')}>
              Remove the code
            </button>
          </p>
        ) : null}
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
            {!cart.state.voucherCode ? (
              <button type="button" className="chip" onClick={onVoucher} disabled={empty}>
                <Ticket size={14} /> Voucher
              </button>
            ) : null}
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
                {removable(d.id) ? (
                  <button type="button" className="icon-btn plain sm" aria-label={`Remove ${d.label}`} onClick={() => removeDiscount(d.id)}>
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

/** Send the customer screen's state whenever it changes. */
function useCustomerScreen(state: DisplayState, onSpin: (id: string) => void): { status: () => ScreenStatus } {
  const sender = useRef<DisplaySender | null>(null);
  const spinRef = useRef(onSpin);
  spinRef.current = onSpin;
  const last = useRef(state);
  last.current = state;
  useEffect(() => {
    sender.current = displaySender((id) => spinRef.current(id));
    return () => {
      // Leaving Sell: the screen goes back to the slides, not stuck on the last sale or order.
      const l = last.current;
      sender.current?.send({ v: 1, mode: 'closed', eventId: l.eventId, business: l.business, eventName: l.eventName, cart: emptyDisplayCart(), customer: null, pay: null, thanks: null });
      sender.current?.close();
      sender.current = null;
    };
  }, []);
  const json = JSON.stringify(state);
  useEffect(() => {
    sender.current?.send(JSON.parse(json) as DisplayState);
  }, [json]);
  return useMemo(() => ({ status: () => sender.current?.status() ?? { open: false, sound: false } }), []);
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
    // /sell turns off page scrolling for the register's own panels, so this screen scrolls itself.
    <div className="open-reg-scroll">
      <div className="page open-reg">
        <div className="card pad-lg stack open-reg-card">
          <span className="eyebrow">{ev.name}</span>
          <h1>Open register {app.device.letter}</h1>
          <p className="muted">Check the prices, then count the cash you&rsquo;re starting with. It&rsquo;s the float the drawer is checked against when you close.</p>
          {ev.status === 'planning' ? <Callout tone="info">Opening the register marks {ev.name} as Live.</Callout> : null}
          <Field label="Opening cash float" htmlFor="float">
            <MoneyInput id="float" large value={float} onChange={setFloat} onEnter={open} autoFocus />
          </Field>
          <Button variant="primary" size="lg" disabled={busy} onClick={open}>
            Open register
          </Button>
        </div>
        <PriceReview ev={ev} />
        <DealsReview ev={ev} />
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

/** Type a voucher code; it's checked against this cart before it goes on the sale. */
function VoucherDialog({ open, onClose, check, onApply }: { open: boolean; onClose: () => void; check: (code: string) => Promise<VoucherCheck>; onApply: (code: string) => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setCode('');
      setError('');
    }
  }, [open]);
  const apply = async () => {
    const c = normalizeCode(code);
    if (!c) return;
    setBusy(true);
    const r = await check(c);
    setBusy(false);
    if (r.ok) onApply(c);
    else setError(r.reason);
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Voucher code"
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={apply} disabled={!normalizeCode(code) || busy}>
            Apply
          </Button>
        </>
      }
    >
      <Field label="Code" htmlFor="vc-code" error={error || undefined}>
        <TextInput
          id="vc-code"
          value={code}
          autoFocus
          autoCapitalize="characters"
          autoComplete="off"
          onChange={(e) => {
            setCode(e.target.value.toUpperCase());
            setError('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void apply();
          }}
          placeholder="e.g. KOMIKET50"
        />
      </Field>
    </Dialog>
  );
}
