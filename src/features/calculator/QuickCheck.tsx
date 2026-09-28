import { useState } from 'react';
import { useSettingRows } from '../../hooks/data';
import { settingValue } from '../../db/settings';
import { Badge } from '../../components/ui';
import { Field, MoneyInput, NumberInput } from '../../components/form';
import { formatPct, peso, percentOf, type Cents } from '../../lib/money';
import { boothPricing, marginToMarkup, markupToMargin, reverseCheck } from '../../domain/quote';
import { Meter } from '../../components/charts';
import type { CalcSettings } from '../../db/types';

export function QuickCheck() {
  const settingRows = useSettingRows();
  const calc = settingValue<CalcSettings>(settingRows, 'calc');
  const [offered, setOffered] = useState<Cents | null>(25000);
  const [cost, setCost] = useState<Cents | null>(15000);
  const [mk, setMk] = useState<number | null>(60);
  const [mg, setMg] = useState<number | null>(45);
  const [ladderPrice, setLadderPrice] = useState<Cents | null>(null);
  const [ladderCost, setLadderCost] = useState<Cents | null>(null);
  const [fee, setFee] = useState<Cents | null>(300000);
  const [bCost, setBCost] = useState<Cents | null>(900);
  const [bPrice, setBPrice] = useState<Cents | null>(2500);
  const [bQty, setBQty] = useState<number | null>(150);
  const [bTarget, setBTarget] = useState<Cents | null>(150000);

  const rc = reverseCheck(offered ?? 0, cost ?? 0, calc.minMarginPct);
  const booth = boothPricing({ fixedCosts: fee ?? 0, unitCost: bCost ?? 0, price: bPrice ?? 0, expectedQty: bQty ?? 0, targetProfit: bTarget ?? 0, roundTo: calc.roundTo });
  const ladder = [
    { from: 1, off: 0 },
    { from: 10, off: 5 },
    { from: 25, off: 10 },
    { from: 50, off: 15 },
    { from: 100, off: 20 },
    { from: 250, off: 25 },
  ];

  return (
    <div className="grid-2">
      <div className="card">
        <h2>Client named a price first</h2>
        <p className="sub">Is it worth taking?</p>
        <div className="form-grid">
          <Field label="Their offer (per piece)" htmlFor="qc-offer">
            <MoneyInput id="qc-offer" value={offered} onChange={setOffered} />
          </Field>
          <Field label="Your cost (per piece)" htmlFor="qc-cost">
            <MoneyInput id="qc-cost" value={cost} onChange={setCost} />
          </Field>
        </div>
        <div className="stack tight">
          <div className="row between"><span>Profit per piece</span><b className="num">{peso(rc.profit)}</b></div>
          <div className="row between"><span>Margin · markup</span><b className="num">{formatPct(rc.margin, 1)} · {formatPct(rc.markup, 1)}</b></div>
          <div className="row between">
            <span>Verdict</span>
            <Badge tone={rc.verdict === 'ok' ? 'good' : rc.verdict === 'thin' ? 'warn' : rc.verdict === 'loss' ? 'bad' : undefined}>
              {rc.verdict === 'ok' ? 'Acceptable' : rc.verdict === 'thin' ? `Too thin (under ${calc.minMarginPct}%)` : rc.verdict === 'loss' ? 'Losing money' : 'Fill in both'}
            </Badge>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Markup ↔ margin</h2>
        <p className="sub">Add 40% to cost and you earn a 28.6% margin, not 40%. To earn a 45% margin you must mark up by 82%.</p>
        <div className="form-grid">
          <Field label="If I mark up by" htmlFor="qc-mk" hint={`…my real margin is ${formatPct(markupToMargin(mk ?? 0), 1)}`}>
            <NumberInput id="qc-mk" value={mk} onChange={setMk} suffix="%" />
          </Field>
          <Field label="If I want a margin of" htmlFor="qc-mg" hint={`…I must mark up by ${formatPct(marginToMarkup(mg ?? 0), 1)}`}>
            <NumberInput id="qc-mg" value={mg} onChange={setMg} suffix="%" />
          </Field>
        </div>
      </div>

      <div className="card">
        <h2>What a booth fee does to a price</h2>
        <p className="sub">The booth is one bill for the whole event, so it&rsquo;s shown as a break-even target, not added to every price.</p>
        <div className="form-grid">
          <Field label="Booth fee and event costs" htmlFor="qc-fee">
            <MoneyInput id="qc-fee" value={fee} onChange={setFee} />
          </Field>
          <Field label="Production cost per item" htmlFor="qc-bcost">
            <MoneyInput id="qc-bcost" value={bCost} onChange={setBCost} />
          </Field>
          <Field label="Selling price" htmlFor="qc-bprice">
            <MoneyInput id="qc-bprice" value={bPrice} onChange={setBPrice} />
          </Field>
          <Field label="Items you expect to sell" htmlFor="qc-bqty">
            <NumberInput id="qc-bqty" decimals={false} value={bQty} onChange={setBQty} />
          </Field>
          <Field label="Profit you want" htmlFor="qc-btarget" className="span-2">
            <MoneyInput id="qc-btarget" value={bTarget} onChange={setBTarget} />
          </Field>
        </div>
        <Meter value={bQty ?? 0} mark={booth.breakEven} ok={booth.covers} />
        <div className="stack tight small">
          <div className="row between"><span>Break-even</span><b>{booth.breakEven === null ? 'Never at this price' : `${booth.breakEven} items`}</b></div>
          <div className="row between"><span>Booth cost per item</span><b>{booth.boothPerItem === null ? '—' : peso(Math.round(booth.boothPerItem))}</b></div>
          <div className="row between"><span>Floor price (break even)</span><b>{booth.floorRounded === null ? '—' : peso(booth.floorRounded)}</b></div>
          <div className="row between"><span>Price for your target</span><b>{booth.targetPrice === null ? '—' : peso(booth.targetPrice)}</b></div>
          <div className="row between"><span>Result at {bQty ?? 0} items</span><b className={booth.projected >= 0 ? 'good' : 'bad'}>{peso(booth.projected)}</b></div>
        </div>
      </div>

      <div className="card">
        <h2>Bulk discount ladder</h2>
        <p className="sub">See what each discount step does to your margin.</p>
        <div className="form-grid">
          <Field label="List price per piece" htmlFor="qc-lprice">
            <MoneyInput id="qc-lprice" value={ladderPrice} onChange={setLadderPrice} />
          </Field>
          <Field label="Cost per piece" htmlFor="qc-lcost">
            <MoneyInput id="qc-lcost" value={ladderCost} onChange={setLadderCost} />
          </Field>
        </div>
        <div className="table-wrap" style={{ border: 0 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Order from</th>
                <th className="r">Discount</th>
                <th className="r">Price each</th>
                <th className="r">Margin</th>
              </tr>
            </thead>
            <tbody>
              {ladder.map((l) => {
                const price = (ladderPrice ?? 0) - percentOf(ladderPrice ?? 0, l.off);
                const m = price > 0 ? ((price - (ladderCost ?? 0)) / price) * 100 : null;
                return (
                  <tr key={l.from}>
                    <td>{l.from} pcs</td>
                    <td className="r">{l.off}%</td>
                    <td className="r">{ladderPrice ? peso(price) : '—'}</td>
                    <td className="r">
                      <span className={m !== null && m < calc.minMarginPct ? 'bad strong' : ''}>{ladderPrice ? formatPct(m) : '—'}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
