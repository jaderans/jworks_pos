import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Maximize } from 'lucide-react';
import { peso } from '../../lib/money';
import { displayReceiver } from '../../display/channel';
import type { DisplayState } from '../../domain/display';
import lockup from '../../assets/brand/lockup-on-dark.png';
import './display.css';

/** After a sale, the thank-you stays up this long unless the next customer's items come in. */
const THANKS_MS = 15_000;
/** With nothing rung up for this long, the screen goes to its idle slides. */
const IDLE_MS = 20_000;

type View = 'waiting' | 'idle' | 'welcome' | 'cart' | 'paying' | 'thanks';

/**
 * The customer screen, full screen on the second monitor (or a window dragged
 * there). It shows what the register sends: the items and total as they're
 * rung up, the amount and QR to pay, and a thank-you with the receipt.
 */
export default function CustomerDisplay() {
  const [state, setState] = useState<DisplayState | null>(null);
  const [thanks, setThanks] = useState<{ s: DisplayState; until: number } | null>(null);
  const [busyAt, setBusyAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [qr, setQr] = useState('');
  const [full, setFull] = useState(!!document.fullscreenElement);
  const [cursor, setCursor] = useState(true);

  useEffect(
    () =>
      displayReceiver((s) => {
        setState(s);
        const busy = s.mode === 'paying' || s.mode === 'thanks' || (s.mode === 'cart' && s.cart.count > 0);
        if (busy) setBusyAt(Date.now());
        if (s.mode === 'thanks') setThanks({ s, until: Date.now() + THANKS_MS });
        else if (s.mode !== 'cart' || s.cart.count > 0) setThanks(null);
      }),
    [],
  );

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  // The receipt as a QR code: its text, so it reads with no internet.
  const receipt = thanks?.s.thanks?.receipt;
  useEffect(() => {
    if (!receipt) return setQr('');
    QRCode.toDataURL(receipt, { margin: 1, width: 480, errorCorrectionLevel: 'L' })
      .then(setQr)
      .catch(() => setQr(''));
  }, [receipt]);

  // Keep the monitor awake, and hide the pointer when nobody moves the mouse.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
    const ask = () => void nav.wakeLock?.request('screen').then((l) => (lock = l)).catch(() => null);
    ask();
    const onVisible = () => document.visibilityState === 'visible' && ask();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release().catch(() => null);
    };
  }, []);
  const hideTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    const onMove = () => {
      setCursor(true);
      window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => setCursor(false), 3000);
    };
    const onFull = () => setFull(!!document.fullscreenElement);
    onMove();
    window.addEventListener('mousemove', onMove);
    document.addEventListener('fullscreenchange', onFull);
    return () => {
      window.removeEventListener('mousemove', onMove);
      document.removeEventListener('fullscreenchange', onFull);
      window.clearTimeout(hideTimer.current);
    };
  }, []);
  useEffect(() => {
    const prev = document.title;
    document.title = 'Customer screen · JoshWorks';
    return () => {
      document.title = prev;
    };
  }, []);

  const goFull = () => void document.documentElement.requestFullscreen?.().catch(() => null);

  const showingThanks = thanks && now < thanks.until && (!state || state.mode === 'thanks' || (state.mode === 'cart' && state.cart.count === 0));
  const view: View = !state
    ? 'waiting'
    : showingThanks
      ? 'thanks'
      : state.mode === 'paying'
        ? 'paying'
        : state.mode === 'cart' && state.cart.count > 0
          ? 'cart'
          : now - busyAt >= IDLE_MS
            ? 'idle'
            : state.mode === 'closed'
              ? 'idle'
              : 'welcome';
  const s = showingThanks && thanks ? thanks.s : state;

  return (
    <div className={`cd view-${view}${cursor ? '' : ' no-cursor'}`} data-view={view}>
      {view === 'idle' || view === 'waiting' ? (
        <section className="cd-full" aria-label="Welcome">
          <img src={lockup} alt={s?.business || 'JoshWorks'} className="cd-lockup big" />
          <p className="cd-tagline">Stickers · Pins · Custom art</p>
          {s?.eventName ? <p className="cd-event">See you at {s.eventName}</p> : null}
          {view === 'waiting' ? <p className="cd-hint">Waiting for the register. Open Sell in the other window.</p> : null}
        </section>
      ) : (
        <>
          <section className="cd-main" aria-label={view === 'thanks' ? 'Thank you' : view === 'paying' ? 'Payment' : 'Your order'}>
            <header className="cd-head">
              <img src={lockup} alt={s?.business || 'JoshWorks'} className="cd-lockup" />
              {s?.eventName ? <span>{s.eventName}</span> : null}
            </header>
            {view === 'welcome' ? (
              <div className="cd-welcome">
                <h1>Welcome!</h1>
                <p>Your items show here as we ring them up.</p>
              </div>
            ) : null}
            {view === 'cart' && s ? <CartView s={s} /> : null}
            {view === 'paying' && s?.pay ? (
              <div className="cd-pay">
                <span className="cd-label">Total to pay</span>
                <b className="cd-amount num">{peso(s.pay.amount)}</b>
                <span className="cd-method">{s.pay.qr ? `Scan to pay with ${s.pay.method}` : `Paying by ${s.pay.method}`}</span>
                {s.customer?.loyalty ? <span className="cd-chip">{s.customer.loyalty}</span> : null}
              </div>
            ) : null}
            {view === 'thanks' && s?.thanks ? (
              <div className="cd-thanks">
                <h1>Salamat!</h1>
                <p className="cd-paid num">
                  Paid {peso(s.thanks.total)}
                  {s.thanks.change > 0 ? ` · your change ${peso(s.thanks.change)}` : ''}
                </p>
                {s.thanks.coupon ? (
                  <div className="cd-coupon">
                    <span>You earned a coupon</span>
                    <b className="mono">{s.thanks.coupon.code}</b>
                    <span>{s.thanks.coupon.text}</span>
                  </div>
                ) : null}
                {s.thanks.loyalty ? <span className="cd-chip">{s.thanks.loyalty}</span> : null}
              </div>
            ) : null}
          </section>
          <aside className="cd-side" aria-label={view === 'paying' && s?.pay?.qr ? 'Payment QR' : view === 'thanks' ? 'Receipt' : 'JoshWorks'}>
            {view === 'paying' && s?.pay?.qr ? (
              <div className="cd-qr">
                <img src={s.pay.qr} alt={`${s.pay.method} QR code`} />
                <span>{s.pay.method}</span>
              </div>
            ) : view === 'thanks' && qr ? (
              <div className="cd-qr">
                <img src={qr} alt="Receipt QR code" />
                <span>Scan for your receipt {s?.thanks?.receiptNo}</span>
              </div>
            ) : (
              <div className="cd-brand">
                <p className="cd-tagline">Stickers · Pins · Custom art</p>
                <p>Ask us about custom sticker printing and illustration.</p>
              </div>
            )}
          </aside>
        </>
      )}
      {!full ? (
        <button type="button" className="cd-fullbtn" onClick={goFull}>
          <Maximize size={18} aria-hidden="true" /> Full screen
        </button>
      ) : null}
    </div>
  );
}

