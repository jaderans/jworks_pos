import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Layers, Minus, Pencil, Plus, Trash2 } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { useBatches, useCostPoints, useMaterials, useProductCosts, useProducts, useSettingRows } from '../../hooks/data';
import { settingValue } from '../../db/settings';
import { Dialog } from '../../components/Dialog';
import { Badge, Button, Callout, EmptyState, IconButton, Loading, PageHeader, Segmented, Toggle } from '../../components/ui';
import { Field, MoneyInput, NumberInput, SearchInput, Select, TextArea, TextInput } from '../../components/form';
import { formatPct, peso, type Cents } from '../../lib/money';
import { fmtDate, fmtDateTime } from '../../lib/time';
import { batchCost, materialUnitCost, recipeCost } from '../../domain/cost';
import { SHEETS, fitsPerSheet } from '../../domain/sticker';
import { materialCounted, needsReorder } from '../../domain/stock';
import { adjustMaterial, deleteMaterial, recordBatch, saveMaterial, setCostMode, setManualCost, setRecipe } from '../../services/production';
import type { CalcSettings, Material, Product, ProductCost, Recipe, RecipeItem } from '../../db/types';

type Tab = 'costs' | 'batches' | 'materials';

export default function ProductionPage() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => {
    const t = params.get('tab');
    return t === 'batches' || t === 'materials' ? t : 'costs';
  });
  return (
    <div className="page">
      <PageHeader
        title="Production"
        subtitle="What each sticker, pin and piece of merch costs to make. Every sale saves the cost in force at that moment, so event profit stays exact."
      />
      <Segmented<Tab>
        label="Section"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'costs', label: 'Product costs' },
          { value: 'batches', label: 'Batches' },
          { value: 'materials', label: 'Materials' },
        ]}
      />
      {tab === 'costs' ? <Costs /> : tab === 'batches' ? <Batches /> : <Materials />}
    </div>
  );
}

const MODE_LABEL: Record<ProductCost['mode'], string> = { manual: 'By hand', recipe: 'Recipe', batches: 'Batches' };

