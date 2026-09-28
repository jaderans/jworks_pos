import { useMemo, useState } from 'react';
import { Save } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { useMaterials, useSettingRows } from '../../hooks/data';
import { settingValue } from '../../db/settings';
import { Button, Callout } from '../../components/ui';
import { Field, MoneyInput, NumberInput, Select, TextInput } from '../../components/form';
import { formatPct, peso, type Cents } from '../../lib/money';
import { todayISO } from '../../lib/time';
import { materialUnitCost } from '../../domain/cost';
import { BREAK_QTYS, DEFAULT_SIZES, SHEETS, quoteStickerOrder, sheetsFor, stickerCostPerPiece, stickerPriceList, type StickerSize } from '../../domain/sticker';
import { saveQuote } from '../../services/quotes';
import type { CalcSettings } from '../../db/types';

export function StickerJob() {
  const app = useApp();
  const settingRows = useSettingRows();
  const calc = settingValue<CalcSettings>(settingRows, 'calc');
  const materials = useMaterials();
  const production = calc.roles.find((r) => /production/i.test(r.name));
  const guess = useMemo(() => {
    const find = (re: RegExp) => (materials ?? []).find((m) => re.test(m.name));
    const parts = [find(/vinyl.*matte|printable vinyl/i), find(/laminat/i), find(/ink/i)].map((m) => materialUnitCost(m) ?? 0);
    return Math.round(parts.reduce((a, b) => a + b, 0));
  }, [materials]);

  const [sheetKey, setSheetKey] = useState('A4');
  const [sheetCost, setSheetCost] = useState<Cents | null>(null);
  const [refQty, setRefQty] = useState<number | null>(30);
  const [spoilage, setSpoilage] = useState<number | null>(10);
  const [designHours, setDesignHours] = useState<number | null>(1);
  const [designRate, setDesignRate] = useState<Cents>(production?.rate ?? 0);
  const [minutes, setMinutes] = useState<number | null>(10);
  const [prodRate, setProdRate] = useState<Cents>(production?.rate ?? 0);
  const [overhead, setOverhead] = useState<number | null>(calc.overheadPct);
  const [margin, setMargin] = useState<number | null>(calc.targetMarginPct);
  const [manualBase, setManualBase] = useState<Cents | null>(null);
  const [sizes, setSizes] = useState<StickerSize[]>(DEFAULT_SIZES);
  const [orderSize, setOrderSize] = useState('2 × 2 in');
  const [orderQty, setOrderQty] = useState<number | null>(50);
  const [client, setClient] = useState('');

  const input = {
    sheet: (SHEETS.find((s) => s.key === sheetKey) ?? SHEETS[0]).spec,
    sheetCost: sheetCost ?? guess,
    refQty: refQty ?? 30,
    spoilagePct: spoilage ?? 0,
    designHours: designHours ?? 0,
    designRate,
    minutesPerSheet: minutes ?? 0,
    productionRate: prodRate,
    overheadPct: overhead ?? 0,
    targetMarginPct: margin ?? 0,
    roundTo: calc.roundTo,
    baseW: 2,
    baseH: 2,
    manualBasePrice: manualBase,
    sizes,
  };
  const list = stickerPriceList(input);
  const row = list.rows.find((r) => r.label === orderSize) ?? list.rows[2];
  const order = row ? quoteStickerOrder(input, row, orderQty ?? 0) : null;

  const save = async () => {
    if (!order) return;
    const q = await saveQuote({
      date: todayISO(),
      client: client.trim(),
      project: `${orderQty} stickers, ${orderSize}`,
      category: calc.categories[0] ?? 'Stickers / Merch',
      kind: 'sticker',
      qty: orderQty ?? 0,
      unitPrice: order.pricePerPc,
      total: order.totalPrice,
      cost: Math.round(order.totalCost),
      status: 'quoted',
      notes: '',
      inputs: { input, orderSize, orderQty },
    });
    app.toast(`Saved as ${q.quoteNo}`, { tone: 'good' });
  };

  return (
    <div className="stack loose">
      <p className="muted" style={{ maxWidth: '78ch' }}>
        2 × 2 in is the base price; every other size is a multiple of it. Buy by the sheet, sell by the piece. Pricing purely by area would be wrong: peeling, sleeving and handling take the same time whatever the size.
      </p>
      <div className="grid-2">
        <div className="card">
          <h2>The sheet and the run</h2>
          <div className="form-grid">
            <Field label="Sheet" htmlFor="sj-sheet">
              <Select id="sj-sheet" value={sheetKey} onChange={(e) => setSheetKey(e.target.value)}>
                {SHEETS.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Vinyl + laminate + ink per sheet" htmlFor="sj-cost" hint={guess ? `From your materials: ${peso(guess)}` : 'Add pack costs in Production → Materials, or type it here.'}>
              <MoneyInput id="sj-cost" value={sheetCost ?? (guess || null)} onChange={setSheetCost} />
            </Field>
            <Field label="Reference quantity" htmlFor="sj-ref" hint="The price list is costed at this run size.">
              <NumberInput id="sj-ref" decimals={false} value={refQty} onChange={setRefQty} suffix="pcs" />
            </Field>
            <Field label="Spoilage" htmlFor="sj-spoil">
              <NumberInput id="sj-spoil" value={spoilage} onChange={setSpoilage} suffix="%" />
            </Field>
            <Field label="Design time (one-time)" htmlFor="sj-design" hint="On small stickers this is the biggest cost.">
              <NumberInput id="sj-design" value={designHours} onChange={setDesignHours} suffix="h" />
            </Field>
            <Field label="Design rate" htmlFor="sj-drate">
              <Select id="sj-drate" value={String(designRate)} onChange={(e) => setDesignRate(Number(e.target.value))}>
                {calc.roles.map((r) => (
                  <option key={r.name} value={r.rate}>
                    {r.name} · {peso(r.rate)}/hr
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Work per sheet" htmlFor="sj-min" hint="Print, laminate, cut, weed.">
              <NumberInput id="sj-min" value={minutes} onChange={setMinutes} suffix="min" />
            </Field>
            <Field label="Production rate" htmlFor="sj-prate">
              <Select id="sj-prate" value={String(prodRate)} onChange={(e) => setProdRate(Number(e.target.value))}>
                {calc.roles.map((r) => (
                  <option key={r.name} value={r.rate}>
                    {r.name} · {peso(r.rate)}/hr
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Overhead" htmlFor="sj-over">
              <NumberInput id="sj-over" value={overhead} onChange={setOverhead} suffix="%" />
            </Field>
            <Field label="Target margin" htmlFor="sj-margin">
              <NumberInput id="sj-margin" value={margin} onChange={setMargin} suffix="%" />
            </Field>
          </div>
        </div>
        <div className="card">
          <h2>Base price: 2 × 2 in</h2>
          <div className="stack tight">
            <div className="row between"><span>Fits per sheet</span><b>{list.basePerSheet}</b></div>
            <div className="row between"><span>Cost per piece at {refQty ?? 0} pcs</span><b>{list.baseCost === null ? '—' : peso(Math.round(list.baseCost), { decimals: 2 })}</b></div>
            <div className="row between"><span>Suggested base price</span><b>{peso(list.baseAuto)}</b></div>
          </div>
          <Field label="Your base price (optional)" htmlFor="sj-manual" hint="Leave blank to use the suggestion. Round shelf prices like ₱25 or ₱30 read better.">
            <MoneyInput id="sj-manual" value={manualBase} onChange={setManualBase} placeholder={String(list.baseAuto / 100)} />
          </Field>
          <div className="row between total-line">
            <span>Base price in use</span>
            <b className="num">{peso(list.baseInUse)}</b>
          </div>
        </div>
      </div>

      <div className="stack">
        <h2>Price list by size</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Size</th>
                <th className="r">Per sheet</th>
                <th className="r">Cost each</th>
                <th className="r">Multiplier</th>
                <th className="r">Price</th>
                <th className="r">Margin</th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((r, i) => (
                <tr key={r.label}>
                  <td>
                    <b>{r.label}</b>
                  </td>
                  <td className="r">{r.perSheet}</td>
                  <td className="r">{r.costPerPc === null ? '—' : peso(Math.round(r.costPerPc), { decimals: 2 })}</td>
                  <td className="r" style={{ width: 120 }}>
                    <NumberInput ariaLabel={`Multiplier for ${r.label}`} value={r.multiplier} onChange={(n) => setSizes(sizes.map((s, k) => (k === i ? { ...s, multiplier: n ?? 0 } : s)))} suffix="×" />
                  </td>
                  <td className="r strong">{peso(r.price)}</td>
                  <td className="r">
                    <span className={r.marginPct !== null && r.marginPct < calc.minMarginPct ? 'bad strong' : ''}>{formatPct(r.marginPct)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h2>Quote one order</h2>
          <div className="form-grid">
            <Field label="Size" htmlFor="sj-osize">
              <Select id="sj-osize" value={orderSize} onChange={(e) => setOrderSize(e.target.value)}>
                {list.rows.map((r) => (
                  <option key={r.label}>{r.label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Pieces" htmlFor="sj-oqty">
              <NumberInput id="sj-oqty" decimals={false} value={orderQty} onChange={setOrderQty} />
            </Field>
            <Field label="Client (optional)" htmlFor="sj-client" className="span-2">
              <TextInput id="sj-client" value={client} onChange={(e) => setClient(e.target.value)} />
            </Field>
          </div>
          {order ? (
            <div className="waterfall">
              <div className="wf-row"><span>Sheets to print (with spoilage)</span><span className="v">{order.sheets} → {order.piecesMade} pcs, {order.spare} spare</span></div>
              <div className="wf-row"><span>Materials</span><span className="v">{peso(Math.round(order.materials))}</span></div>
              <div className="wf-row"><span>Labor (design + production)</span><span className="v">{peso(Math.round(order.labor))}</span></div>
              <div className="wf-row total"><span>Total cost (with overhead)</span><span className="v">{peso(Math.round(order.totalCost))}</span></div>
              <div className="wf-row"><span>{orderQty} × {peso(order.pricePerPc)}</span><span className="v">{peso(order.totalPrice)}</span></div>
              <div className="wf-row final"><span>Profit · margin</span><span className="v">{peso(Math.round(order.profit))} · {formatPct(order.marginPct)}</span></div>
            </div>
          ) : (
            <Callout tone="warn">That size doesn&rsquo;t fit on the sheet.</Callout>
          )}
          <div className="actions">
            <Button variant="primary" onClick={save} disabled={!order}>
              <Save size={16} /> Save quote
            </Button>
          </div>
        </div>
        <div className="card">
          <h2>Quantity breaks for {orderSize}</h2>
          <p className="sub">One list price, but cost per piece falls as the order grows. Where margin turns red, the list price no longer covers a run that small: that&rsquo;s your minimum order.</p>
          <div className="table-wrap" style={{ border: 0 }}>
            <table className="table">
              <thead>
                <tr>
                  <th className="r">Order</th>
                  <th className="r">Sheets</th>
                  <th className="r">Cost each</th>
                  <th className="r">Margin at list</th>
                </tr>
              </thead>
              <tbody>
                {row
                  ? BREAK_QTYS.map((qty) => {
                      const c = stickerCostPerPiece(input, row.perSheet, qty);
                      const m = c !== null && row.price > 0 ? ((row.price - c) / row.price) * 100 : null;
                      return (
                        <tr key={qty}>
                          <td className="r">{qty}</td>
                          <td className="r">{sheetsFor(qty, row.perSheet, input.spoilagePct)}</td>
                          <td className="r">{c === null ? '—' : peso(Math.round(c), { decimals: 2 })}</td>
                          <td className="r">
                            <span className={m !== null && m < calc.minMarginPct ? 'bad strong' : ''}>{formatPct(m)}</span>
                          </td>
                        </tr>
                      );
                    })
                  : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