function CartView({ s }: { s: DisplayState }) {
  const c = s.cart;
  // The newest items matter most: older ones fold into a count when the list is long.
  const MAX = 8;
  const hidden = Math.max(0, c.lines.length - MAX);
  const lines = c.lines.slice(-MAX);
  return (
    <div className="cd-cart">
      {s.customer ? (
        <div className="cd-customer">
          <b>Hi, {s.customer.name.split(' ')[0]}!</b>
          {s.customer.loyalty ? <span>{s.customer.loyalty}</span> : null}
        </div>
      ) : null}
      <ul className="cd-lines">
        {hidden ? <li className="cd-more">+ {hidden} more item{hidden === 1 ? '' : 's'} above</li> : null}
        {lines.map((l, i) => (
          <li key={`${hidden + i}`}>
            <span className="cd-qty num">{l.qty} ×</span>
            <span className="cd-name">{l.name}</span>
            <span className="cd-amt num">{l.free ? 'Free' : peso(l.total)}</span>
          </li>
        ))}
      </ul>
      {c.savings.length ? (
        <ul className="cd-savings">
          {c.savings.map((x, i) => (
            <li key={i}>
              <span>{x.label}</span>
              <span className="num">−{peso(x.amount)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {c.nudge ? (
        <p className="cd-nudge" role="status">
          {c.nudge}
        </p>
      ) : null}
      <div className="cd-total">
        <span>
          Total <small className="num">{c.count} item{c.count === 1 ? '' : 's'}</small>
        </span>
        <b className="num">{peso(c.total)}</b>
      </div>
    </div>
  );
}
