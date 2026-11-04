import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Tag } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { useBundleRules, useCategories, useEventProducts, useProducts } from '../../hooks/data';
import { Badge, Loading } from '../../components/ui';
import { SearchInput } from '../../components/form';
import { formatCount, peso } from '../../lib/money';
import { effectivePrice, isOnSale } from '../../services/catalog';
import type { JWEvent } from '../../db/types';

/**
 * The event's price list, before the register opens: what's on sale and at
 * what price, the bundle deals and the discounts, so whoever sells can check
 * them first. It changes as soon as a price is edited on any phone.
 */
export function PriceReview({ ev }: { ev: JWEvent }) {
  const app = useApp();
  const products = useProducts();
  const categories = useCategories();
  const eps = useEventProducts(ev.id);
  const rules = useBundleRules();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');

  const epMap = useMemo(() => new Map((eps ?? []).map((e) => [e.productId, e])), [eps]);
  const onSale = useMemo(() => (products ?? []).filter((p) => isOnSale(p, epMap.get(p.id))), [products, epMap]);
  const nameOf = useMemo(() => new Map((products ?? []).map((p) => [p.id, p.name])), [products]);
  if (!products || !categories || !eps || !rules) return <Loading />;

  const needle = q.trim().toLowerCase();
  const usedCats = categories.filter((c) => onSale.some((p) => p.categoryId === c.id));
  const matching = onSale.filter((p) => (cat === 'all' || p.categoryId === cat) && (!needle || `${p.name} ${p.sku}`.toLowerCase().includes(needle)));
  const groups = [...usedCats.map((c) => ({ id: c.id, name: c.name })), { id: null, name: 'Other' }]
    .map((g) => ({ ...g, items: matching.filter((p) => (g.id === null ? !usedCats.some((c) => c.id === p.categoryId) : p.categoryId === g.id)) }))
    .filter((g) => g.items.length);
  const unpriced = onSale.filter((p) => effectivePrice(p, epMap.get(p.id)) === null).length;
  const deals = rules.filter((r) => r.active === 1 && r.deleted !== 1 && (r.eventId === null || r.eventId === ev.id));

  return (
    <section className="card stack price-review" aria-label="Prices">
      <div className="card-head">
        <h2>
          <Tag size={20} className="teal" /> Prices at {ev.name}
        </h2>
        {app.can('editPrices') ? (
          <Link to="/event/prices" className="small strong">
            Edit prices
          </Link>
        ) : null}
      </div>
      <p className="sub">
        Check these before you open: {formatCount(onSale.length)} product{onSale.length === 1 ? '' : 's'} on sale. Event prices replace the regular price; it’s shown crossed out.
      </p>
      {unpriced ? (
        <div>
          <Badge tone="warn">
            {unpriced} product{unpriced === 1 ? ' has' : 's have'} no price yet{app.can('editPrices') ? '' : '; ask the owner'}
          </Badge>
        </div>
      ) : null}
      <SearchInput value={q} onChange={setQ} placeholder="Find a product" ariaLabel="Find a product" />
      {usedCats.length > 1 ? (
        <div className="chip-row" role="group" aria-label="Categories">
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
      {groups.length === 0 ? <p className="muted small">{onSale.length ? 'Nothing matches.' : 'Nothing is on sale at this event yet.'}</p> : null}
      {groups.map((g) => (
        <div key={g.id ?? 'other'} className="stack tight">
          {groups.length > 1 || usedCats.length > 1 ? <h3>{g.name}</h3> : null}
          <div className="list">
            {g.items.map((p) => {
              const ep = epMap.get(p.id);
              const price = effectivePrice(p, ep);
              const changed = price !== null && p.price !== null && price !== p.price;
              return (
                <div key={p.id} className="list-item price-row">
                  <span className="main-text">
                    <b>{p.name}</b>
                    {p.sku ? <span className="mono">{p.sku}</span> : null}
                  </span>
                  <span className="price-now">
                    {changed ? <s className="muted small">{peso(p.price)}</s> : null}
                    {price === null ? <Badge tone="warn">No price</Badge> : <b className="num">{peso(price)}</b>}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {deals.length ? (
        <div className="stack tight">
          <h3>Bundle deals</h3>
          <p className="muted small">The register applies these by itself.</p>
          <div className="list">
            {deals.map((r) => (
              <div key={r.id} className="list-item price-row">
                <span className="main-text">
                  <b>{r.name}</b>
                  <span>{r.productIds.map((id) => nameOf.get(id)).filter(Boolean).join(', ')}</span>
                </span>
                <b className="num nowrap">
                  {r.qty} for {peso(r.price)}
                </b>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {ev.discounts.length ? (
        <div className="stack tight">
          <h3>Discounts you can give</h3>
          <div className="list">
            {ev.discounts.map((d) => (
              <div key={d.id} className="list-item price-row">
                <span className="main-text">
                  <b>{d.label}</b>
                  {d.needsPin ? <span>Needs the owner PIN</span> : null}
                </span>
                <b className="num nowrap">{d.kind === 'percent' ? `${d.value}% off` : `${peso(d.value)} off`}</b>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
