import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Maximize, Volume2 } from 'lucide-react';
import { peso } from '../../lib/money';
import { useLocal } from '../../hooks/data';
import { HERE_MS, displayReceiver, type BoothShow, type DisplayCall, type DisplayReceiver } from '../../display/channel';
import { audioReady, playInvite, playLanding, playSpin, playTick, unlockAudio } from '../../display/sound';
import { wheelSoundChoice } from '../../display/wheelSounds';
import { SPIN_MS } from '../../domain/wheelSpin';
import { Confetti } from './Confetti';
import { Music } from './Music';
import { BoothView } from './BoothView';
import { DEFAULT_DISPLAY, type DisplaySettings } from '../../display/slides';
import { Slides, useSlides } from './Slides';
import { refreshStickers } from '../../display/stickers';
import { WheelSvg } from './WheelSvg';
import type { DisplayState, DisplayWheel } from '../../domain/display';
import lockup from '../../assets/brand/lockup-on-dark.png';
import './display.css';

/** "Now calling" stays up this long. */
const CALL_MS = 15_000;
/** After a sale, the thank-you stays up this long unless the next customer's items come in. */
const THANKS_MS = 15_000;
/** The booth page repeats itself every 4 seconds; with nothing for this long, it was closed. */
const BOOTH_MS = 12_000;

type View = 'waiting' | 'idle' | 'welcome' | 'cart' | 'paying' | 'thanks' | 'wheel' | 'booth';

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
  const [calling, setCalling] = useState<DisplayCall | null>(null);
  const [booth, setBooth] = useState<BoothShow | null>(null);
  const [soundOn, setSoundOn] = useState(audioReady);
  const [videoSound, setVideoSound] = useState(false);
  const rx = useRef<DisplayReceiver | null>(null);
  const saved = useLocal<Partial<DisplaySettings>>('display', DEFAULT_DISPLAY);
  const settings = useMemo<DisplaySettings>(() => ({ ...DEFAULT_DISPLAY, ...(saved ?? {}) }), [saved]);
  // With no register sending yet (the cashier is on another page), the event picked on this laptop.
  const activeEventId = useLocal<string | null>('activeEventId', null) ?? null;
  const { slides, urls } = useSlides(state?.eventId ?? activeEventId, settings);
  // New custom sticker designs from Drive, every few minutes while online.
  useEffect(() => {
    if (!settings.driveStickers) return;
    const run = () => {
      if (navigator.onLine) void refreshStickers().catch(() => null);
    };
    run();
    const t = window.setInterval(run, 5 * 60_000);
    return () => window.clearInterval(t);
  }, [settings.driveStickers]);

  useEffect(() => {
    const r = displayReceiver(
      (s) => {
        setState(s);
        const busy = s.mode === 'paying' || s.mode === 'thanks' || s.mode === 'wheel' || (s.mode === 'cart' && s.cart.count > 0);
        if (busy) setBusyAt(Date.now());
        if (s.mode === 'thanks') setThanks({ s, until: Date.now() + THANKS_MS });
        else if (s.mode !== 'cart' || s.cart.count > 0) setThanks((t) => (s.mode === 'wheel' ? t : null));
      },
      setCalling,
      (b) => {
        setBooth(b);
        if (b) setBusyAt(Date.now());
      },
    );
    rx.current = r;
    // Tell the register the screen is here, and whether it can play sound.
    const beat = () => r.here(audioReady());
    beat();
    const t = window.setInterval(beat, HERE_MS);
    // Browsers play sound only after a click in the page: any click on the screen allows it.
    const unlock = () =>
      void unlockAudio().then((ok) => {
        setSoundOn(ok);
        r.here(ok);
      });
    window.addEventListener('pointerdown', unlock);
    return () => {
      window.clearInterval(t);
      window.removeEventListener('pointerdown', unlock);
      r.close();
      rx.current = null;
    };
  }, []);

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
  const boothOn = !!booth && now - booth.at < BOOTH_MS;
  const view: View = boothOn
    ? 'booth'
    : !state
    ? activeEventId
      ? 'idle'
      : 'waiting'
    : showingThanks
      ? 'thanks'
      : state.mode === 'wheel' && state.wheel
        ? 'wheel'
        : state.mode === 'paying'
        ? 'paying'
        : state.mode === 'cart' && state.cart.count > 0
          ? 'cart'
          : now - busyAt >= settings.idleSeconds * 1000
            ? 'idle'
            : state.mode === 'closed'
              ? 'idle'
              : 'welcome';
  const s = showingThanks && thanks ? thanks.s : state;
  const callingNow = !!calling && now - calling.at < CALL_MS;
  const musicNow = (settings.musicWhen === 'always' || view === 'idle') && view !== 'wheel' && !callingNow && !videoSound;
  const wantsSound = settings.music || settings.wheelSound || settings.videoSound;

  return (
    <div className={`cd view-${view}${cursor ? '' : ' no-cursor'}`} data-view={view}>
      {view === 'waiting' ? (
        <section className="cd-full" aria-label="Welcome">
          <img src={lockup} alt={s?.business || 'JoshWorks'} className="cd-lockup big" />
          <p className="cd-tagline">Stickers · Pins · Custom art</p>
          <p className="cd-hint">Waiting for the register. Open Sell in the other window.</p>
        </section>
      ) : view === 'booth' && booth ? (
        <BoothView b={booth} />
      ) : view === 'wheel' && s?.wheel ? (
        <WheelView
          w={s.wheel}
          settings={settings}
          onTap={(id) => {
            void unlockAudio().then(setSoundOn);
            rx.current?.spin(id);
          }}
        />
      ) : view === 'idle' ? (
        <section className="cd-full slides" aria-label="Welcome">
          <Slides slides={slides} urls={urls} seconds={settings.slideSeconds} variant="full" videoSound={settings.videoSound && soundOn} onVideoSound={setVideoSound} />
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
            ) : settings.sideAds ? (
              <Slides slides={slides} urls={urls} seconds={settings.slideSeconds} variant="side" />
            ) : (
              <div className="cd-brand">
                <p className="cd-tagline">Stickers · Pins · Custom art</p>
                <p>Ask us about custom sticker printing and illustration.</p>
              </div>
            )}
          </aside>
        </>
      )}
      {callingNow && calling ? (
        <div className="cd-call" role="status" aria-live="assertive">
          <span className="sl-eyebrow">Now calling</span>
          <b className="num">{calling.number}</b>
          {calling.name ? <span>{calling.name}, your order is ready!</span> : <span>Your order is ready!</span>}
        </div>
      ) : null}
      {!full ? (
        <button type="button" className="cd-fullbtn" onClick={goFull}>
          <Maximize size={18} aria-hidden="true" /> {wantsSound && !soundOn ? 'Full screen and sound' : 'Full screen'}
        </button>
      ) : wantsSound && !soundOn ? (
        <button type="button" className="cd-fullbtn" onClick={() => void unlockAudio().then(setSoundOn)}>
          <Volume2 size={18} aria-hidden="true" /> Turn on sound
        </button>
      ) : null}
      {settings.music ? <Music play={soundOn && musicNow} volume={settings.musicVolume / 100} /> : null}
    </div>
  );
}

