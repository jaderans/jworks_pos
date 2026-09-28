import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useApp } from '../../app/AppContext';
import { useEventData } from './useEventData';
import { useStockMoves } from '../../hooks/data';
import { Badge, Button, Loading } from '../../components/ui';
import { NumberInput, SearchInput } from '../../components/form';
import { formatPct } from '../../lib/money';
import { onHandByProduct, soldByProduct } from '../../domain/stock';
import { setEventProduct } from '../../services/catalog';
import type { JWEvent } from '../../db/types';

export default function StockTab({ ev }: { ev: JWEvent }) {
  const app = useApp();
  const d = useEventData(ev);
  const moves = useStockMoves();
  const [search, setSearch] = useState('');
  const canEdit = app.can('editProducts');

  const onHand = useMemo(() => onHandByProduct(moves ?? []), [moves]);
  const sold = useMemo(() => soldByProduct(d.sales), [d.sales]);
  const epMap = useMemo(() => new Map(d.eventProducts.map((e) => [e.productId, e])), [d.eventProducts]);
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return d.products
      .filter((p) => p.active === 1 && (!q || p.name.toLowerCase().includes(q)))
      .sort((a, b) => (sold.get(b.id) ?? 0) - (sold.get(a.id) ?? 0) || a.sort - b.sort);
  }, [d.products, search, sold]);

  if (d.loading || !moves) return <Loading />;

  const bringAll = async () => {
    const tracked = d.products.filter((p) => p.active === 1 && p.trackStock === 1);
    if (!(await app.confirm({ title: 'Bring everything on hand?', message: `Sets "brought" to the studio stock for ${tracked.length} tracked products.`, confirmLabel: 'Set counts' }))) return;
    for (const p of tracked) await setEventProduct(ev.id, p.id, { stockBrought: Math.max(0, onHand.get(p.id) ?? 0) });
    app.toast('Stock brought is set from studio stock', { tone: 'good' });
  };

  return (
    <div className="stack loose">
      <p className="muted" style={{ maxWidth: '75ch' }}>
        Count what you bring to {ev.name}. The register shows how many are left, and sell-through (sold ÷ brought) feeds partner tiers and the report. Made-to-order items like live sticker packs don&rsquo;t need a count.
      </p>
      <div className="row wrap">
        <div className="grow" style={{ minWidth: 200 }}>
          <SearchInput value={search} onChange={setSearch} placeholder="Search products" />
        </div>
        {canEdit ? (
          <>
            <Button onClick={bringAll}>Bring everything on hand</Button>
            <Link to="/production" className="btn">
              Log a production batch
            </Link>
          </>
        ) : null}
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Product</th>
              <th className="r hide-phone">Studio stock</th>
              <th className="r">Brought</th>
              <th className="r">Sold</th>
              <th className="r">Left</th>
              <th className="r hide-phone">Sell-through</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const ep = epMap.get(p.id);
              const s = sold.get(p.id) ?? 0;
              const brought = ep?.stockBrought ?? null;
              const left = brought === null ? null : brought - s;
              return (
                <tr key={p.id}>
                  <td>
                    <b>{p.name}</b>
                    {p.trackStock ? null : <div className="muted tiny">Made to order</div>}
                  </td>
                  <td className="r hide-phone">{p.trackStock ? onHand.get(p.id) ?? 0 : '—'}</td>
                  <td className="r" style={{ width: 120 }}>
                    {canEdit && p.trackStock ? (
                      <BroughtCell value={brought} onCommit={(n) => setEventProduct(ev.id, p.id, { stockBrought: n })} label={`Brought: ${p.name}`} />
                    ) : (
                      brought ?? '—'
                    )}
                  </td>
                  <td className="r strong">{s}</td>
                  <td className="r">{left === null ? '—' : <Badge tone={left <= 0 ? 'bad' : left <= 3 ? 'warn' : 'good'}>{left}</Badge>}</td>
                  <td className="r hide-phone">{brought ? formatPct((s / brought) * 100) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BroughtCell({ value, onCommit, label }: { value: number | null; onCommit: (n: number | null) => void; label: string }) {
  const [draft, setDraft] = useState<number | null>(value);
  return (
    <div onBlur={() => draft !== value && onCommit(draft)}>
      <NumberInput ariaLabel={label} decimals={false} min={0} value={draft} onChange={setDraft} placeholder="—" />
    </div>
  );
}
