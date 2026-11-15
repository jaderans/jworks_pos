import { useEffect, useMemo, useState } from 'react';
import { ENJOY, SAMPLE_KIND_NAME, claimNo, minisFor, packWhat, readyText, sampleKindOf, type SampleKind, type StickPack } from '../../domain/stick';
import { MINI_STICKERS } from '../../domain/miniStickers';
import { miniPic } from '../stick/MiniPicker';
import { fmtTime } from '../../lib/time';
import { peso } from '../../lib/money';
import type { DisplayStick } from '../../domain/display';
import './order.css';

const miniName = new Map(MINI_STICKERS.map((m) => [m.no, m.name]));

/** A sticker made for a past customer, kept on this laptop (Settings → Customer screen). */
export interface SampleSticker {
  id: string;
  blob: Blob;
  sample?: SampleKind;
}

/** How many samples show at once, and how often the next one comes in. */
const SHOWN = 3;
const NEXT_MS = 5000;

/**
 * The customer checks their Couple-of-Stickers order while the cashier fills
 * it in: their name, when it's ready, what they paid, each pack and the mini
 * stickers they picked, beside stickers we made for others with the same pack.
 * Once saved, their claim number sits at the top.
 */
export function OrderCheck({ o, now, photo, samples }: { o: DisplayStick; now: number; photo?: Blob | null; samples?: readonly SampleSticker[] }) {
  const photoUrl = useObjectUrl(photo ?? null);
  // Samples of the packs in this order, turning one at a time.
  const kinds = [...new Set(o.packs.map((p) => sampleKindOf(p.pack)))];
  const mine = useMemo(() => (samples ?? []).filter((s) => kinds.includes(s.sample ?? 'couple')), [samples, kinds.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const [turn, setTurn] = useState(0);
  useEffect(() => {
    if (mine.length <= SHOWN) return;
    const t = window.setInterval(() => setTurn((n) => n + 1), NEXT_MS);
    return () => window.clearInterval(t);
  }, [mine.length]);
  const shown = mine.length <= SHOWN ? mine : Array.from({ length: SHOWN }, (_, k) => mine[(turn + k) % mine.length]);
  const many = o.packs.length > 1;
  const photoNote = photoUrl ? 'Taken: our illustrator draws from it' : o.photo === 'booth' ? 'We take it at our photo booth' : o.photo === 'message' ? 'Send your best photo to JoshWorks' : 'Not needed';

  return (
    <section className={`cd-full cd-order${shown.length || photoUrl ? '' : ' no-side'}`} aria-label="Your Couple-of-Stickers order">
      <header className="cd-order-top">
        <div className="cd-order-who">
          <span className="sl-eyebrow">{o.number ? 'Thank you! Your order is in' : 'Please check your order'}</span>
          <h1>{o.nickname || 'Your stickers'}</h1>
        </div>
        {o.number ? (
          <div className="cd-order-ticket" aria-label="Your number">
            <span>Your number</span>
            <b className="cd-order-no num">{claimNo(o.number)}</b>
          </div>
        ) : null}
      </header>

      <div className="cd-order-facts">
        <div className="cd-fact">
          <span>Ready in</span>
          <b>{readyText(o, now)}</b>
          <small>around {fmtTime(o.readyFrom)}</small>
        </div>
        <div className="cd-fact good">
          <span>Paid</span>
          <b className="num">{peso(o.paid)}</b>
          <small>{o.paidWith}</small>
        </div>
        <div className="cd-fact">
          <span>Your photo</span>
          <b>{photoUrl ? 'Got it' : o.photo === 'booth' ? 'At our booth' : o.photo === 'message' ? 'Send it to us' : 'None'}</b>
          <small>{photoNote}</small>
        </div>
      </div>

      <div className="cd-order-body">
        <ol className={`cd-order-packs${many ? ' many' : ''}`}>
          {o.packs.map((p: StickPack, i) => (
            <li key={i}>
              <div className="cd-order-pack">
                <b>{p.name}</b>
                <small>
                  {packWhat(p)} · {p.making === 'illustrating' ? 'we draw it' : 'we print it'}
                </small>
              </div>
              {minisFor(p) ? (
                <div className="cd-order-minis" aria-label="Mini stickers">
                  {p.minis.length ? (
                    p.minis.map((n) => (
                      <figure key={n}>
                        {miniPic(n) ? <img src={miniPic(n)} alt="" /> : null}
                        <figcaption>
                          {n} {miniName.get(n) ?? ''}
                        </figcaption>
                      </figure>
                    ))
                  ) : (
                    <span className="cd-order-muted">Pick your {minisFor(p)} mini stickers with us</span>
                  )}
                </div>
              ) : null}
              {p.addOns?.length ? (
                <div className="cd-order-addons">
                  {p.addOns.map((a, k) => (
                    <span key={k} className="cd-addon">
                      + {a}
                    </span>
                  ))}
                </div>
              ) : null}
              {p.note ? <p className="cd-order-muted">{p.note}</p> : null}
            </li>
          ))}
          {o.addOns.length ? (
            <li className="cd-order-also">
              <span className="cd-order-muted">Also</span>
              <div className="cd-order-addons">
                {o.addOns.map((a, k) => (
                  <span key={k} className="cd-addon">
                    + {a}
                  </span>
                ))}
              </div>
            </li>
          ) : null}
        </ol>

        {shown.length || photoUrl ? (
          <aside className="cd-order-side">
            {photoUrl ? (
              <figure className="cd-order-photo-pic">
                <img src={photoUrl} alt="Your photo" />
                <figcaption>Your photo: our illustrator works from this</figcaption>
              </figure>
            ) : null}
            {shown.length ? (
              <div className="cd-order-samples" aria-label="Stickers we made">
                <span className="sl-eyebrow">What you’ll get</span>
                <div className={`cd-order-samples-grid n${shown.length}`}>
                  {shown.map((s, k) => (
                    <SamplePic key={`${s.id}:${k}`} blob={s.blob} />
                  ))}
                </div>
                <small>{kinds.map((k) => SAMPLE_KIND_NAME[k]).join(' and ')} stickers we made at past events</small>
              </div>
            ) : null}
          </aside>
        ) : null}
      </div>

      <p className="cd-order-enjoy">{ENJOY}</p>
    </section>
  );
}

function SamplePic({ blob }: { blob: Blob }) {
  const url = useObjectUrl(blob);
  return url ? <img src={url} alt="" /> : null;
}

/** An object URL for a blob, let go when it changes or the view closes. */
function useObjectUrl(blob: Blob | null): string {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!blob) return setUrl('');
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}
