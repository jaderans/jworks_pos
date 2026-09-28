import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { useApp } from '../../app/AppContext';
import { useEventData } from './useEventData';
import { useProductCosts, useSettingRows } from '../../hooks/data';
import { db } from '../../db/db';
import { settingValue } from '../../db/settings';
import { Badge, Button, Callout, Loading, Segmented, Toggle } from '../../components/ui';
import { Field, MoneyInput, NumberInput, SearchInput, Select } from '../../components/form';
import { formatPct, peso, parseMoney, type Cents } from '../../lib/money';
import { relativeTime } from '../../lib/time';
import { boothPricing } from '../../domain/quote';
import { bulkEventPrice, effectivePrice, setEventProduct, updateProduct, type BulkPriceOp } from '../../services/catalog';
import type { CalcSettings, JWEvent, Product } from '../../db/types';

export default function PricesTab({ ev }: { ev: JWEvent }) {
  const app = useApp();
  const d = useEventData(ev);
  const costs = useProductCosts();
  const settingRows = useSettingRows();
  const calc = settingValue<CalcSettings>(settingRows, 'calc');
  const history = useLiveQuery(async () => (await db.audit.orderBy('at').reverse().limit(400).toArray()).filter((a) => a.action === 'price').slice(0, 12), []);
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkKind, setBulkKind] = useState<'add' | 'percent' | 'round' | 'reset'>('add');
  const [bulkValue, setBulkValue] = useState<string>('5');
  const [helper, setHelper] = useState(false);
  const [expected, setExpected] = useState<number | null>(150);
  const [target, setTarget] = useState<Cents | null>(null);
  const showCosts = app.can('viewCosts');

  const epMap = useMemo(() => new Map(d.eventProducts.map((e) => [e.productId, e])), [d.eventProducts]);
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return d.products.filter((p) => (cat === 'all' || p.categoryId === cat) && (!q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)));
  }, [d.products, search, cat]);

  useEffect(() => setSelected(new Set()), [cat, search]);
  if (d.loading || !costs) return <Loading />;

  const fixed = d.share.costs.boothFee + d.share.costs.consumables + d.share.costs.assets;
  const catName = new Map(d.categories.map((c) => [c.id, c.name]));
  const targets = selected.size ? rows.filter((p) => selected.has(p.id)) : rows;
  const unpriced = d.products.filter((p) => p.active === 1 && effectivePrice(p, epMap.get(p.id)) === null).length;

  const applyBulk = async () => {
    let ops: BulkPriceOp;
    if (bulkKind === 'reset') ops = { kind: 'reset' };
    else if (bulkKind === 'round') ops = { kind: 'round', value: Number(bulkValue) || 5 };
    else if (bulkKind === 'percent') ops = { kind: 'percent', value: Number(bulkValue) || 0 };
    else ops = { kind: 'add', value: parseMoney(bulkValue) ?? 0 };
    const label = `${targets.length} product${targets.length === 1 ? '' : 's'}`;
    if (!(await app.confirm({ title: `Change prices on ${label}?`, message: 'Only this event’s prices change. Base prices stay as they are.', confirmLabel: 'Change prices' }))) return;
    const n = await bulkEventPrice(ev.id, targets, ops);
    app.toast(`Updated ${n} price${n === 1 ? '' : 's'} for ${ev.name}`, { tone: 'good' });
    setSelected(new Set());
  };

  return (
    <div className="stack loose">
      <p className="muted" style={{ maxWidth: '75ch' }}>
        The <b>base price</b> carries over to every event. An <b>event price</b> applies only to {ev.name} and leaves the base untouched. Every sale keeps the price it was sold at, so editing a price never changes past sales.
      </p>
      {unpriced ? <Callout tone="warn">{unpriced} active product{unpriced === 1 ? ' has' : 's have'} no price yet. They show as &ldquo;No price yet&rdquo; on the register.</Callout> : null}

      <div className="card">
        <div className="row wrap">
          <div className="grow" style={{ minWidth: 200 }}>
            <SearchInput value={search} onChange={setSearch} placeholder="Search products" />
          </div>
          <Select aria-label="Category" value={cat} onChange={(e) => setCat(e.target.value)} style={{ width: 'auto' }}>
            <option value="all">All categories</option>
            {d.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          {showCosts ? <Toggle id="booth-helper" checked={helper} onChange={setHelper} label="Booth-aware pricing" /> : null}
        </div>
        <div className="row wrap">
          <span className="strong small">{selected.size ? `${selected.size} selected:` : `All ${rows.length} shown:`}</span>
          <Segmented
            label="Bulk change"
            value={bulkKind}
            onChange={(v) => {
              setBulkKind(v);
              setBulkValue(v === 'round' ? '5' : v === 'percent' ? '10' : '5');
            }}
            options={[
              { value: 'add', label: '+ ₱' },
              { value: 'percent', label: '+ %' },
              { value: 'round', label: 'Round up' },
              { value: 'reset', label: 'Back to base' },
            ]}
          />
          {bulkKind !== 'reset' ? (
            <input className="input" style={{ width: 90 }} aria-label="Amount" inputMode="decimal" value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} />
          ) : null}
          {bulkKind === 'round' ? <span className="small muted">to the nearest ₱{bulkValue || 5}</span> : null}
          <Button size="sm" variant="teal" onClick={applyBulk} disabled={!targets.length}>
            Apply to event prices
          </Button>
        </div>
      </div>

      {helper && showCosts ? (
        <div className="card">
          <h2>Booth-aware pricing</h2>
          <p className="muted small">
            Event costs from Booth spend: <b>{peso(fixed)}</b> (booth fee {peso(d.share.costs.boothFee)}, used up {peso(d.share.costs.consumables)}, assets&rsquo; share {peso(d.share.costs.assets)}). Spread over the items you expect to sell, each item has to carry part of it. Base prices never change on their own; use the suggestions only where they make sense.
          </p>
          <div className="form-grid">
            <Field label="Items you expect to sell (whole event)" htmlFor="bp-exp">
              <NumberInput id="bp-exp" decimals={false} value={expected} onChange={setExpected} />
            </Field>
            <Field label="Profit you want from this event" htmlFor="bp-target" hint="Leave blank to just break even.">
              <MoneyInput id="bp-target" value={target} onChange={setTarget} />
            </Field>
          </div>
          <p className="small">
            Booth cost per item: <b>{expected ? peso(Math.round(fixed / expected)) : '—'}</b>
          </p>
        </div>
      ) : null}

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 36 }}>
                <input
                  type="checkbox"
                  aria-label="Select all shown"
                  checked={rows.length > 0 && selected.size === rows.length}
                  onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
                />
              </th>
              <th>Product</th>
              <th className="r">Base price</th>
              <th className="r">Event price</th>
              {showCosts ? <th className="r">Cost</th> : null}
              {showCosts ? <th className="r">Margin</th> : null}
              {helper && showCosts ? <th className="r">Floor</th> : null}
              {helper && showCosts ? <th className="r">Suggested</th> : null}
              <th>On sale</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const ep = epMap.get(p.id);
              const price = effectivePrice(p, ep);
              const cost = costs.get(p.id)?.current ?? null;
              const margin = price && cost !== null ? ((price - cost) / price) * 100 : null;
              const bp = helper && cost !== null && expected ? boothPricing({ fixedCosts: fixed, unitCost: cost, price: price ?? 0, expectedQty: expected, targetProfit: target ?? 0, roundTo: calc.roundTo }) : null;
              const onSale = p.active === 1 && (ep ? ep.active === 1 : true);
              return (
                <tr key={p.id} className={p.active ? '' : 'muted'}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Select ${p.name}`}
                      checked={selected.has(p.id)}
                      onChange={(e) => {
                        const next = new Set(selected);
                        if (e.target.checked) next.add(p.id);
                        else next.delete(p.id);
                        setSelected(next);
                      }}
                    />
                  </td>
                  <td>
                    <b>{p.name}</b>
                    <div className="muted tiny">
                      {catName.get(p.categoryId ?? '') ?? 'No category'}
                      {p.active ? '' : ' · inactive product'}
                    </div>
                  </td>
                  <td className="r" style={{ width: 130 }}>
                    <PriceCell value={p.price} label={`Base price of ${p.name}`} onCommit={(v) => updateProduct(p.id, { price: v })} />
                  </td>
                  <td className="r" style={{ width: 130 }}>
                    <PriceCell value={ep?.price ?? null} placeholder={p.price !== null ? String(p.price / 100) : ''} label={`Event price of ${p.name}`} onCommit={(v) => setEventProduct(ev.id, p.id, { price: v })} />
                  </td>
                  {showCosts ? <td className="r">{cost === null ? <Link to="/production" className="small">Set cost</Link> : peso(cost)}</td> : null}
                  {showCosts ? (
                    <td className="r">
                      {margin === null ? '—' : <span className={margin < calc.minMarginPct ? 'bad strong' : ''}>{formatPct(margin)}</span>}
                    </td>
                  ) : null}
                  {helper && showCosts ? <td className="r">{bp?.floorRounded ? peso(bp.floorRounded) : '—'}</td> : null}
                  {helper && showCosts ? (
                    <td className="r">
                      {bp?.targetPrice ? (
                        <Button size="sm" onClick={() => setEventProduct(ev.id, p.id, { price: bp.targetPrice })} disabled={bp.targetPrice === price} title="Use as this event's price">
                          {peso(bp.targetPrice)}
                        </Button>
                      ) : (
                        '—'
                      )}
                    </td>
                  ) : null}
                  <td>
                    <Toggle id={`onsale-${p.id}`} checked={onSale} disabled={p.active !== 1} onChange={(v) => setEventProduct(ev.id, p.id, { active: v ? 1 : 0 })} label={<span className="sr-only">On sale at {ev.name}</span>} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Recent price changes</h2>
        {history && history.length ? (
          <div className="stack tight">
            {history.map((h) => (
              <div key={h.id} className="row between small">
                <span>{h.summary}</span>
                <span className="muted nowrap">{relativeTime(h.at)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted small">No price changes yet.</p>
        )}
        <Link to="/activity" className="small">
          See the full activity log
        </Link>
      </div>
      <Badge tone="outline">Tip: margins in red are below your {calc.minMarginPct}% minimum.</Badge>
    </div>
  );
}

/** Edits a price and saves it when you leave the field or press Enter. */
function PriceCell({ value, onCommit, label, placeholder }: { value: Cents | null; onCommit: (v: Cents | null) => Promise<void> | void; label: string; placeholder?: string }) {
  const [draft, setDraft] = useState<Cents | null>(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) void onCommit(draft);
  };
  return (
    <div onBlur={commit}>
      <MoneyInput ariaLabel={label} value={draft} onChange={setDraft} placeholder={placeholder ?? '—'} onEnter={commit} />
    </div>
  );
}

export type { Product };
