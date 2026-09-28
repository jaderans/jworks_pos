import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Barcode, Minus, Package, Pencil, Plus, Printer, Tag, Trash2 } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { useBundleRules, useCategories, useEvents, useMembers, useProductCosts, useProducts, useSettingRows, useStockMoves } from '../../hooks/data';
import { settingValue } from '../../db/settings';
import { Dialog } from '../../components/Dialog';
import { Badge, Button, Callout, EmptyState, IconButton, Loading, PageHeader, Segmented, Toggle } from '../../components/ui';
import { Field, MoneyInput, NumberInput, SearchInput, Select, TextArea, TextInput } from '../../components/form';
import { formatPct, peso, type Cents } from '../../lib/money';
import { onHandByProduct } from '../../domain/stock';
import {
  createCategory, createProduct, deleteBundleRule, deleteCategory, deleteProduct, nextBarcode, renameCategory, saveBundleRule, updateProduct,
} from '../../services/catalog';
import { adjustStock } from '../../services/production';
import { safeFileName } from '../../lib/files';
import type { BundleRule, BusinessSettings, Product } from '../../db/types';

type Tab = 'products' | 'categories' | 'bundles';

export default function ProductsPage() {
  const [tab, setTab] = useState<Tab>('products');
  return (
    <div className="page">
      <PageHeader title="Products" subtitle="Your catalog: names, codes, base prices, who designed what, and bundle deals. Event prices are set per event." />
      <Segmented<Tab>
        label="Section"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'products', label: 'Products' },
          { value: 'categories', label: 'Categories' },
          { value: 'bundles', label: 'Bundle deals' },
        ]}
      />
      {tab === 'products' ? <ProductList /> : tab === 'categories' ? <Categories /> : <Bundles />}
    </div>
  );
}

