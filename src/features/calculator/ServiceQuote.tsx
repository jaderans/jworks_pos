import { useMemo, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { useMaterials, useSettingRows } from '../../hooks/data';
import { settingValue } from '../../db/settings';
import { Badge, Button, Callout, IconButton, Segmented, Toggle } from '../../components/ui';
import { Field, MoneyInput, NumberInput, Select, TextInput } from '../../components/form';
import { formatPct, peso, type Cents } from '../../lib/money';
import { todayISO } from '../../lib/time';
import { materialUnitCost } from '../../domain/cost';
import { computeServiceQuote, type LaborLine, type MaterialLine, type OtherLine, type OutsourcedLine, type PricingMethod } from '../../domain/quote';
import { saveQuote } from '../../services/quotes';
import type { CalcSettings } from '../../db/types';

export function ServiceQuote() {
  const app = useApp();
  const settingRows = useSettingRows();
  const calc = settingValue<CalcSettings>(settingRows, 'calc');
  const materials = useMaterials();
  const [project, setProject] = useState('');
  const [client, setClient] = useState('');
  const [category, setCategory] = useState(calc.categories[1] ?? '');
  const [qty, setQty] = useState<number | null>(1);
  const [mats, setMats] = useState<(MaterialLine & { materialId: string })[]>([]);
  const [outsourced, setOutsourced] = useState<OutsourcedLine[]>([]);
  const [labor, setLabor] = useState<LaborLine[]>([{ role: calc.roles[0]?.name ?? 'Creative Director / Owner', hours: 2, rate: calc.roles[0]?.rate ?? 0 }]);
  const [other, setOther] = useState<OtherLine[]>([]);
  const [overhead, setOverhead] = useState<number | null>(calc.overheadPct);
  const [method, setMethod] = useState<PricingMethod>('margin');
  const [markup, setMarkup] = useState<number | null>(calc.markupPct);
  const [margin, setMargin] = useState<number | null>(calc.targetMarginPct);
  const [manual, setManual] = useState<Cents | null>(null);
  const [addons, setAddons] = useState({ rush: false, revision: 0, sourceFiles: false, ipBuyout: false });
  const [vat, setVat] = useState(calc.vatRegistered);
  const [ewt, setEwt] = useState(false);

  const r = useMemo(
    () =>
      computeServiceQuote({
        qty: qty ?? 1,
        materials: mats,
        outsourced,
        labor,
        other,
        overheadPct: overhead ?? 0,
        method,
        markupPct: markup ?? 0,
        marginPct: margin ?? 0,
        manualPrice: manual,
        roundTo: calc.roundTo,
        addons,
        addonPcts: calc.addons,
        vatRegistered: vat,
        vatPct: calc.vatPct,
        ewt,
        ewtPct: calc.ewtPct,
        minMarginPct: calc.minMarginPct,
      }),
    [qty, mats, outsourced, labor, other, overhead, method, markup, margin, manual, calc, addons, vat, ewt],
  );

  const save = async () => {
    const q = await saveQuote({
      date: todayISO(),
      client: client.trim(),
      project: project.trim() || 'Untitled job',
      category,
      kind: 'service',
      qty: qty ?? 1,
      unitPrice: r.pricePerPc,
      total: r.invoice,
      cost: Math.round(r.totalCost),
      status: 'quoted',
      notes: '',
      inputs: { mats, outsourced, labor, other, overhead, method, markup, margin, manual, addons, vat, ewt, result: r },
    });
    app.toast(`Saved as ${q.quoteNo}. Find it under Quotes.`, { tone: 'good' });
  };

  const exportPdf = async () => {
    const { buildQuotePdf } = await import('../../reports/quotePdf');
    const { deliverPdf } = await import('../../reports/pdf');
    const business = settingValue<{ name: string; contact: string; address: string }>(settingRows, 'business');
    await deliverPdf(await buildQuotePdf({ business, quoteNo: 'DRAFT', date: todayISO(), client, project, category, qty: qty ?? 1, result: r, labor, outsourced, vat, ewt }), `Quote - ${client || 'client'} - ${project || 'job'}.pdf`);
  };

  const healthTone = r.health === 'healthy' ? 'good' : r.health === 'thin' ? 'warn' : r.health === 'loss' ? 'bad' : undefined;

  return (
    <div className="calc-layout">
      <div className="stack loose">
        <div className="card">
          <h2>The job</h2>
          <div className="form-grid">
            <Field label="Project" htmlFor="sq-project">
              <TextInput id="sq-project" value={project} onChange={(e) => setProject(e.target.value)} placeholder="e.g. Org shirt design + 30 prints" />
            </Field>
            <Field label="Client" htmlFor="sq-client">
              <TextInput id="sq-client" value={client} onChange={(e) => setClient(e.target.value)} />
            </Field>
            <Field label="Category" htmlFor="sq-cat">
              <Select id="sq-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
                {calc.categories.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </Field>
            <Field label="Quantity" htmlFor="sq-qty" hint="1 for a single design job; pieces for merch.">
              <NumberInput id="sq-qty" decimals={false} min={1} value={qty} onChange={setQty} />
            </Field>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Labor</h2>
            <Button size="sm" onClick={() => setLabor([...labor, { role: calc.roles[2]?.name ?? '', hours: 1, rate: calc.roles[2]?.rate ?? 0 }])}>
              <Plus size={16} /> Add role
            </Button>
          </div>
          <p className="sub">Always include your own hours. Free labor is how a studio quietly goes broke.</p>
          {labor.map((l, i) => (
            <div key={i} className="row wrap">
              <Select
                aria-label="Role"
                value={l.role}
                onChange={(e) => {
                  const role = calc.roles.find((x) => x.name === e.target.value);
                  setLabor(labor.map((x, k) => (k === i ? { ...x, role: e.target.value, rate: role?.rate ?? x.rate } : x)));
                }}
                style={{ flex: 2, minWidth: 180 }}
              >
                {calc.roles.map((x) => (
                  <option key={x.name} value={x.name}>
                    {x.name} · {peso(x.rate)}/hr
                  </option>
                ))}
              </Select>
              <div style={{ width: 120 }}>
                <NumberInput ariaLabel="Hours" value={l.hours} onChange={(n) => setLabor(labor.map((x, k) => (k === i ? { ...x, hours: n ?? 0 } : x)))} suffix="h" />
              </div>
              <span className="num strong" style={{ width: 90, textAlign: 'right' }}>
                {peso(Math.round(l.hours * l.rate))}
              </span>
              <IconButton label="Remove" size="sm" onClick={() => setLabor(labor.filter((_, k) => k !== i))}>
                <Trash2 size={16} />
              </IconButton>
            </div>
          ))}
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Materials</h2>
            <Button size="sm" disabled={!materials?.length} onClick={() => {
              const m = materials![0];
              setMats([...mats, { materialId: m.id, name: m.name, qtyPerPc: 1, unitCost: materialUnitCost(m) ?? 0 }]);
            }}>
              <Plus size={16} /> Add material
            </Button>
          </div>
          {mats.length === 0 ? <p className="sub">Only for jobs that use your own stock (per piece).</p> : null}
          {mats.map((m, i) => (
            <div key={i} className="row wrap">
              <Select
                aria-label="Material"
                value={m.materialId}
                onChange={(e) => {
                  const mm = materials?.find((x) => x.id === e.target.value);
                  setMats(mats.map((x, k) => (k === i ? { ...x, materialId: e.target.value, name: mm?.name ?? '', unitCost: materialUnitCost(mm) ?? 0 } : x)));
                }}
                style={{ flex: 2, minWidth: 180 }}
              >
                {(materials ?? []).map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </Select>
              <div style={{ width: 130 }}>
                <NumberInput ariaLabel="Per piece" value={m.qtyPerPc} onChange={(n) => setMats(mats.map((x, k) => (k === i ? { ...x, qtyPerPc: n ?? 0 } : x)))} suffix="each" />
              </div>
              <span className="small" style={{ width: 90 }}>{m.unitCost ? peso(Math.round(m.unitCost), { decimals: 2 }) : <span className="warn">No cost</span>}</span>
              <IconButton label="Remove" size="sm" onClick={() => setMats(mats.filter((_, k) => k !== i))}>
                <Trash2 size={16} />
              </IconButton>
            </div>
          ))}
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Printing and outsourced</h2>
            <Button size="sm" onClick={() => setOutsourced([...outsourced, { desc: '', qty: 1, unitCost: 0, supplier: '' }])}>
              <Plus size={16} /> Add line
            </Button>
          </div>
          {outsourced.length === 0 ? <p className="sub">Tarp printing, shirt printing, DTF, enamel pin manufacturing…</p> : null}
          {outsourced.map((o, i) => (
            <div key={i} className="row wrap">
              <TextInput aria-label="Description" placeholder="e.g. DTF print, front" value={o.desc} onChange={(e) => setOutsourced(outsourced.map((x, k) => (k === i ? { ...x, desc: e.target.value } : x)))} style={{ flex: 2, minWidth: 160 }} />
              <div style={{ width: 100 }}>
                <NumberInput ariaLabel="Quantity" value={o.qty} onChange={(n) => setOutsourced(outsourced.map((x, k) => (k === i ? { ...x, qty: n ?? 0 } : x)))} />
              </div>
              <div style={{ width: 130 }}>
                <MoneyInput ariaLabel="Unit cost" value={o.unitCost} onChange={(c) => setOutsourced(outsourced.map((x, k) => (k === i ? { ...x, unitCost: c ?? 0 } : x)))} />
              </div>
              <IconButton label="Remove" size="sm" onClick={() => setOutsourced(outsourced.filter((_, k) => k !== i))}>
                <Trash2 size={16} />
              </IconButton>
            </div>
          ))}
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Other direct costs</h2>
            <Button size="sm" onClick={() => setOther([...other, { desc: '', amount: 0 }])}>
              <Plus size={16} /> Add line
            </Button>
          </div>
          {other.length === 0 ? <p className="sub">Delivery, stock photos, fonts, transport.</p> : null}
          {other.map((o, i) => (
            <div key={i} className="row wrap">
              <TextInput aria-label="Description" value={o.desc} onChange={(e) => setOther(other.map((x, k) => (k === i ? { ...x, desc: e.target.value } : x)))} style={{ flex: 2, minWidth: 160 }} />
              <div style={{ width: 140 }}>
                <MoneyInput ariaLabel="Amount" value={o.amount} onChange={(c) => setOther(other.map((x, k) => (k === i ? { ...x, amount: c ?? 0 } : x)))} />
              </div>
              <IconButton label="Remove" size="sm" onClick={() => setOther(other.filter((_, k) => k !== i))}>
                <Trash2 size={16} />
              </IconButton>
            </div>
          ))}
        </div>

        <div className="card">
          <h2>Pricing</h2>
          <div className="form-grid">
            <Field label="Overhead" htmlFor="sq-over" hint="Rent, internet, Adobe, electricity, printer wear.">
              <NumberInput id="sq-over" value={overhead} onChange={setOverhead} suffix="%" />
            </Field>
            <div className="field">
              <span className="label">Method</span>
              <Segmented<PricingMethod>
                label="Pricing method"
                value={method}
                onChange={setMethod}
                options={[
                  { value: 'margin', label: 'Target margin' },
                  { value: 'markup', label: 'Markup' },
                  { value: 'manual', label: 'My price' },
                ]}
              />
            </div>
            {method === 'margin' ? (
              <Field label="Target margin" htmlFor="sq-margin" hint={`Needs a ${((margin ?? 0) < 100 ? ((margin ?? 0) / (100 - (margin ?? 0))) * 100 : 0).toFixed(0)}% markup on cost.`}>
                <NumberInput id="sq-margin" value={margin} onChange={setMargin} suffix="%" />
              </Field>
            ) : method === 'markup' ? (
              <Field label="Markup on cost" htmlFor="sq-markup" hint={`Real margin: ${(((markup ?? 0) / (100 + (markup ?? 0))) * 100).toFixed(1)}%.`}>
                <NumberInput id="sq-markup" value={markup} onChange={setMarkup} suffix="%" />
              </Field>
            ) : (
              <Field label="Price per piece" htmlFor="sq-manual">
                <MoneyInput id="sq-manual" value={manual} onChange={setManual} />
              </Field>
            )}
          </div>
          <h3>Add-ons</h3>
          <div className="row wrap" style={{ gap: 18 }}>
            <Toggle id="ad-rush" checked={addons.rush} onChange={(v) => setAddons({ ...addons, rush: v })} label={`Rush job (+${calc.addons.rush}%)`} />
            <Toggle id="ad-src" checked={addons.sourceFiles} onChange={(v) => setAddons({ ...addons, sourceFiles: v })} label={`Source files (+${calc.addons.sourceFiles}%)`} />
            <Toggle id="ad-ip" checked={addons.ipBuyout} onChange={(v) => setAddons({ ...addons, ipBuyout: v })} label={`Full IP buy-out (+${calc.addons.ipBuyout}%)`} />
            <div className="row">
              <span className="small strong">Extra revision rounds (+{calc.addons.revision}% each)</span>
              <div style={{ width: 90 }}>
                <NumberInput ariaLabel="Extra revision rounds" decimals={false} min={0} value={addons.revision} onChange={(n) => setAddons({ ...addons, revision: n ?? 0 })} />
              </div>
            </div>
          </div>
          <h3>Tax (Philippines)</h3>
          <div className="row wrap" style={{ gap: 18 }}>
            <Toggle id="tx-vat" checked={vat} onChange={setVat} label={`JoshWorks is VAT-registered (${calc.vatPct}%)`} />
            <Toggle id="tx-ewt" checked={ewt} onChange={setEwt} label={`Client withholds ${calc.ewtPct}% EWT`} />
          </div>
          <p className="sub">Say yes to EWT for LGUs, schools and most corporations. It isn&rsquo;t a loss: they hand you a BIR 2307, which is a tax credit. Check VAT and withholding with your accountant.</p>
        </div>
      </div>

      <aside className="calc-answer">
        <div className="card pad-lg">
          <span className="eyebrow">The answer</span>
          <div className="stack tight">
            <div className="row between">
              <span>Price per piece</span>
              <b className="num" style={{ fontSize: '1.6rem' }}>
                {peso(r.pricePerPc)}
              </b>
            </div>
            <div className="row between small">
              <span>Cost per piece</span>
              <span className="num">{peso(Math.round(r.costPerPc))}</span>
            </div>
            <hr className="divider" />
            <div className="row between">
              <span>Total price</span>
              <b className="num">{peso(r.totalPrice)}</b>
            </div>
            {r.addons.map((a) => (
              <div key={a.label} className="row between small">
                <span>+ {a.label}</span>
                <span className="num">{peso(a.amount)}</span>
              </div>
            ))}
            {r.vat ? (
              <div className="row between small">
                <span>+ VAT</span>
                <span className="num">{peso(r.vat)}</span>
              </div>
            ) : null}
            <div className="row between total-line">
              <span>Invoice total</span>
              <b className="num">{peso(r.invoice)}</b>
            </div>
            {r.ewt ? (
              <div className="row between small">
                <span>You receive (after {calc.ewtPct}% EWT)</span>
                <span className="num">{peso(r.cashReceived)}</span>
              </div>
            ) : null}
            <hr className="divider" />
            <div className="row between small">
              <span>Total cost</span>
              <span className="num">{peso(Math.round(r.totalCost))}</span>
            </div>
            <div className="row between small">
              <span>Profit</span>
              <span className="num strong">{peso(Math.round(r.profit))}</span>
            </div>
            <div className="row between small">
              <span>Margin · markup</span>
              <span className="num">
                {formatPct(r.marginPct, 1)} · {formatPct(r.markupPct, 1)}
              </span>
            </div>
            <div className="row between">
              <span className="small">Health</span>
              <Badge tone={healthTone}>{r.health === 'healthy' ? 'Healthy' : r.health === 'thin' ? `Too thin (under ${calc.minMarginPct}%)` : r.health === 'loss' ? 'Losing money' : 'Fill in the job'}</Badge>
            </div>
            {r.breakEvenQty ? <p className="muted tiny">Break-even quantity at this price: {r.breakEvenQty}</p> : null}
          </div>
          <div className="actions">
            <Button variant="primary" onClick={save} disabled={r.totalPrice <= 0}>
              <Save size={16} /> Save quote
            </Button>
            <Button onClick={exportPdf} disabled={r.totalPrice <= 0}>
              Quote PDF
            </Button>
          </div>
        </div>
        <div className="card">
          <h3>If the client pushes back</h3>
          <div className="table-wrap" style={{ border: 0 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Price</th>
                  <th className="r">Margin</th>
                  <th className="r">Profit</th>
                </tr>
              </thead>
              <tbody>
                {r.ladder.map((l) => (
                  <tr key={l.factor} className={l.factor === 1 ? '' : 'muted'} style={l.factor === 1 ? { background: 'var(--teal-soft)' } : undefined}>
                    <td>
                      {peso(l.price)} <span className="tiny">({l.factor === 1 ? 'yours' : `${l.factor > 1 ? '+' : '−'}${Math.round(Math.abs(l.factor - 1) * 100)}%`})</span>
                    </td>
                    <td className="r">
                      <span className={l.marginPct !== null && l.marginPct < calc.minMarginPct ? 'bad' : ''}>{formatPct(l.marginPct)}</span>
                    </td>
                    <td className="r">{peso(Math.round(l.profit))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {r.health === 'thin' ? <Callout tone="warn">Below your {calc.minMarginPct}% minimum. Raise the price or walk away.</Callout> : null}
        </div>
      </aside>
    </div>
  );
}
