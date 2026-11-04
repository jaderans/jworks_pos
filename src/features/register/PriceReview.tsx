import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { BadgePercent, Pencil, Tag } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { useBundleRules, useCategories, useEventProducts, useProducts } from '../../hooks/data';
import { Badge, Loading } from '../../components/ui';
import { SearchInput } from '../../components/form';
import { formatCount, peso } from '../../lib/money';
import { effectivePrice, isOnSale } from '../../services/catalog';
import type { BundleRule, JWEvent } from '../../db/types';

const plural = (n: number, one: string, many = `${one}s`) => `${formatCount(n)} ${n === 1 ? one : many}`;

/** The bundle deals the register applies at this event. */
function eventDeals(rules: BundleRule[], ev: JWEvent) {
  return rules.filter((r) => r.active === 1 && r.deleted !== 1 && (r.eventId === null || r.eventId === ev.id));
}

/**
 * The event's price list, before the register opens: what's on sale and at
 * what price, so whoever sells can check them first. It changes as soon as a
 * price is edited on any phone.
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
  if (!products || !categories || !eps || !rules) return <Loading />;

  const needle = q.trim().toLowerCase();
  const usedCats = categories.filter((c) => onSale.some((p) => p.categoryId === c.id));
  const matching = onSale.filter((p) => (cat === 'all' || p.categoryId === cat) && (!needle || `${p.name} ${p.sku}`.toLowerCase().includes(needle)));
  const groups = [...usedCats.map((c) => ({ id: c.id, name: c.name })), { id: null, name: 'Other' }]
    .map((g) => ({ ...g, items: matching.filter((p) => (g.id === null ? !usedCats.some((c) => c.id === p.categoryId) : p.categoryId === g.id)) }))
    .filter((g) => g.items.length);
  const priceOf = new Map(onSale.map((p) => [p.id, effectivePrice(p, epMap.get(p.id))]));
  const unpriced = onSale.filter((p) => priceOf.get(p.id) === null).length;
  const atEventPrice = onSale.filter((p) => {
    const price = priceOf.get(p.id) ?? null;
    return price !== null && p.price !== null && price !== p.price;
  }).length;
  const deals = eventDeals(rules, ev);

  return (
    <section className="card price-review" aria-label="Prices">
      <div className="price-head">
        <div className="card-head">
          <h2>
            <Tag size={20} className="teal" /> Prices at {ev.name}
          </h2>
          {app.can('editPrices') ? (
            <Link to="/event/prices" className="btn sm">
              <Pencil size={15} /> Edit prices
            </Link>
          ) : null}
        </div>
        <div className="price-facts">
          <span>
            <b>{formatCount(onSale.length)}</b> on sale
          </span>
          {atEventPrice ? (
            <span>
              <b>{formatCount(atEventPrice)}</b> at an event price, the regular one crossed out
            </span>
          ) : null}
          {unpriced ? (
            <Badge tone="warn">
              {plural(unpriced, 'product')} without a price{app.can('editPrices') ? '' : '; ask the owner'}
            </Badge>
          ) : onSale.length ? (
            <Badge tone="good">Every product has a price</Badge>
          ) : null}
        </div>
      </div>
      <div className="price-tools">
        <SearchInput value={q} onChange={setQ} placeholder="Find a product" ariaLabel="Find a product" />
        {usedCats.length > 1 ? (
          <div className="chip-row" role="group" aria-label="Categories">
            <button type="button" className="chip" aria-pressed={cat === 'all'} onClick={() => setCat('all')}>
              All <span className="chip-count">{onSale.length}</span>
            </button>
            {usedCats.map((c) => (
              <button key={c.id} type="button" className="chip" aria-pressed={cat === c.id} onClick={() => setCat(c.id)}>
                {c.name} <span className="chip-count">{onSale.filter((p) => p.categoryId === c.id).length}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="price-body">
        {groups.length === 0 ? <p className="muted small">{onSale.length ? 'Nothing matches.' : 'Nothing is on sale at this event yet.'}</p> : null}
        {groups.map((g) => (
          <div key={g.id ?? 'other'} className="price-group">
            {groups.length > 1 || usedCats.length > 1 ? (
              <h3>
                {g.name} <span className="muted">{g.items.length}</span>
              </h3>
            ) : null}
            <div className="price-grid">
              {g.items.map((p) => {
                const price = priceOf.get(p.id) ?? null;
                const changed = price !== null && p.price !== null && price !== p.price;
                const deal = deals.find((r) => r.productIds.includes(p.id));
                return (
                  <div key={p.id} className={`price-row${price === null ? ' none' : ''}`}>
                    <span className="price-name">
                      <b>{p.name}</b>
                      {p.sku ? <span className="mono">{p.sku}</span> : null}
                      {deal ? (
                        <span className="deal">
                          {deal.qty} for {peso(deal.price)}
                        </span>
                      ) : null}
                    </span>
                    <span className="price-now">
                      {price === null ? <Badge tone="warn">No price</Badge> : <b className="num">{peso(price)}</b>}
                      {changed ? (
                        <s className="num" title="Regular price">
                          {peso(p.price)}
                        </s>
                      ) : null}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/** The bundle deals and discounts at this event, beside the price list. Nothing when there are none. */
export function DealsReview({ ev }: { ev: JWEvent }) {
  const products = useProducts();
  const rules = useBundleRules();
  const nameOf = useMemo(() => new Map((products ?? []).map((p) => [p.id, p.name])), [products]);
  if (!products || !rules) return null;
  const deals = eventDeals(rules, ev);
  if (!deals.length && !ev.discounts.length) return null;

  return (
    <section className="card stack deals-review" aria-label="Deals and discounts">
      <h2 className="row">
        <BadgePercent size={20} className="teal" /> Deals and discounts
      </h2>
      {deals.length ? (
        <div className="stack tight">
          <h3>Bundle deals</h3>
          <p className="muted small">The register applies these by itself.</p>
          <div className="list">
            {deals.map((r) => (
              <div key={r.id} className="list-item deal-row">
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
              <div key={d.id} className="list-item deal-row">
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
