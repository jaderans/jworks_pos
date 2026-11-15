import { useEffect, useMemo, useState } from 'react';
import { ENJOY, SAMPLE_KIND_NAME, claimNo, minisFor, packPeople, packWhat, readyText, sampleKindOf, type SampleKind, type StickPack } from '../../domain/stick';
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

/** How many samples show at once (one pack), and how often the next one comes in. */
const SHOWN = 3;
const NEXT_MS = 5000;

/**
 * The customer checks their Couple-of-Stickers order while the cashier fills
 * it in: their name, when it's ready, what they paid, their photo, then each
 * pack: who's drawn on it (and where they are in the photo), the mini stickers
 * they picked. One pack sits beside samples of the same kind; two or more sit
 * side by side, each with its own photo or a sample. Once saved, their claim
 * number is at the top.
 */
export function OrderCheck({ o, now, photo, packPics, samples }: { o: DisplayStick; now: number; photo?: Blob | null; packPics?: readonly (Blob | null)[]; samples?: readonly SampleSticker[] }) {
  const photoUrl = useObjectUrl(photo ?? null);
  const multi = o.packs.length > 1;
  const kinds = [...new Set(o.packs.map((p) => sampleKindOf(p.pack)))];
  const mine = useMemo(() => (samples ?? []).filter((s) => kinds.includes(s.sample ?? 'couple')), [samples, kinds.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  // The samples turn, one at a time.
  const [turn, setTurn] = useState(0);
  useEffect(() => {
    if (mine.length <= 1) return;
    const t = window.setInterval(() => setTurn((n) => n + 1), NEXT_MS);
    return () => window.clearInterval(t);
  }, [mine.length]);
  const shown = mine.length <= SHOWN ? mine : Array.from({ length: SHOWN }, (_, k) => mine[(turn + k) % mine.length]);
  /** A sample of this pack's kind, a different one per pack where there are enough. */
  const sampleFor = (p: StickPack, i: number) => {
    const of = mine.filter((s) => (s.sample ?? 'couple') === sampleKindOf(p.pack));
    return of.length ? of[(turn + i) % of.length] : null;
  };

  const packPhotos = o.packs.filter((_, i) => packPics?.[i]).length;
  const havePhoto = !!photoUrl || packPhotos > 0;
  const photoNote = photoUrl
    ? 'Taken: our illustrator draws from it'
    : packPhotos
      ? `${packPhotos} of ${o.packs.length} packs have their photo`
      : o.photo === 'booth'
        ? 'We take it at our photo booth'
        : o.photo === 'message'
          ? 'Send your best photo to JoshWorks'
          : 'Not needed';
  const side = !multi && (shown.length > 0 || !!photoUrl || !!packPics?.[0]);

  return (
    <section className={`cd-full cd-order${multi ? ` multi n${Math.min(o.packs.length, 5)}` : side ? '' : ' no-side'}`} aria-label="Your Couple-of-Stickers order">
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
        <div className={`cd-fact${multi && photoUrl ? ' with-pic' : ''}`}>
          <div>
            <span>Your photo</span>
            <b>{havePhoto ? 'Got it' : o.photo === 'booth' ? 'At our booth' : o.photo === 'message' ? 'Send it to us' : 'None'}</b>
            <small>{photoNote}</small>
          </div>
          {multi && photoUrl ? <img src={photoUrl} alt="Your photo" /> : null}
        </div>
      </div>

      <div className="cd-order-body">
        <ol className="cd-order-packs">
          {o.packs.map((p, i) => (
            <PackCard key={i} p={p} i={i} multi={multi} pic={multi ? (packPics?.[i] ?? null) : null} sample={multi && !packPics?.[i] ? sampleFor(p, i) : null} />
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

        {side ? (
          <aside className="cd-order-side">
            {photoUrl || packPics?.[0] ? <PhotoFigure blob={(packPics?.[0] ?? photo)!} /> : null}
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

/** One pack: what it is, who's on it, its mini stickers and add-ons; with two or more packs, its own picture beside it. */
function PackCard({ p, i, multi, pic, sample }: { p: StickPack; i: number; multi: boolean; pic: Blob | null; sample: SampleSticker | null }) {
  const people = packPeople(p).filter((x) => x.name.trim() || x.who.trim());
  return (
    <li className="cd-pack" aria-label={`Pack ${i + 1}: ${p.name}`}>
      {multi && (pic || sample) ? (
        <figure className="cd-pack-pic">
          <SamplePic blob={(pic ?? sample!.blob)!} />
          <figcaption>{pic ? 'Your photo' : 'Like this'}</figcaption>
        </figure>
      ) : null}
      <div className="cd-pack-main">
        <div className="cd-order-pack">
          <b>{p.name}</b>
          <small>
            {packWhat(p)} · {p.making === 'illustrating' ? 'we draw it' : 'we print it'}
          </small>
        </div>
        {people.length ? (
          <div className="cd-people" aria-label="Who’s on it">
            {people.map((x, k) => (
              <span key={k} className="cd-person">
                <b>{x.name.trim() || `Person ${k + 1}`}</b>
                {x.who.trim() ? <small>{x.who.trim()}</small> : null}
              </span>
            ))}
          </div>
        ) : null}
        {minisFor(p) ? (
          <div className="cd-order-minis" aria-label="Mini stickers">
            {p.minis.length ? (
              p.minis.map((n) => (
                <figure key={n} title={`${n} ${miniName.get(n) ?? ''}`}>
                  {miniPic(n) ? <img src={miniPic(n)} alt="" /> : null}
                  <figcaption>{multi ? n : `${n} ${miniName.get(n) ?? ''}`}</figcaption>
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
        {p.note ? <p className="cd-order-muted cd-pack-note">{p.note}</p> : null}
      </div>
    </li>
  );
}

function PhotoFigure({ blob }: { blob: Blob }) {
  const url = useObjectUrl(blob);
  return url ? (
    <figure className="cd-order-photo-pic">
      <img src={url} alt="Your photo" />
      <figcaption>Your photo: our illustrator works from this</figcaption>
    </figure>
  ) : null;
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