function ProductList() {
  const app = useApp();
  const products = useProducts();
  const categories = useCategories();
  const costs = useProductCosts();
  const moves = useStockMoves();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const [editing, setEditing] = useState<Partial<Product> | null>(null);
  const [labels, setLabels] = useState(false);
  const onHand = useMemo(() => onHandByProduct(moves ?? []), [moves]);
  const catName = useMemo(() => new Map((categories ?? []).map((c) => [c.id, c.name])), [categories]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (products ?? []).filter(
      (p) => (cat === 'all' || (cat === 'none' ? !p.categoryId : p.categoryId === cat)) && (!needle || p.name.toLowerCase().includes(needle) || p.sku.toLowerCase().includes(needle) || p.barcode.toLowerCase().includes(needle)),
    );
  }, [products, q, cat]);
  if (!products || !categories || !costs || !moves) return <Loading />;
  return (
    <div className="stack">
      <div className="row wrap">
        <div className="grow" style={{ minWidth: 200 }}>
          <SearchInput value={q} onChange={setQ} placeholder="Search name, code or barcode" />
        </div>
        <Select aria-label="Category" value={cat} onChange={(e) => setCat(e.target.value)} style={{ width: 'auto' }}>
          <option value="all">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          <option value="none">No category</option>
        </Select>
        <Button onClick={() => setLabels(true)}>
          <Printer size={18} /> Barcode labels
        </Button>
        <Button variant="primary" onClick={() => setEditing({ active: 1, trackStock: 1 })}>
          <Plus size={18} /> Add product
        </Button>
      </div>
      {shown.length === 0 ? (
        <EmptyState icon={<Package size={44} />} title={products.length ? 'Nothing matches' : 'No products yet'}>
          {products.length ? 'Try another search.' : 'Add what you sell: sticker packs, singles, pins, merch, add-ons.'}
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Product</th>
                <th className="hide-phone">Code</th>
                <th className="r">Base price</th>
                {app.can('viewCosts') ? <th className="r hide-phone">Cost</th> : null}
                <th className="r hide-phone">Stock</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => {
                const cost = costs.get(p.id)?.current ?? null;
                return (
                  <tr key={p.id} className={`click ${p.active ? '' : 'muted'}`} onClick={() => setEditing(p)}>
                    <td>
                      <b>{p.name}</b>
                      <div className="muted tiny">
                        {catName.get(p.categoryId ?? '') ?? 'No category'}
                        {p.designerId ? ' · design credit' : ''}
                      </div>
                    </td>
                    <td className="hide-phone">
                      <span className="mono small">{p.sku || '—'}</span>
                      <div className="muted tiny mono">{p.barcode}</div>
                    </td>
                    <td className="r">{p.price === null ? <span className="muted">No price</span> : peso(p.price)}</td>
                    {app.can('viewCosts') ? (
                      <td className="r hide-phone">
                        {cost === null ? <span className="muted">—</span> : peso(cost)}
                        {cost !== null && p.price ? <div className="muted tiny">{formatPct(((p.price - cost) / p.price) * 100)} margin</div> : null}
                      </td>
                    ) : null}
                    <td className="r hide-phone">{p.trackStock ? onHand.get(p.id) ?? 0 : <span className="muted tiny">Made to order</span>}</td>
                    <td>{p.active ? <Badge tone="good">Active</Badge> : <Badge>Inactive</Badge>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <ProductDialog product={editing} onClose={() => setEditing(null)} onHand={editing?.id ? onHand.get(editing.id) ?? 0 : 0} />
      <LabelsDialog open={labels} onClose={() => setLabels(false)} products={products} />
    </div>
  );
}

function ProductDialog({ product, onClose, onHand }: { product: Partial<Product> | null; onClose: () => void; onHand: number }) {
  const app = useApp();
  const categories = useCategories();
  const members = useMembers();
  const [f, setF] = useState<Partial<Product>>({});
  const [adjust, setAdjust] = useState<number | null>(null);
  const [adjustNote, setAdjustNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (product) {
      setF({ name: '', sku: '', barcode: '', price: null, categoryId: null, designerId: null, royalty: null, notes: '', ...product });
      setAdjust(null);
      setAdjustNote('');
    }
  }, [product]);
  if (!product) return null;
  const isNew = !product.id;
  const designers = (members ?? []).filter((m) => m.active === 1);

  const save = async () => {
    if (!f.name?.trim()) return;
    setBusy(true);
    try {
      if (isNew) {
        await createProduct({ ...f, name: f.name.trim() } as Product);
        app.toast(`Added ${f.name.trim()}`, { tone: 'good' });
      } else {
        await updateProduct(product.id!, { ...f, name: f.name.trim(), sku: (f.sku ?? '').trim().toUpperCase() });
        if (adjust) await adjustStock(product.id!, adjust, adjustNote || 'Count correction');
        app.toast('Saved', { tone: 'good' });
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={!!product}
      onClose={onClose}
      title={isNew ? 'New product' : f.name || 'Product'}
      size="wide"
      footer={
        <>
          {!isNew ? (
            <Button
              variant="danger"
              onClick={async () => {
                if (!(await app.confirm({ title: `Delete ${product.name}?`, message: 'Past sales keep their record. Mark it inactive instead if you may sell it again.', confirmLabel: 'Delete', tone: 'danger' }))) return;
                await deleteProduct(product.id!);
                onClose();
              }}
            >
              <Trash2 size={16} /> Delete
            </Button>
          ) : null}
          <span className="grow" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={busy || !f.name?.trim()}>
            {isNew ? 'Add product' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Name" htmlFor="p-name" className="span-2">
          <TextInput id="p-name" value={f.name ?? ''} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus placeholder="e.g. Couple Pack (live)" />
        </Field>
        <Field label="Category" htmlFor="p-cat">
          <Select id="p-cat" value={f.categoryId ?? ''} onChange={(e) => setF({ ...f, categoryId: e.target.value || null })}>
            <option value="">No category</option>
            {(categories ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Base price" htmlFor="p-price" hint="Carries over to every event. Leave blank if not priced yet.">
          <MoneyInput id="p-price" value={f.price ?? null} onChange={(c) => setF({ ...f, price: c })} placeholder="No price" />
        </Field>
        <Field label="Short code" htmlFor="p-sku" hint="What the team calls it, e.g. SOLO. Also works as a scan code.">
          <TextInput id="p-sku" value={f.sku ?? ''} onChange={(e) => setF({ ...f, sku: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="Barcode" htmlFor="p-bar" hint="Printed on labels. Leave blank to get the next JW- number.">
          <div className="row">
            <TextInput id="p-bar" value={f.barcode ?? ''} onChange={(e) => setF({ ...f, barcode: e.target.value.trim() })} className="mono" />
            <IconButton label="Make a new JW barcode" onClick={async () => setF({ ...f, barcode: await nextBarcode() })}>
              <Barcode size={18} />
            </IconButton>
          </div>
        </Field>
      </div>
      <div className="row wrap" style={{ gap: 20 }}>
        <Toggle id="p-active" checked={(f.active ?? 1) === 1} onChange={(v) => setF({ ...f, active: v ? 1 : 0 })} label="Active (can be sold)" />
        <Toggle id="p-stock" checked={(f.trackStock ?? 1) === 1} onChange={(v) => setF({ ...f, trackStock: v ? 1 : 0 })} label="Count stock (off for made-to-order)" />
      </div>
      <div className="card">
        <h3>Design credit and royalty</h3>
        <div className="form-grid">
          <Field label="Designed by" htmlFor="p-designer">
            <Select id="p-designer" value={f.designerId ?? ''} onChange={(e) => setF({ ...f, designerId: e.target.value || null, royalty: e.target.value ? f.royalty : null })}>
              <option value="">No one in particular</option>
              {designers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
          {f.designerId ? (
            <Field label="Royalty per sale" htmlFor="p-roy" hint="Paid to the designer from each sale of this design.">
              <div className="row">
                <Segmented
                  label="Royalty type"
                  value={f.royalty?.mode ?? 'percent'}
                  onChange={(v) => setF({ ...f, royalty: { mode: v, value: 0 } })}
                  options={[
                    { value: 'percent', label: '%' },
                    { value: 'perPiece', label: '₱ each' },
                  ]}
                />
                <div className="grow">
                  {(f.royalty?.mode ?? 'percent') === 'percent' ? (
                    <NumberInput id="p-roy" value={f.royalty?.value ?? null} onChange={(n) => setF({ ...f, royalty: n ? { mode: 'percent', value: n } : null })} suffix="%" placeholder="None" />
                  ) : (
                    <MoneyInput id="p-roy" value={f.royalty?.value ?? null} onChange={(c) => setF({ ...f, royalty: c ? { mode: 'perPiece', value: c } : null })} placeholder="None" />
                  )}
                </div>
              </div>
            </Field>
          ) : null}
        </div>
      </div>
      {!isNew && (f.trackStock ?? 1) === 1 ? (
        <div className="card">
          <div className="card-head">
            <h3>Studio stock: {onHand}</h3>
            <Link to="/production" className="small" onClick={onClose}>
              Log a production batch
            </Link>
          </div>
          <div className="row wrap">
            <IconButton label="One less" onClick={() => setAdjust((adjust ?? 0) - 1)}>
              <Minus size={18} />
            </IconButton>
            <div style={{ width: 110 }}>
              <NumberInput ariaLabel="Adjust stock by" decimals={false} value={adjust} onChange={setAdjust} placeholder="±0" />
            </div>
            <IconButton label="One more" onClick={() => setAdjust((adjust ?? 0) + 1)}>
              <Plus size={18} />
            </IconButton>
            <TextInput aria-label="Reason" placeholder="Reason, e.g. recount, damaged" value={adjustNote} onChange={(e) => setAdjustNote(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
          </div>
          {adjust ? <p className="small">After saving: {onHand + adjust}</p> : null}
        </div>
      ) : null}
      {app.can('viewCosts') && !isNew ? (
        <Callout tone="info">
          Production cost is set in <Link to="/production" onClick={onClose}>Production</Link>: by hand, from a recipe, or from batches.
        </Callout>
      ) : null}
      <Field label="Notes" htmlFor="p-notes">
        <TextArea id="p-notes" rows={2} value={f.notes ?? ''} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </Field>
    </Dialog>
  );
}

function Categories() {
  const app = useApp();
  const categories = useCategories();
  const products = useProducts();
  const [name, setName] = useState('');
  if (!categories || !products) return <Loading />;
  const count = (id: string) => products.filter((p) => p.categoryId === id).length;
  return (
    <div className="stack">
      <div className="row">
        <TextInput aria-label="New category" placeholder="New category, e.g. Merch" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={async (e) => {
          if (e.key === 'Enter' && name.trim()) {
            await createCategory(name);
            setName('');
          }
        }} />
        <Button
          variant="primary"
          disabled={!name.trim()}
          onClick={async () => {
            await createCategory(name);
            setName('');
          }}
        >
          <Plus size={18} /> Add
        </Button>
      </div>
      <div className="card flush">
        <div className="list">
          {categories.map((c) => (
            <div key={c.id} className="list-item">
              <Tag size={18} className="muted" />
              <span className="main-text">
                <CategoryName id={c.id} name={c.name} />
                <span>{count(c.id)} products</span>
              </span>
              <IconButton
                label={`Delete ${c.name}`}
                size="sm"
                onClick={async () => {
                  if (await app.confirm({ title: `Delete ${c.name}?`, message: 'Its products stay, with no category.', confirmLabel: 'Delete', tone: 'danger' })) await deleteCategory(c.id);
                }}
              >
                <Trash2 size={16} />
              </IconButton>
            </div>
          ))}
          {categories.length === 0 ? <p className="muted" style={{ padding: 16 }}>No categories yet.</p> : null}
        </div>
      </div>
    </div>
  );
}

function CategoryName({ id, name }: { id: string; name: string }) {
  const [v, setV] = useState(name);
  useEffect(() => setV(name), [name]);
  return <input className="input" style={{ minHeight: 34, fontWeight: 700 }} aria-label="Category name" value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v.trim() && v !== name && renameCategory(id, v)} />;
}

function Bundles() {
  const app = useApp();
  const rules = useBundleRules();
  const products = useProducts();
  const events = useEvents();
  const [editing, setEditing] = useState<Partial<BundleRule> | null>(null);
  if (!rules || !products || !events) return <Loading />;
  const pname = new Map(products.map((p) => [p.id, p.name]));
  const ename = new Map(events.map((e) => [e.id, e.name]));
  return (
    <div className="stack">
      <div className="row between wrap">
        <p className="muted" style={{ maxWidth: '65ch' }}>
          Deals like &ldquo;any 4 Cat Memes for ₱75&rdquo; apply themselves at the register when the cart qualifies, so the cashier never has to remember them.
        </p>
        <Button variant="primary" onClick={() => setEditing({ qty: 4, productIds: [], active: 1, eventId: null })}>
          <Plus size={18} /> Add bundle deal
        </Button>
      </div>
      {rules.length === 0 ? (
        <EmptyState title="No bundle deals yet">For example: Cat Meme (Solo) ×4 for ₱75, or any 4 stickers from a set.</EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Deal</th>
                <th>Applies to</th>
                <th>Where</th>
                <th>Status</th>
                <th className="r"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id}>
                  <td>
                    <b>{r.name}</b>
                    <div className="muted tiny">
                      Any {r.qty} for {peso(r.price)}
                    </div>
                  </td>
                  <td className="small">{r.productIds.map((id) => pname.get(id) ?? '?').join(', ')}</td>
                  <td className="small">{r.eventId ? ename.get(r.eventId) ?? 'An event' : 'Every event'}</td>
                  <td>{r.active ? <Badge tone="good">On</Badge> : <Badge>Off</Badge>}</td>
                  <td className="r">
                    <div className="actions" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                      <IconButton label="Edit deal" size="sm" onClick={() => setEditing(r)}>
                        <Pencil size={16} />
                      </IconButton>
                      <IconButton
                        label="Delete deal"
                        size="sm"
                        onClick={async () => {
                          if (await app.confirm({ title: `Delete ${r.name}?`, confirmLabel: 'Delete', tone: 'danger' })) await deleteBundleRule(r.id);
                        }}
                      >
                        <Trash2 size={16} />
                      </IconButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <BundleDialog rule={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function BundleDialog({ rule, onClose }: { rule: Partial<BundleRule> | null; onClose: () => void }) {
  const products = useProducts();
  const events = useEvents();
  const [f, setF] = useState<Partial<BundleRule>>({});
  const [q, setQ] = useState('');
  useEffect(() => {
    if (rule) setF({ name: '', qty: 4, price: 0, productIds: [], active: 1, eventId: null, ...rule });
  }, [rule]);
  if (!rule) return null;
  const ids = new Set(f.productIds ?? []);
  const list = (products ?? []).filter((p) => p.active === 1 && (!q || p.name.toLowerCase().includes(q.toLowerCase())));
  const normal = (products ?? []).filter((p) => ids.has(p.id)).map((p) => p.price ?? 0);
  const typical = normal.length ? Math.max(...normal) * (f.qty ?? 0) : 0;
  const save = async () => {
    if (!f.name?.trim() || !f.qty || !f.price || !ids.size) return;
    await saveBundleRule({ ...f, name: f.name.trim(), productIds: [...ids], qty: f.qty, price: f.price });
    onClose();
  };
  return (
    <Dialog
      open={!!rule}
      onClose={onClose}
      title={rule.id ? 'Edit bundle deal' : 'New bundle deal'}
      size="wide"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={!f.name?.trim() || !f.qty || !f.price || !ids.size}>
            Save deal
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Name on the receipt" htmlFor="b-name" className="span-2">
          <TextInput id="b-name" value={f.name ?? ''} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Cat Meme 4-pack" autoFocus />
        </Field>
        <Field label="How many" htmlFor="b-qty">
          <NumberInput id="b-qty" decimals={false} min={1} value={f.qty ?? null} onChange={(n) => setF({ ...f, qty: n ?? 0 })} suffix="pieces" />
        </Field>
        <Field label="For" htmlFor="b-price" hint={typical ? `Bought separately: up to ${peso(typical)}` : undefined}>
          <MoneyInput id="b-price" value={f.price ?? null} onChange={(c) => setF({ ...f, price: c ?? 0 })} />
        </Field>
        <Field label="Where" htmlFor="b-where">
          <Select id="b-where" value={f.eventId ?? ''} onChange={(e) => setF({ ...f, eventId: e.target.value || null })}>
            <option value="">Every event</option>
            {(events ?? []).map((ev) => (
              <option key={ev.id} value={ev.id}>
                Only at {ev.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="field" style={{ alignContent: 'end' }}>
          <Toggle id="b-active" checked={(f.active ?? 1) === 1} onChange={(v) => setF({ ...f, active: v ? 1 : 0 })} label="Deal is on" />
        </div>
      </div>
      <div className="field">
        <span className="label">Mix and match from these products ({ids.size})</span>
        <SearchInput value={q} onChange={setQ} placeholder="Filter products" />
        <div className="chip-row" style={{ maxHeight: 240, overflowY: 'auto' }}>
          {list.map((p) => (
            <button
              key={p.id}
              type="button"
              className="chip"
              aria-pressed={ids.has(p.id)}
              onClick={() => {
                const next = new Set(ids);
                if (next.has(p.id)) next.delete(p.id);
                else next.add(p.id);
                setF({ ...f, productIds: [...next] });
              }}
            >
              {p.name}
              {p.price !== null ? ` · ${peso(p.price)}` : ''}
            </button>
          ))}
        </div>
      </div>
    </Dialog>
  );
}

function LabelsDialog({ open, onClose, products }: { open: boolean; onClose: () => void; products: Product[] }) {
  const app = useApp();
  const settingRows = useSettingRows();
  const business = settingValue<BusinessSettings>(settingRows, 'business');
  const [copies, setCopies] = useState<Record<string, number>>({});
  const [columns, setColumns] = useState<'3' | '4'>('3');
  const [showPrice, setShowPrice] = useState(true);
  const [busy, setBusy] = useState(false);
  const active = products.filter((p) => p.active === 1);
  const total = Object.values(copies).reduce((a, b) => a + (b || 0), 0);
  const make = async () => {
    setBusy(true);
    try {
      const items: { product: Product; price: Cents | null }[] = [];
      for (const p of active) for (let i = 0; i < (copies[p.id] ?? 0); i++) items.push({ product: p, price: p.price });
      const { buildLabelSheet } = await import('../../reports/labels');
      const { deliverPdf } = await import('../../reports/pdf');
      await deliverPdf(await buildLabelSheet(items, { columns: Number(columns), showPrice, business: business.name }), `${safeFileName(business.name)} - barcode labels.pdf`);
      app.toast('Label sheet saved. Print it on A4 sticker paper.', { tone: 'good' });
    } catch (e) {
      app.toast(e instanceof Error ? e.message : 'Could not make labels', { tone: 'bad' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Barcode labels"
      size="wide"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={make} disabled={busy || total === 0}>
            {busy ? 'Making…' : `Make ${total} label${total === 1 ? '' : 's'}`}
          </Button>
        </>
      }
    >
      <p className="muted small">Print on your own A4 sticker paper and stick them on stock. Any USB or Bluetooth scanner, or the phone camera, reads them.</p>
      <div className="row wrap">
        <Segmented label="Labels per row" value={columns} onChange={setColumns} options={[{ value: '3', label: '3 per row' }, { value: '4', label: '4 per row' }]} />
        <Toggle id="lbl-price" checked={showPrice} onChange={setShowPrice} label="Show base price" />
        <Button size="sm" onClick={() => setCopies(Object.fromEntries(active.map((p) => [p.id, 1])))}>
          One of each
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setCopies({})}>
          Clear
        </Button>
      </div>
      <div className="table-wrap" style={{ maxHeight: 360 }}>
        <table className="table">
          <thead>
            <tr>
              <th>Product</th>
              <th>Barcode</th>
              <th className="r">Copies</th>
            </tr>
          </thead>
          <tbody>
            {active.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td className="mono small">{p.barcode || p.sku || '—'}</td>
                <td className="r" style={{ width: 110 }}>
                  <NumberInput ariaLabel={`Copies of ${p.name}`} decimals={false} min={0} value={copies[p.id] ?? null} onChange={(n) => setCopies({ ...copies, [p.id]: n ?? 0 })} placeholder="0" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Dialog>
  );
}
