import { useEffect, useState } from 'react';
import { claimNo } from '../../domain/stick';
import type { DisplayShowcase } from '../../display/channel';
import './order.css';

/**
 * An order shown off on the customer screen from Orders: the finished sticker
 * big, with its order number and the customer's first name. For a few
 * seconds, over whatever else is on screen.
 */
export function Showcase({ s }: { s: DisplayShowcase }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!s.art) return setUrl('');
    const u = URL.createObjectURL(s.art);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [s.art]);
  return (
    <section className="cd-showcase" aria-label="Fresh from the booth">
      {url ? <img src={url} alt={s.label} className="cd-showcase-art" /> : <div className="cd-showcase-art empty">{s.label}</div>}
      <div className="cd-showcase-text">
        <span className="sl-eyebrow">Fresh from the booth</span>
        <b className="num">Order {claimNo(s.number)}</b>
        {s.name ? <span className="cd-showcase-name">{s.name}’s Couple-of-Stickers</span> : null}
        <span className="cd-showcase-cta">{s.cta}</span>
      </div>
    </section>
  );
}