/**
 * The prize wheel, full screen. While it waits it turns slowly and asks the
 * customer to tap it; the tap goes to the register, which draws the prize and
 * sends where it lands. Then it spins with its sounds (when this screen plays
 * them), and a prize gets confetti.
 */
function WheelView({ w, settings, onTap }: { w: DisplayWheel; settings: DisplaySettings; onTap: (id: string) => void }) {
  const [tapped, setTapped] = useState('');
  const [landed, setLanded] = useState(false);
  const [burst, setBurst] = useState(0);
  const here = w.sound === 'screen' && settings.wheelSound;
  const volume = settings.soundVolume / 100;
  useEffect(() => {
    setLanded(false);
    if (w.waiting) {
      if (here) playInvite(volume);
      return;
    }
    let stop = () => undefined as void;
    let gone = false;
    if (here)
      void wheelSoundChoice(settings).then((c) => {
        // The wheel ticks for itself as it turns (onTick); this is the tune.
        if (c && !gone) stop = playSpin(w.slices, w.turn, SPIN_MS, c, false);
      });
    const t = window.setTimeout(() => {
      setLanded(true);
      if (w.won) setBurst(Date.now());
      if (here) void wheelSoundChoice(settings).then((c) => c && playLanding(w.won, c));
    }, SPIN_MS + 150);
    return () => {
      gone = true;
      window.clearTimeout(t);
      stop();
    };
  }, [w.id, w.waiting]); // eslint-disable-line react-hooks/exhaustive-deps

  const wheel = <WheelSvg slices={w.slices} idle={w.waiting} turn={w.turn} spinMs={w.waiting ? 0 : SPIN_MS} onTick={here ? () => playTick(volume) : undefined} className="cd-wheel-svg" />;
  return (
    <section className="cd-full cd-wheel" aria-label="Prize wheel">
      {w.waiting ? (
        <button
          type="button"
          className="cd-wheel-tap"
          aria-label="Spin the wheel"
          disabled={tapped === w.id}
          onClick={() => {
            setTapped(w.id);
            onTap(w.id);
          }}
        >
          {wheel}
        </button>
      ) : (
        wheel
      )}
      <div className={`cd-wheel-result${landed ? ' on' : ''}`} role="status" aria-live="polite">
        {w.waiting ? (
          <>
            <span className="sl-eyebrow">Prize wheel</span>
            <b>{tapped === w.id ? 'Here it goes…' : 'Tap the wheel to spin!'}</b>
            <span>Good luck!</span>
          </>
        ) : landed ? (
          <>
            <span className="sl-eyebrow">{w.won ? 'You won' : 'So close'}</span>
            <b>{w.label}</b>
            <span>{w.detail}</span>
          </>
        ) : (
          <>
            <span className="sl-eyebrow">Prize wheel</span>
            <b>Good luck!</b>
          </>
        )}
      </div>
      <Confetti burst={burst} />
    </section>
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
