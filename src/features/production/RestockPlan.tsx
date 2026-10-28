import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Factory, FileDown, PackagePlus } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { alive, db } from '../../db/db';
import { useEvents, useMaterials, useProductCosts, useProducts, useSettingRows, useStockMoves } from '../../hooks/data';
import { settingValue } from '../../db/settings';
import { safeFileName } from '../../lib/files';
import { Button, Callout, EmptyState, Loading } from '../../components/ui';
import { Field, NumberInput, Select } from '../../components/form';
import { peso, sum } from '../../lib/money';
import { daysBetween, fmtDateRange, todayISO } from '../../lib/time';
import { onHandByProduct, soldByProduct } from '../../domain/stock';
import { isRevenueSale } from '../../domain/orders';
import { openHours } from '../../domain/plan';
import { materialsFor, restockPlan, type PastEvent } from '../../domain/restock';
import { setEventProduct } from '../../services/catalog';
import type { BusinessSettings, Recipe } from '../../db/types';

/** Hours to assume per event day when the register times are missing or too short to trust. */
const HOURS_PER_DAY = 8;

/** What to make before the next event, and the materials to buy for it. */
export function RestockPlan({ onMake }: { onMake: (productId: string, qty: number) => void }) {
  const app = useApp();
  const events = useEvents();
  const products = useProducts();
  const moves = useStockMoves();
  const costs = useProductCosts();
  const materials = useMaterials();
  const business = settingValue<BusinessSettings>(useSettingRows(), 'business');
  const salesCount = useLiveQuery(() => db.sales.count(), []);
  const today = todayISO();

  const upcoming = useMemo(() => (events ?? []).filter((e) => e.status !== 'reported').sort((a, b) => (a.startDate || '9').localeCompare(b.startDate || '9')), [events]);
  const [targetId, setTargetId] = useState('');
  const [hours, setHours] = useState<number | null>(null);
  const [safety, setSafety] = useState<number | null>(20);
  const [basedOn, setBasedOn] = useState(3);
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [past, setPast] = useState<PastEvent[] | null>(null);

  // Default target: the next event that hasn't happened yet, else the one being worked on.
  useEffect(() => {
    if (targetId || !events) return;
    const next = upcoming.find((e) => e.startDate && e.startDate >= today) ?? upcoming.find((e) => e.id === app.activeEventId) ?? upcoming[0];
    if (next) setTargetId(next.id);
  }, [events, upcoming, targetId, today, app.activeEventId]);
  const target = (events ?? []).find((e) => e.id === targetId);
  useEffect(() => {
    if (target) setHours(Math.max(1, daysBetween(target.startDate, target.endDate).length || 1) * HOURS_PER_DAY);
    setOverrides({});
  }, [target?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Recent events with sales, before the target, newest first.
  useEffect(() => {
    if (!events) return;
    let live = true;
    void (async () => {
      const candidates = events
        .filter((e) => e.id !== targetId && (!target?.startDate || !e.startDate || e.startDate <= target.startDate))
        .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
      const out: PastEvent[] = [];
      for (const e of candidates) {
        if (out.length >= basedOn) break;
        const sales = alive(await db.sales.where('eventId').equals(e.id).toArray()).filter(isRevenueSale);
        if (!sales.length) continue;
        const sessions = alive(await db.sessions.where('eventId').equals(e.id).toArray());
        const intervals = sessions.map((s) => [s.openedAt, s.closedAt ?? Math.max(s.openedAt, ...sales.filter((x) => x.sessionId === s.id).map((x) => x.at))] as [number, number]);
        let h = intervals.length ? openHours(intervals) : 0;
        if (h < 1) h = Math.max(1, daysBetween(e.startDate, e.endDate).length || 1) * HOURS_PER_DAY;
        const sold = soldByProduct(sales);
        const eps = alive(await db.eventProducts.where('eventId').equals(e.id).toArray());
        out.push({ eventId: e.id, name: e.name, hours: h, sold, offered: new Set([...sold.keys(), ...eps.filter((x) => (x.stockBrought ?? 0) > 0).map((x) => x.productId)]) });
      }
      if (live) setPast(out);
    })();
    return () => {
      live = false;
    };
  }, [events, targetId, target?.startDate, basedOn, salesCount]);

  const onHand = useMemo(() => onHandByProduct(moves ?? []), [moves]);
  const rows = useMemo(
    () => (products && past ? restockPlan({ products, past, plannedHours: hours ?? 0, safetyPct: safety ?? 0, onHand }) : []),
    [products, past, hours, safety, onHand],
  );
  const makeOf = (r: (typeof rows)[number]) => overrides[r.productId] ?? r.make;
  const recipes = useMemo(() => new Map([...(costs?.values() ?? [])].filter((c) => c.mode === 'recipe' && c.recipe).map((c) => [c.id, c.recipe as Recipe])), [costs]);
  const matMap = useMemo(() => new Map((materials ?? []).map((m) => [m.id, m])), [materials]);
  const needs = useMemo(() => materialsFor(rows.map((r) => ({ productId: r.productId, qty: makeOf(r) })), recipes, matMap), [rows, overrides, recipes, matMap]); // eslint-disable-line react-hooks/exhaustive-deps
  const noRecipe = rows.filter((r) => makeOf(r) > 0 && !recipes.has(r.productId)).length;
  const toBuy = needs.filter((n) => n.packs > 0);
  const buyCost = sum(toBuy.map((n) => n.cost ?? 0));

  if (!events || !products || !past) return <Loading />;
  if (!upcoming.length) return <EmptyState icon={<Factory size={44} />} title="No event to plan for">Create the next event first.</EmptyState>;

  const useAsStock = async () => {
    if (!target) return;
    if (!(await app.confirm({ title: `Set the stock to bring for ${target.name}?`, message: `Each product’s target (${rows.length} products) becomes its “brought” count in Event → Stock. You can still change them there.`, confirmLabel: 'Set stock to bring' }))) return;
    for (const r of rows) await setEventProduct(target.id, r.productId, { stockBrought: r.target });
    app.toast(`Stock to bring set for ${target.name}`, { tone: 'good' });
  };
  const printPlan = async () => {
    const { buildRestockPdf } = await import('../../reports/restockPdf');
    const { deliverPdf } = await import('../../reports/pdf');
    await deliverPdf(await buildRestockPdf({ business: business.name, eventName: target?.name ?? 'Next event', hours: hours ?? 0, safety: safety ?? 0, basedOn: past.map((p) => p.name), rows: rows.map((r) => ({ ...r, make: makeOf(r) })), needs: toBuy }), `Restock plan - ${safeFileName(target?.name ?? 'next event')}.pdf`);
  };

  return (
    <div className="stack loose">
      <div className="card">
        <div className="form-grid">
          <Field label="Plan for" htmlFor="rp-target">
            <Select id="rp-target" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
              {upcoming.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} · {fmtDateRange(e.startDate, e.endDate)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Hours the booth will be open" htmlFor="rp-hours" hint={`${HOURS_PER_DAY} per event day to start with.`}>
            <NumberInput id="rp-hours" value={hours} onChange={setHours} suffix="h" />
          </Field>
          <Field label="Extra to be safe" htmlFor="rp-safety" hint="So the table doesn’t run out by the afternoon.">
            <NumberInput id="rp-safety" value={safety} onChange={setSafety} suffix="%" />
          </Field>
          <Field label="Based on" htmlFor="rp-based">
            <Select id="rp-based" value={String(basedOn)} onChange={(e) => setBasedOn(Number(e.target.value))}>
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  The last {n === 1 ? 'event' : `${n} events`}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <p className="muted small">
          {past.length
            ? `From ${past.map((p) => `${p.name} (${p.hours} h)`).join(', ')}; the most recent counts most. Products only count events where they were on the table.`
            : 'No past event with sales yet. Sell at an event first, then plan the next one.'}
        </p>
      </div>

      {rows.length ? (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="r hide-phone">Sold per hour</th>
                  <th className="r hide-phone">Expected</th>
                  <th className="r">Bring</th>
                  <th className="r">In studio</th>
                  <th className="r">Make</th>
                  <th className="r">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.productId}>
                    <td>
                      <b>{r.name}</b>
                      <div className="muted tiny">
                        from {r.basedOn} event{r.basedOn === 1 ? '' : 's'}
                        {!recipes.has(r.productId) ? ' · no recipe' : ''}
                      </div>
                    </td>
                    <td className="r hide-phone">{r.perHour}</td>
                    <td className="r hide-phone">{r.expected}</td>
                    <td className="r strong">{r.target}</td>
                    <td className="r">{r.inStudio}</td>
                    <td className="r">
                      <div style={{ width: 96, marginLeft: 'auto' }}>
                        <NumberInput ariaLabel={`Make how many ${r.name}`} decimals={false} min={0} value={makeOf(r)} onChange={(n) => setOverrides({ ...overrides, [r.productId]: Math.max(0, Math.round(n ?? 0)) })} />
                      </div>
                    </td>
                    <td className="r">
                      <Button size="sm" disabled={!makeOf(r)} onClick={() => onMake(r.productId, makeOf(r))}>
                        <Factory size={15} /> Make it
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="actions">
            <Button onClick={useAsStock} disabled={!target}>
              <PackagePlus size={16} /> Use as stock to bring
            </Button>
            <Button onClick={printPlan}>
              <FileDown size={16} /> Print the plan
            </Button>
          </div>

          <div className="card">
            <div className="row between wrap">
              <h3>Materials to buy</h3>
              {toBuy.length ? <b>{peso(buyCost)}{toBuy.some((n) => n.cost === null) ? ' + some without a cost' : ''}</b> : null}
            </div>
            {toBuy.length ? (
              <div className="table-wrap" style={{ border: 0 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Material</th>
                      <th className="r">Needed</th>
                      <th className="r">On hand</th>
                      <th className="r">Buy</th>
                      <th className="r">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {toBuy.map((n) => (
                      <tr key={n.materialId}>
                        <td>{n.name}</td>
                        <td className="r">
                          {n.need} {n.unit}
                        </td>
                        <td className="r">{n.onHand}</td>
                        <td className="r strong">
                          {n.packs} pack{n.packs === 1 ? '' : 's'} of {n.packQty}
                        </td>
                        <td className="r">{n.cost === null ? <span className="warn small">No cost</span> : peso(n.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted small">
                {needs.length
                  ? 'You have enough materials on hand for this plan.'
                  : rows.some((r) => makeOf(r) > 0)
                    ? 'Products with a recipe show their materials here.'
                    : 'Everything is already in the studio, so there’s nothing to buy.'}
              </p>
            )}
            {noRecipe ? <Callout tone="info">{noRecipe} product{noRecipe === 1 ? ' has' : 's have'} no recipe, so their materials aren’t counted. Add recipes in Product costs.</Callout> : null}
          </div>
        </>
      ) : past.length ? (
        <EmptyState icon={<Factory size={44} />} title="Nothing to make">
          Nothing sold at the events it’s based on, or the hours are set to zero.
        </EmptyState>
      ) : null}
    </div>
  );
}
