import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, alive } from '../../db/db';
import { settingValue } from '../../db/settings';
import { useBundleRules, useCategories, useEventProducts, useOrders, usePrintOrders, useProducts, useSales, useSettingRows } from '../../hooks/data';
import { wheelRuleText } from '../../domain/wheel';
import { peso } from '../../lib/money';
import { buildSlides, mixSlides, type DisplaySettings, type Slide } from '../../display/slides';
import type { BusinessSettings, DisplayMedia, PrintRates } from '../../db/types';
import lockup from '../../assets/brand/lockup-on-dark.png';

/** The slides for an event, made live from the POS, with this device's ads between them. */
export function useSlides(eventId: string | null, settings: DisplaySettings): { slides: Slide[]; urls: Map<string, string> } {
  const products = useProducts();
  const categories = useCategories();
  const eps = useEventProducts(eventId ?? undefined);
  const rules = useBundleRules();
  const sales = useSales(eventId ?? undefined);
  const rows = useSettingRows();
  const batches = useLiveQuery(async () => (eventId ? alive(await db.couponBatches.where('eventId').equals(eventId).toArray()) : []), [eventId]);
  const media = useLiveQuery(() => db.displayMedia.orderBy('sort').toArray(), []);
  const orders = useOrders();
  const prints = usePrintOrders();
  const ev = useLiveQuery(async () => (eventId ? db.events.get(eventId) : undefined), [eventId]);
  const urls = useMediaUrls(settings.ownAds ? media : undefined);
  const slides = useMemo(() => {
    const made = eventId
      ? buildSlides({
          eventId,
          products: products ?? [],
          categories: categories ?? [],
          eventProducts: eps ?? [],
          rules: rules ?? [],
          rates: settingValue<PrintRates>(rows, 'printRates'),
          batches: batches ?? [],
          sales: sales ?? [],
          business: settingValue<BusinessSettings>(rows, 'business').name || 'JoshWorks',
          settings,
          // First names only: the screen faces the public.
          ready: [
            ...(orders ?? []).filter((o) => o.status === 'ready').map((o) => ({ number: o.number, name: o.customerName.split(' ')[0] })),
            ...(prints ?? []).filter((o) => o.status === 'ready').map((o) => ({ number: o.number, name: o.customerName.split(' ')[0] })),
          ],
          wheel: ev?.wheel?.on ? { rule: wheelRuleText(ev.wheel, categories ?? []), prizes: ev.wheel.prizes.map((p) => p.label) } : null,
        })
      : [{ kind: 'brand' as const, key: 'brand' }];
    return mixSlides(made, settings.ownAds ? (media ?? []) : []);
  }, [eventId, products, categories, eps, rules, rows, batches, sales, media, settings, orders, prints, ev]);
  return { slides, urls };
}

function useMediaUrls(media: DisplayMedia[] | undefined): Map<string, string> {
  const urls = useMemo(() => new Map((media ?? []).map((m) => [m.id, URL.createObjectURL(m.blob)])), [media]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);
  return urls;
}

