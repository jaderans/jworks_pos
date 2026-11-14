import { ENJOY, claimNo, minisFor, packLabel, readyText, type StickPack } from '../../domain/stick';
import { MINI_STICKERS } from '../../domain/miniStickers';
import { miniPic } from '../stick/MiniPicker';
import { fmtTime } from '../../lib/time';
import { peso } from '../../lib/money';
import type { DisplayStick } from '../../domain/display';
import './order.css';

const miniName = new Map(MINI_STICKERS.map((m) => [m.no, m.name]));

/**
 * The customer checks their Couple-of-Stickers order while the cashier fills
 * it in: their name, each pack, the mini stickers they picked. Once saved, it
 * shows their number and when it should be ready.
 */
export function OrderCheck({ o, now }: { o: DisplayStick; now: number }) {
  return (
    <section className="cd-full cd-order" aria-label="Your Couple-of-Stickers order">
      <div className="cd-order-head">
        <span className="sl-eyebrow">{o.number ? 'Your number' : 'Please check your order'}</span>
        {o.number ? <b className="cd-order-no num">{claimNo(o.number)}</b> : null}
        <h1>{o.nickname || 'Your stickers'}</h1>
        <p className="cd-order-ready">
          Ready in {readyText(o, now)}, around {fmtTime(o.readyFrom)}
        </p>
        <p className="cd-order-paid">
          Paid {peso(o.paid)} · {o.paidWith}
        </p>
      </div>
      <ol className="cd-order-packs">
        {o.packs.map((p: StickPack, i) => (
          <li key={i}>
            <div className="cd-order-pack">
              <b>{p.name}</b>
              <span className="cd-chip">{packLabel(p)}</span>
              <span className="cd-chip">{p.making === 'illustrating' ? 'We draw it' : 'We print it'}</span>
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
                  <span className="cd-order-muted">Pick {minisFor(p)} mini stickers with us</span>
                )}
              </div>
            ) : null}
            {p.addOns?.length ? <p className="cd-order-addons">{p.addOns.map((a) => `+ ${a}`).join('   ')}</p> : null}
            {p.note ? <p className="cd-order-muted">{p.note}</p> : null}
          </li>
        ))}
      </ol>
      <div className="cd-order-foot">
        {o.addOns.length ? <p>Also {o.addOns.join(', ')}</p> : null}
        <p className="cd-order-photo">
          {o.photo === 'booth'
            ? 'We’ll take your photo at our photo booth.'
            : o.photo === 'message'
              ? 'Send your best photo to JoshWorks: a clear, well-lit one works best. Or ask us to take it at our photo booth!'
              : ''}
        </p>
        <p className="cd-order-enjoy">{ENJOY}</p>
      </div>
    </section>
  );
}