function Costs() {
  const products = useProducts();
  const costs = useProductCosts();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Product | null>(null);
  const settingRows = useSettingRows();
  const calc = settingValue<CalcSettings>(settingRows, 'calc');
  const shown = useMemo(() => (products ?? []).filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase())), [products, q]);
  if (!products || !costs) return <Loading />;
  const missing = products.filter((p) => p.active === 1 && (costs.get(p.id)?.current ?? null) === null).length;
  return (
    <div className="stack">
      {missing ? <Callout tone="warn">{missing} active product{missing === 1 ? ' has' : 's have'} no production cost yet. Sales of them count as pure profit until you add one.</Callout> : null}
      <SearchInput value={q} onChange={setQ} placeholder="Search products" />
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Product</th>
              <th>How it&rsquo;s costed</th>
              <th className="r">Cost each</th>
              <th className="r hide-phone">Base price</th>
              <th className="r hide-phone">Margin</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => {
              const c = costs.get(p.id);
              const cur = c?.current ?? null;
              const m = cur !== null && p.price ? ((p.price - cur) / p.price) * 100 : null;
              return (
                <tr key={p.id} className={`click ${p.active ? '' : 'muted'}`} onClick={() => setOpen(p)}>
                  <td>
                    <b>{p.name}</b>
                  </td>
                  <td>{c ? <Badge tone="teal">{MODE_LABEL[c.mode]}</Badge> : <Badge tone="warn">Not set</Badge>}</td>
                  <td className="r strong">{cur === null ? '—' : peso(cur)}</td>
                  <td className="r hide-phone">{p.price === null ? '—' : peso(p.price)}</td>
                  <td className="r hide-phone">{m === null ? '—' : <span className={m < calc.minMarginPct ? 'bad strong' : ''}>{formatPct(m)}</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <CostDialog product={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function CostDialog({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const app = useApp();
  const costs = useProductCosts();
  const materials = useMaterials();
  const points = useCostPoints();
  const batches = useBatches();
  const settingRows = useSettingRows();
  const calc = settingValue<CalcSettings>(settingRows, 'calc');
  const matMap = useMemo(() => new Map((materials ?? []).map((m) => [m.id, m])), [materials]);
  const existing = product ? costs?.get(product.id) : undefined;
  const [mode, setMode] = useState<ProductCost['mode']>('manual');
  const [manual, setManual] = useState<Cents | null>(null);
  const [recipe, setRecipeState] = useState<Recipe>({ items: [], laborMinutes: 0, laborRate: 0, packaging: 0, spoilagePct: 10, overheadPct: 25 });
  const [stickerW, setStickerW] = useState<number | null>(2);
  const [stickerH, setStickerH] = useState<number | null>(2);
  const production = calc.roles.find((r) => /production/i.test(r.name));

  useEffect(() => {
    if (!product) return;
    setMode(existing?.mode ?? 'manual');
    setManual(existing?.manual ?? existing?.current ?? null);
    setRecipeState(existing?.recipe ?? { items: [], laborMinutes: 0, laborRate: production?.rate ?? 0, packaging: 0, spoilagePct: 10, overheadPct: calc.overheadPct });
  }, [product?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!product) return null;
  const breakdown = recipeCost(recipe, matMap);
  const history = (points ?? []).filter((p) => p.productId === product.id).sort((a, b) => b.effectiveFrom - a.effectiveFrom).slice(0, 8);
  const myBatches = (batches ?? []).filter((b) => b.productId === product.id).slice(0, 6);
  const perSheet = stickerW && stickerH ? fitsPerSheet(SHEETS[0].spec, stickerW, stickerH) : 0;
  const setItem = (i: number, changes: Partial<RecipeItem>) => setRecipeState({ ...recipe, items: recipe.items.map((it, k) => (k === i ? { ...it, ...changes } : it)) });

  const save = async () => {
    if (mode === 'manual') await setManualCost(product.id, manual);
    else if (mode === 'recipe') {
      const r = await setRecipe(product.id, recipe, matMap);
      if (r.missing.length) app.toast(`Saved. Add pack costs for ${r.missing.join(', ')} to get a cost.`, { tone: 'bad' });
    } else await setCostMode(product.id, 'batches');
    app.toast('Cost saved', { tone: 'good' });
    onClose();
  };

  return (
    <Dialog
      open={!!product}
      onClose={onClose}
      title={`Cost of ${product.name}`}
      size="wide"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>
            Save cost
          </Button>
        </>
      }
    >
      <Segmented<ProductCost['mode']>
        label="Costing method"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'manual', label: 'Enter by hand' },
          { value: 'recipe', label: 'From a recipe' },
          { value: 'batches', label: 'From batches' },
        ]}
      />
      {mode === 'manual' ? (
        <Field label="Cost to make one" htmlFor="c-manual" hint="Use this for items you buy ready-made, or when you already know the number.">
          <MoneyInput id="c-manual" large value={manual} onChange={setManual} autoFocus />
        </Field>
      ) : null}

      {mode === 'recipe' ? (
        <div className="stack">
          <p className="muted small">What goes into one piece. The cost updates by itself when a material&rsquo;s price changes.</p>
          <div className="card" style={{ gap: 8 }}>
            <h3>Sticker size helper</h3>
            <div className="row wrap">
              <div style={{ width: 90 }}>
                <NumberInput ariaLabel="Width in inches" value={stickerW} onChange={setStickerW} suffix="in" />
              </div>
              <span>×</span>
              <div style={{ width: 90 }}>
                <NumberInput ariaLabel="Height in inches" value={stickerH} onChange={setStickerH} suffix="in" />
              </div>
              <span className="small">
                = <b>{perSheet}</b> per A4 sheet (5 mm margin, 3 mm gutter)
              </span>
              <Button
                size="sm"
                disabled={!perSheet}
                onClick={() => setRecipeState({ ...recipe, items: recipe.items.map((it) => (matMap.get(it.materialId)?.unit === 'sheet' || matMap.get(it.materialId)?.unit === 'print' ? { ...it, qty: Math.round((1 / perSheet) * 10000) / 10000 } : it)) })}
              >
                Set sheet materials to 1/{perSheet || '?'}
              </Button>
            </div>
          </div>
          {recipe.items.map((it, i) => {
            const m = matMap.get(it.materialId);
            const unit = materialUnitCost(m);
            return (
              <div key={i} className="row wrap">
                <Select aria-label="Material" value={it.materialId} onChange={(e) => setItem(i, { materialId: e.target.value })} style={{ flex: 2, minWidth: 180 }}>
                  {(materials ?? []).map((mm) => (
                    <option key={mm.id} value={mm.id}>
                      {mm.name}
                    </option>
                  ))}
                </Select>
                <div style={{ width: 150 }}>
                  <NumberInput ariaLabel="Quantity per piece" value={it.qty} onChange={(n) => setItem(i, { qty: n ?? 0 })} suffix={m?.unit ?? ''} />
                </div>
                <span className="small nowrap" style={{ width: 110 }}>
                  {unit === null ? <span className="warn">No pack cost</span> : peso(Math.round(unit * it.qty), { decimals: 2 })}
                </span>
                <IconButton label="Remove material" size="sm" onClick={() => setRecipeState({ ...recipe, items: recipe.items.filter((_, k) => k !== i) })}>
                  <Trash2 size={16} />
                </IconButton>
              </div>
            );
          })}
          <div>
            <Button size="sm" disabled={!materials?.length} onClick={() => setRecipeState({ ...recipe, items: [...recipe.items, { materialId: materials![0].id, qty: 1 }] })}>
              <Plus size={16} /> Add a material
            </Button>
          </div>
          <div className="form-grid">
            <Field label="Labor per piece" htmlFor="r-min" hint="Printing, cutting, weeding, pressing, sleeving.">
              <NumberInput id="r-min" value={recipe.laborMinutes} onChange={(n) => setRecipeState({ ...recipe, laborMinutes: n ?? 0 })} suffix="min" />
            </Field>
            <Field label="Labor rate" htmlFor="r-rate">
              <Select id="r-rate" value={String(recipe.laborRate)} onChange={(e) => setRecipeState({ ...recipe, laborRate: Number(e.target.value) })}>
                {calc.roles.map((r) => (
                  <option key={r.name} value={r.rate}>
                    {r.name} · {peso(r.rate)}/hr
                  </option>
                ))}
                {!calc.roles.some((r) => r.rate === recipe.laborRate) ? <option value={recipe.laborRate}>{peso(recipe.laborRate)}/hr</option> : null}
              </Select>
            </Field>
            <Field label="Packaging per piece" htmlFor="r-pack" hint="Sleeve, backing card, bag.">
              <MoneyInput id="r-pack" value={recipe.packaging} onChange={(c) => setRecipeState({ ...recipe, packaging: c ?? 0 })} />
            </Field>
            <Field label="Spoilage" htmlFor="r-spoil" hint="Misprints and bad cuts.">
              <NumberInput id="r-spoil" value={recipe.spoilagePct} onChange={(n) => setRecipeState({ ...recipe, spoilagePct: n ?? 0 })} suffix="%" />
            </Field>
            <Field label="Overhead" htmlFor="r-over" hint="Rent, internet, software, printer wear.">
              <NumberInput id="r-over" value={recipe.overheadPct} onChange={(n) => setRecipeState({ ...recipe, overheadPct: n ?? 0 })} suffix="%" />
            </Field>
          </div>
          <div className="waterfall card">
            <div className="wf-row"><span>Materials</span><span className="v">{peso(Math.round(breakdown.materials), { decimals: 2 })}</span></div>
            <div className="wf-row"><span>Labor</span><span className="v">{peso(Math.round(breakdown.labor), { decimals: 2 })}</span></div>
            <div className="wf-row"><span>Spoilage</span><span className="v">{peso(Math.round(breakdown.spoilage), { decimals: 2 })}</span></div>
            <div className="wf-row"><span>Packaging</span><span className="v">{peso(Math.round(breakdown.packaging), { decimals: 2 })}</span></div>
            <div className="wf-row"><span>Overhead</span><span className="v">{peso(Math.round(breakdown.overhead), { decimals: 2 })}</span></div>
            <div className="wf-row final"><span>Cost per piece</span><span className="v">{breakdown.missing.length ? '—' : peso(Math.round(breakdown.total), { decimals: 2 })}</span></div>
          </div>
          {breakdown.missing.length ? <Callout tone="warn">Add pack costs in Materials for: {breakdown.missing.join(', ')}.</Callout> : null}
        </div>
      ) : null}

      {mode === 'batches' ? (
        <div className="stack">
          <p className="muted small">The cost is the weighted average of your logged batches: each new run is blended with the stock you still have. Log runs in the Batches section.</p>
          {myBatches.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th className="r">Good pieces</th>
                    <th className="r">Batch cost</th>
                    <th className="r">Each</th>
                  </tr>
                </thead>
                <tbody>
                  {myBatches.map((b) => (
                    <tr key={b.id}>
                      <td>{fmtDate(b.at)}</td>
                      <td className="r">{b.qtyMade - b.qtySpoiled}</td>
                      <td className="r">{peso(b.totalCost)}</td>
                      <td className="r">{peso(b.unitCost, { decimals: 2 })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Callout tone="info">No batches logged for this product yet.</Callout>
          )}
        </div>
      ) : null}

      {history.length ? (
        <div className="stack tight">
          <h3>Cost history</h3>
          {history.map((h) => (
            <div key={h.id} className="row between small">
              <span>
                {peso(h.unitCost, { decimals: 2 })} <span className="muted">· {h.note || h.source}</span>
              </span>
              <span className="muted">from {fmtDateTime(h.effectiveFrom)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </Dialog>
  );
}

function Batches() {
  const batches = useBatches();
  const products = useProducts();
  const [open, setOpen] = useState(false);
  if (!batches || !products) return <Loading />;
  const pname = new Map(products.map((p) => [p.id, p.name]));
  return (
    <div className="stack">
      <div className="row between wrap">
        <p className="muted" style={{ maxWidth: '65ch' }}>
          Log each production run: how many you made, how many were spoiled, what went into it. Stock goes up, materials go down, and the cost per piece is averaged in.
        </p>
        <Button variant="primary" onClick={() => setOpen(true)}>
          <Plus size={18} /> Log a batch
        </Button>
      </div>
      {batches.length === 0 ? (
        <EmptyState icon={<Layers size={44} />} title="No batches yet">
          Example: printed 4 A4 sheets of a 2 × 2 design, 60 stickers, 5 spoiled, 55 good.
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Product</th>
                <th className="r">Made</th>
                <th className="r">Spoiled</th>
                <th className="r">Batch cost</th>
                <th className="r">Each</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id}>
                  <td className="nowrap">{fmtDate(b.at)}</td>
                  <td>
                    <b>{pname.get(b.productId) ?? 'Deleted product'}</b>
                    {b.note ? <div className="muted tiny">{b.note}</div> : null}
                  </td>
                  <td className="r">{b.qtyMade}</td>
                  <td className="r">{b.qtySpoiled}</td>
                  <td className="r">{peso(b.totalCost)}</td>
                  <td className="r strong">{peso(b.unitCost, { decimals: 2 })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <BatchDialog open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

function BatchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const app = useApp();
  const products = useProducts();
  const materials = useMaterials();
  const costs = useProductCosts();
  const settingRows = useSettingRows();
  const calc = settingValue<CalcSettings>(settingRows, 'calc');
  const matMap = useMemo(() => new Map((materials ?? []).map((m) => [m.id, m])), [materials]);
  const production = calc.roles.find((r) => /production/i.test(r.name));
  const design = calc.roles.find((r) => /illustrator|designer/i.test(r.name));
  const [productId, setProductId] = useState('');
  const [made, setMade] = useState<number | null>(null);
  const [spoiled, setSpoiled] = useState<number | null>(0);
  const [items, setItems] = useState<RecipeItem[]>([]);
  const [minutes, setMinutes] = useState<number | null>(0);
  const [rate, setRate] = useState<Cents>(production?.rate ?? 0);
  const [oneTime, setOneTime] = useState<Cents | null>(null);
  const [other, setOther] = useState<Cents | null>(null);
  const [overhead, setOverhead] = useState<number | null>(calc.overheadPct);
  const [deduct, setDeduct] = useState(true);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setProductId('');
    setMade(null);
    setSpoiled(0);
    setItems([]);
    setMinutes(0);
    setRate(production?.rate ?? 0);
    setOneTime(null);
    setOther(null);
    setOverhead(calc.overheadPct);
    setDeduct(true);
    setNote('');
    setError('');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const fillFromRecipe = (pid: string, qty: number | null) => {
    const r = costs?.get(pid)?.recipe;
    if (!r || !qty) return;
    setItems(r.items.map((it) => ({ materialId: it.materialId, qty: Math.round(it.qty * qty * 100) / 100 })));
    setMinutes(Math.round(r.laborMinutes * qty));
    setRate(r.laborRate);
  };

  const input = { qtyMade: made ?? 0, qtySpoiled: spoiled ?? 0, materials: items, laborMinutes: minutes ?? 0, laborRate: rate, oneTime: oneTime ?? 0, other: other ?? 0, overheadPct: overhead ?? 0 };
  const preview = batchCost(input, matMap);

  const save = async () => {
    if (!productId || !made) {
      setError('Pick a product and how many you made.');
      return;
    }
    setBusy(true);
    try {
      await recordBatch({ ...input, productId, deductMaterials: deduct, note });
      app.toast(`Batch saved: ${preview.good} good pieces at ${peso(preview.unit ?? 0, { decimals: 2 })} each`, { tone: 'good' });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the batch.');
    } finally {
      setBusy(false);
    }
  };

  const tracked = (products ?? []).filter((p) => p.active === 1);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Log a production batch"
      size="wide"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={busy}>
            Save batch
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Product" htmlFor="b-prod" className="span-2">
          <Select
            id="b-prod"
            value={productId}
            onChange={(e) => {
              setProductId(e.target.value);
              fillFromRecipe(e.target.value, made);
            }}
          >
            <option value="">Choose…</option>
            {tracked.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Pieces made" htmlFor="b-made" hint="Everything that came off the printer or press.">
          <NumberInput id="b-made" decimals={false} value={made} onChange={(n) => {
            setMade(n);
            if (productId && items.length === 0) fillFromRecipe(productId, n);
          }} />
        </Field>
        <Field label="Spoiled" htmlFor="b-spoil" hint="Misprints and bad cuts; not added to stock.">
          <NumberInput id="b-spoil" decimals={false} value={spoiled} onChange={setSpoiled} />
        </Field>
      </div>
      <div className="stack tight">
        <span className="label strong small">Materials used</span>
        {items.map((it, i) => {
          const m = matMap.get(it.materialId);
          return (
            <div key={i} className="row wrap">
              <Select aria-label="Material" value={it.materialId} onChange={(e) => setItems(items.map((x, k) => (k === i ? { ...x, materialId: e.target.value } : x)))} style={{ flex: 2, minWidth: 180 }}>
                {(materials ?? []).map((mm) => (
                  <option key={mm.id} value={mm.id}>
                    {mm.name}
                  </option>
                ))}
              </Select>
              <div style={{ width: 150 }}>
                <NumberInput ariaLabel="Quantity used" value={it.qty} onChange={(n) => setItems(items.map((x, k) => (k === i ? { ...x, qty: n ?? 0 } : x)))} suffix={m?.unit ?? ''} />
              </div>
              <IconButton label="Remove" size="sm" onClick={() => setItems(items.filter((_, k) => k !== i))}>
                <Trash2 size={16} />
              </IconButton>
            </div>
          );
        })}
        <div>
          <Button size="sm" disabled={!materials?.length} onClick={() => setItems([...items, { materialId: materials![0].id, qty: 1 }])}>
            <Plus size={16} /> Add a material
          </Button>
        </div>
      </div>
      <div className="form-grid">
        <Field label="Labor time" htmlFor="b-min">
          <NumberInput id="b-min" value={minutes} onChange={setMinutes} suffix="min" />
        </Field>
        <Field label="Labor rate" htmlFor="b-rate">
          <Select id="b-rate" value={String(rate)} onChange={(e) => setRate(Number(e.target.value))}>
            {calc.roles.map((r) => (
              <option key={r.name} value={r.rate}>
                {r.name} · {peso(r.rate)}/hr
              </option>
            ))}
          </Select>
        </Field>
        <Field label="One-time costs" htmlFor="b-once" hint={`Design time for a new design, e.g. 1 hr × ${peso(design?.rate ?? 0)}.`}>
          <MoneyInput id="b-once" value={oneTime} onChange={setOneTime} />
        </Field>
        <Field label="Other costs" htmlFor="b-other" hint="Supplier price, shipping, outsourcing.">
          <MoneyInput id="b-other" value={other} onChange={setOther} />
        </Field>
        <Field label="Overhead" htmlFor="b-over">
          <NumberInput id="b-over" value={overhead} onChange={setOverhead} suffix="%" />
        </Field>
        <div className="field" style={{ alignContent: 'end' }}>
          <Toggle id="b-deduct" checked={deduct} onChange={setDeduct} label="Take the materials out of stock" />
        </div>
      </div>
      <Field label="Note" htmlFor="b-note">
        <TextInput id="b-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Reprint for the Komiket booth" />
      </Field>
      <div className="waterfall card">
        <div className="wf-row"><span>Materials</span><span className="v">{peso(Math.round(preview.materials))}</span></div>
        <div className="wf-row"><span>Labor</span><span className="v">{peso(Math.round(preview.labor))}</span></div>
        <div className="wf-row"><span>One-time and other</span><span className="v">{peso((oneTime ?? 0) + (other ?? 0))}</span></div>
        <div className="wf-row"><span>Overhead</span><span className="v">{peso(Math.round(preview.overhead))}</span></div>
        <div className="wf-row total"><span>Batch cost</span><span className="v">{peso(preview.total)}</span></div>
        <div className="wf-row final"><span>Each of {preview.good} good pieces</span><span className="v">{preview.unit === null ? '—' : peso(preview.unit, { decimals: 2 })}</span></div>
      </div>
      {preview.missing.length ? <Callout tone="warn">No pack cost yet for {preview.missing.join(', ')}; they count as ₱0 in this batch.</Callout> : null}
      {error ? <Callout tone="bad">{error}</Callout> : null}
    </Dialog>
  );
}

function Materials() {
  const app = useApp();
  const materials = useMaterials();
  const [q, setQ] = useState('');
  const [onlyLow, setOnlyLow] = useState(false);
  const [editing, setEditing] = useState<Partial<Material> | null>(null);
  const low = useMemo(() => (materials ?? []).filter(needsReorder), [materials]);
  const shown = useMemo(
    () => (materials ?? []).filter((m) => (!q || m.name.toLowerCase().includes(q.toLowerCase())) && (!onlyLow || needsReorder(m))),
    [materials, q, onlyLow],
  );
  if (!materials) return <Loading />;
  const noCost = materials.filter((m) => m.packCost === null).length;
  const uncounted = materials.filter((m) => !materialCounted(m)).length;
  return (
    <div className="stack">
      {low.length ? (
        <Callout tone="warn" title={`${low.length} material${low.length === 1 ? ' is' : 's are'} running low`}>
          {low
            .slice(0, 3)
            .map((m) => `${m.name} (${m.onHand} ${m.unit} left)`)
            .join(' · ')}
          {low.length > 3 ? ` and ${low.length - 3} more` : ''}.{' '}
          <button type="button" className="btn link" onClick={() => setOnlyLow(!onlyLow)}>
            {onlyLow ? 'Show all materials' : 'Show only these'}
          </button>
        </Callout>
      ) : null}
      {noCost || uncounted ? (
        <Callout tone="info">
          {noCost ? `${noCost} material${noCost === 1 ? ' has' : 's have'} no pack cost yet; recipes and batches need it to work out a cost. ` : ''}
          {uncounted ? `${uncounted} ${uncounted === 1 ? 'hasn’t' : 'haven’t'} been counted; reorder reminders start once you enter what’s on hand.` : ''}
        </Callout>
      ) : null}
      <div className="row wrap">
        <div className="grow" style={{ minWidth: 200 }}>
          <SearchInput value={q} onChange={setQ} placeholder="Search materials" />
        </div>
        <Button variant="primary" onClick={() => setEditing({ unit: 'sheet', packQty: 1 })}>
          <Plus size={18} /> Add material
        </Button>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Material</th>
              <th className="r">Pack</th>
              <th className="r">Per unit</th>
              <th className="r">On hand</th>
              <th className="r"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((m) => {
              const unit = materialUnitCost(m);
              const isLow = needsReorder(m);
              const counted = materialCounted(m);
              return (
                <tr key={m.id}>
                  <td>
                    <b>{m.name}</b>
                    <div className="muted tiny">
                      {m.code ? `${m.code} · ` : ''}
                      {m.category}
                      {m.supplier ? ` · ${m.supplier}` : ''}
                    </div>
                  </td>
                  <td className="r">{m.packCost === null ? <span className="warn small">No cost</span> : `${peso(m.packCost)} / ${m.packQty} ${m.unit}`}</td>
                  <td className="r">{unit === null ? '—' : peso(Math.round(unit), { decimals: 2 })}</td>
                  <td className="r">
                    <div className="row" style={{ justifyContent: 'flex-end', gap: 4 }}>
                      <IconButton label={`One less ${m.unit} of ${m.name}`} size="sm" disabled={m.onHand <= 0} onClick={() => adjustMaterial(m.id, -1, 'Used')}>
                        <Minus size={14} />
                      </IconButton>
                      <span className={`num ${counted ? 'strong' : 'muted'}`} style={{ minWidth: 48, textAlign: 'center' }} title={counted ? undefined : 'Not counted yet'}>
                        {counted ? m.onHand : '—'}
                      </span>
                      <IconButton label={`One more ${m.unit} of ${m.name}`} size="sm" onClick={() => adjustMaterial(m.id, 1, 'Added')}>
                        <Plus size={14} />
                      </IconButton>
                    </div>
                    {isLow ? <Badge tone="warn">Reorder</Badge> : null}
                  </td>
                  <td className="r">
                    <div className="actions" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                      <IconButton label={`Edit ${m.name}`} size="sm" onClick={() => setEditing(m)}>
                        <Pencil size={16} />
                      </IconButton>
                      <IconButton
                        label={`Delete ${m.name}`}
                        size="sm"
                        onClick={async () => {
                          if (await app.confirm({ title: `Delete ${m.name}?`, message: 'Recipes that use it will show it as missing.', confirmLabel: 'Delete', tone: 'danger' })) await deleteMaterial(m.id);
                        }}
                      >
                        <Trash2 size={16} />
                      </IconButton>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <MaterialDialog material={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function MaterialDialog({ material, onClose }: { material: Partial<Material> | null; onClose: () => void }) {
  const [f, setF] = useState<Partial<Material>>({});
  useEffect(() => {
    if (material) setF({ name: '', code: '', category: '', unit: 'sheet', packQty: 1, packCost: null, onHand: 0, reorderAt: 0, supplier: '', notes: '', ...material });
  }, [material]);
  if (!material) return null;
  const unit = f.packCost !== null && f.packCost !== undefined && f.packQty ? f.packCost / f.packQty : null;
  const save = async () => {
    if (!f.name?.trim()) return;
    await saveMaterial({ ...f, name: f.name.trim() });
    onClose();
  };
  return (
    <Dialog
      open={!!material}
      onClose={onClose}
      title={material.id ? 'Edit material' : 'New material'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={!f.name?.trim()}>
            Save
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Name" htmlFor="m-name" className="span-2">
          <TextInput id="m-name" value={f.name ?? ''} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus placeholder="e.g. Button pin set 58 mm" />
        </Field>
        <Field label="Code" htmlFor="m-code">
          <TextInput id="m-code" value={f.code ?? ''} onChange={(e) => setF({ ...f, code: e.target.value })} />
        </Field>
        <Field label="Category" htmlFor="m-cat">
          <TextInput id="m-cat" value={f.category ?? ''} onChange={(e) => setF({ ...f, category: e.target.value })} placeholder="Sticker, Pins, Packaging…" />
        </Field>
        <Field label="Unit" htmlFor="m-unit" hint="How you use it: sheet, pc, set, m, print.">
          <TextInput id="m-unit" value={f.unit ?? ''} onChange={(e) => setF({ ...f, unit: e.target.value })} />
        </Field>
        <Field label="Units per pack" htmlFor="m-packqty">
          <NumberInput id="m-packqty" value={f.packQty ?? 1} onChange={(n) => setF({ ...f, packQty: n ?? 1 })} suffix={f.unit ?? ''} />
        </Field>
        <Field label="Pack cost" htmlFor="m-packcost" hint={unit !== null ? `${peso(Math.round(unit), { decimals: 2 })} per ${f.unit}` : 'What a whole pack costs you.'}>
          <MoneyInput id="m-packcost" value={f.packCost ?? null} onChange={(c) => setF({ ...f, packCost: c })} placeholder="Not set" />
        </Field>
        <Field label="On hand" htmlFor="m-onhand">
          <NumberInput id="m-onhand" value={f.onHand ?? 0} onChange={(n) => setF({ ...f, onHand: Math.max(0, n ?? 0), counted: 1 })} suffix={f.unit ?? ''} />
        </Field>
        <Field label="Reorder when down to" htmlFor="m-reorder">
          <NumberInput id="m-reorder" value={f.reorderAt ?? 0} onChange={(n) => setF({ ...f, reorderAt: n ?? 0 })} suffix={f.unit ?? ''} />
        </Field>
        <Field label="Supplier" htmlFor="m-supplier">
          <TextInput id="m-supplier" value={f.supplier ?? ''} onChange={(e) => setF({ ...f, supplier: e.target.value })} />
        </Field>
      </div>
      <Field label="Notes" htmlFor="m-notes">
        <TextArea id="m-notes" rows={2} value={f.notes ?? ''} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </Field>
    </Dialog>
  );
}

export type { Cents };