/** One slide at a time: each for its time, a video to its end. */
export function Slides({ slides, urls, seconds, variant }: { slides: Slide[]; urls: Map<string, string>; seconds: number; variant: 'full' | 'side' }) {
  const [n, setN] = useState(0);
  const s = slides.length ? slides[n % slides.length] : null;
  const next = useCallback(() => setN((x) => x + 1), []);
  const key = s?.key;
  useEffect(() => {
    if (!s || slides.length < 2) return;
    // A video moves on when it ends; this is only a safety net.
    const ms = s.kind === 'media' ? (s.media === 'video' ? 120_000 : s.seconds * 1000) : seconds * 1000;
    const t = window.setTimeout(next, Math.max(2000, ms));
    return () => window.clearTimeout(t);
  }, [n, key, seconds, next, slides.length]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!s) return null;
  return (
    <div className={`sl-stage ${variant}`} data-slide={s.kind}>
      <SlideView key={`${n}:${s.key}`} s={s} url={s.kind === 'media' ? urls.get(s.id) : undefined} onEnded={next} />
      {slides.length > 1 && slides.length <= 14 ? (
        <div className="sl-dots" aria-hidden="true">
          {slides.map((x, i) => (
            <i key={`${x.key}:${i}`} className={i === n % slides.length ? 'on' : ''} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SlideView({ s, url, onEnded }: { s: Slide; url?: string; onEnded: () => void }) {
  switch (s.kind) {
    case 'brand':
      return (
        <div className="sl sl-brand">
          <img src={lockup} alt="JoshWorks" className="sl-lockup" />
          <p className="sl-tag">Stickers · Pins · Custom art</p>
          <p className="sl-sub">Ask us about custom sticker printing and illustration.</p>
        </div>
      );
    case 'prices':
      return (
        <div className="sl sl-list">
          <span className="sl-eyebrow">Price list{s.part ? ` · ${s.part}` : ''}</span>
          <h2>{s.title}</h2>
          <ul>
            {s.rows.map((r) => (
              <li key={r.name}>
                <span className="sl-name">{r.name}</span>
                <span className="sl-price num">
                  {r.was !== null ? <s>{peso(r.was)}</s> : null}
                  {peso(r.price)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      );
    case 'deals':
      return (
        <div className="sl sl-list">
          <span className="sl-eyebrow">Bundle deals</span>
          <h2>Buy more, pay less</h2>
          <ul>
            {s.rows.map((r) => (
              <li key={r.name}>
                <span className="sl-name">{r.name}</span>
                <span className="sl-price">{r.text}</span>
              </li>
            ))}
          </ul>
        </div>
      );
    case 'printing':
      return (
        <div className="sl sl-list">
          <span className="sl-eyebrow">Custom sticker printing</span>
          <h2>Your designs, printed</h2>
          <ul>
            {s.rows.map((r) => (
              <li key={r.name}>
                <span className="sl-name">
                  {r.name} <small>{r.note}</small>
                </span>
                <span className="sl-price num">{peso(r.price)}</span>
              </li>
            ))}
          </ul>
          <p className="sl-chips">
            {s.extras.map((x) => (
              <span key={x}>{x}</span>
            ))}
          </p>
        </div>
      );
    case 'illustration':
      return (
        <div className="sl sl-art">
          <span className="sl-eyebrow">Sticker illustration</span>
          <h2>Your idea, drawn as a sticker</h2>
          <div className="sl-tiers">
            {s.tiers.map((t) => (
              <div key={t.name} className="sl-tier">
                <b>{t.name}</b>
                <span className="sl-price num">
                  {peso(t.price)} <small>a design</small>
                </span>
                <span className="sl-note">{t.note}</span>
                <span className="sl-sets num">{t.sets.map((x) => `${x.designs} for ${peso(x.price)}`).join(' · ')}</span>
              </div>
            ))}
          </div>
        </div>
      );
    case 'coupon':
      return (
        <div className="sl sl-coupon">
          <span className="sl-eyebrow">Booth deal</span>
          <h2>{s.head}</h2>
          <p className="sl-sub">{s.detail}</p>
        </div>
      );
    case 'best':
      return (
        <div className="sl sl-list">
          <span className="sl-eyebrow">Best sellers today</span>
          <h2>What everyone’s getting</h2>
          <ol>
            {s.rows.map((r) => (
              <li key={r.name}>
                <span className="sl-name">{r.name}</span>
              </li>
            ))}
          </ol>
        </div>
      );
    case 'ready':
      return (
        <div className="sl sl-ready">
          <span className="sl-eyebrow">Ready for pickup</span>
          <h2>Is your order here?</h2>
          <ul>
            {s.rows.map((r) => (
              <li key={r.number}>
                <b className="mono">{r.number}</b>
                <span className="sl-name">{r.name}</span>
              </li>
            ))}
          </ul>
          <p className="sl-sub">Come to the counter with your order number.</p>
        </div>
      );
    case 'wheel':
      return (
        <div className="sl sl-coupon">
          <span className="sl-eyebrow">Prize wheel</span>
          <h2>{s.rule}: spin the prize wheel!</h2>
          {s.prizes.length ? <p className="sl-sub">Win {s.prizes.join(', ')} and more.</p> : null}
        </div>
      );
    case 'media':
      if (!url) return <div className="sl sl-media" />;
      return (
        <div className="sl sl-media">
          {s.media === 'video' ? <video src={url} autoPlay muted playsInline onEnded={onEnded} onError={onEnded} /> : <img src={url} alt="" />}
        </div>
      );
  }
}
