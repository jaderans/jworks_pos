import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { useCategories, useProducts, useSales } from '../../hooks/data';
import { Badge, Button, Callout, IconButton, Segmented, Toggle } from '../../components/ui';
import { Field, MoneyInput, NumberInput, Select, TextInput } from '../../components/form';
import { uid } from '../../lib/ids';
import { updateEvent } from '../../services/events';
import { BLANK_WHEEL, tryAgainChance, wheelProblem, wheelRuleText, wheelSlices, winsToday, type WheelConfig, type WheelPrize } from '../../domain/wheel';
import { WheelSvg } from '../display/WheelSvg';
import type { JWEvent } from '../../db/types';

const blankPrize = (): WheelPrize => ({ id: uid(), label: '', kind: 'item', productId: null, voucher: { kind: 'amount', value: 2000 }, chance: 10, perDay: null });

/**
 * Event → Wheel: the prize wheel customers spin after a big enough sale. The
 * owner sets when it spins, the prizes, each one's chance and daily limit.
 */
export default function WheelTab({ ev }: { ev: JWEvent }) {
  const app = useApp();
  const products = useProducts();
  const categories = useCategories();
  const sales = useSales(ev.id);
  const [w, setW] = useState<WheelConfig>(ev.wheel ?? BLANK_WHEEL);
  const [busy, setBusy] = useState(false);
  useEffect(() => setW(ev.wheel ?? BLANK_WHEEL), [ev.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const wins = useMemo(() => winsToday(sales ?? []), [sales]);
  const dirty = JSON.stringify(w) !== JSON.stringify(ev.wheel ?? BLANK_WHEEL);
  const problem = wheelProblem(w);
  const slices = wheelSlices(w);
  const setPrize = (id: string, ch: Partial<WheelPrize>) => setW({ ...w, prizes: w.prizes.map((p) => (p.id === id ? { ...p, ...ch } : p)) });

  const save = async () => {
    if (problem && w.on) return app.toast(problem, { tone: 'bad' });
    setBusy(true);
    await updateEvent(ev.id, { wheel: { ...w, prizes: w.prizes.map((p) => ({ ...p, label: p.label.trim() })) } });
    setBusy(false);
    app.toast(w.on ? 'Prize wheel saved. Qualifying sales can spin now.' : 'Prize wheel saved (off).', { tone: 'good' });
  };

  return (
    <div className="stack loose">
      <Callout tone="warn" title="Get a DTI permit first">
        A sales promo with a chance to win needs a permit from the Department of Trade and Industry before you run it.
      </Callout>
      <div className="wheel-setup">
        <div className="card stack">
          <div className="card-head">
            <h2>Prize wheel</h2>
            <Toggle id="wh-on" checked={w.on} onChange={(on) => setW({ ...w, on })} label="On at this event" />
          </div>
          <p className="sub">After a sale that qualifies, the cashier taps Spin on the receipt and the wheel spins on the customer screen. Each sale spins once.</p>

          <h3>When it spins</h3>
          <div className="form-grid">
            <Field label="Spend at least" htmlFor="wh-spend" hint="Leave empty for no spend rule.">
              <MoneyInput id="wh-spend" value={w.minSpend} onChange={(c) => setW({ ...w, minSpend: c && c > 0 ? c : null })} placeholder="No spend rule" />
            </Field>
            <Field label="Or buy at least" htmlFor="wh-items" hint="Leave empty for no item rule.">
              <NumberInput id="wh-items" decimals={false} min={1} value={w.minItems?.count ?? null} onChange={(n) => setW({ ...w, minItems: n && n > 0 ? { count: Math.round(n), categoryId: w.minItems?.categoryId ?? null } : null })} suffix="items" />
            </Field>
            {w.minItems ? (
              <Field label="Items from" htmlFor="wh-cat">
                <Select id="wh-cat" value={w.minItems.categoryId ?? ''} onChange={(e) => setW({ ...w, minItems: { count: w.minItems!.count, categoryId: e.target.value || null } })}>
                  <option value="">Any category</option>
                  {(categories ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
          </div>
          {wheelRuleText(w, categories ?? []) ? <p className="small">A sale spins when they <b>{wheelRuleText(w, categories ?? []).toLowerCase()}</b>.</p> : null}

          <h3>Prizes</h3>
          {w.prizes.length === 0 ? <p className="muted small">No prizes yet: every spin is “Try again”. Add the first one.</p> : null}
          <div className="stack">
            {w.prizes.map((p) => (
              <div key={p.id} className="wheel-prize">
                <div className="form-grid">
                  <Field label="Prize" htmlFor={`wp-${p.id}-label`}>
                    <TextInput id={`wp-${p.id}-label`} value={p.label} onChange={(e) => setPrize(p.id, { label: e.target.value })} placeholder="e.g. Free Couple Pack" />
                  </Field>
                  <Field label="It is" htmlFor={`wp-${p.id}-kind`}>
                    <Segmented<WheelPrize['kind']>
                      label="Prize kind"
                      value={p.kind}
                      onChange={(kind) => setPrize(p.id, { kind })}
                      options={[
                        { value: 'item', label: 'A free product' },
                        { value: 'voucher', label: 'A discount code' },
                      ]}
                    />
                  </Field>
                  {p.kind === 'item' ? (
                    <Field label="Product" htmlFor={`wp-${p.id}-product`} hint="Handed over free; it comes out of stock.">
                      <Select id={`wp-${p.id}-product`} value={p.productId ?? ''} onChange={(e) => setPrize(p.id, { productId: e.target.value || null })}>
                        <option value="">Pick a product…</option>
                        {(products ?? []).map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  ) : (
                    <Field label="Off their next purchase at this event" htmlFor={`wp-${p.id}-off`}>
                      <div className="row">
                        <Segmented<'amount' | 'percent'>
                          label="Discount kind"
                          value={p.voucher?.kind ?? 'amount'}
                          onChange={(kind) => setPrize(p.id, { voucher: { kind, value: kind === 'percent' ? 10 : 2000 } })}
                          options={[
                            { value: 'amount', label: '₱' },
                            { value: 'percent', label: '%' },
                          ]}
                        />
                        {p.voucher?.kind === 'percent' ? (
                          <NumberInput id={`wp-${p.id}-off`} min={1} value={p.voucher.value} onChange={(n) => setPrize(p.id, { voucher: { kind: 'percent', value: Math.round(n ?? 0) } })} suffix="%" />
                        ) : (
                          <MoneyInput id={`wp-${p.id}-off`} value={p.voucher?.value ?? null} onChange={(c) => setPrize(p.id, { voucher: { kind: 'amount', value: c ?? 0 } })} />
                        )}
                      </div>
                    </Field>
                  )}
                  <Field label="Chance" htmlFor={`wp-${p.id}-chance`}>
                    <NumberInput id={`wp-${p.id}-chance`} min={0} value={p.chance} onChange={(n) => setPrize(p.id, { chance: Math.max(0, n ?? 0) })} suffix="%" />
                  </Field>
                  <Field label="Most a day" htmlFor={`wp-${p.id}-day`} hint={`${wins.get(p.id) ?? 0} won today.${p.perDay ? '' : ' Empty: no limit.'}`}>
                    <NumberInput id={`wp-${p.id}-day`} decimals={false} min={1} value={p.perDay} onChange={(n) => setPrize(p.id, { perDay: n && n > 0 ? Math.round(n) : null })} placeholder="No limit" />
                  </Field>
                </div>
                <div className="row between">
                  {p.perDay && (wins.get(p.id) ?? 0) >= p.perDay ? <Badge tone="warn">All given out today</Badge> : <span />}
                  <IconButton label={`Remove ${p.label || 'this prize'}`} size="sm" onClick={() => setW({ ...w, prizes: w.prizes.filter((x) => x.id !== p.id) })}>
                    <Trash2 size={15} />
                  </IconButton>
                </div>
              </div>
            ))}
          </div>
          <div className="row between wrap">
            <Button size="sm" onClick={() => setW({ ...w, prizes: [...w.prizes, blankPrize()] })}>
              <Plus size={15} /> Add a prize
            </Button>
            <span className="small">
              Try again: <b>{tryAgainChance(w)}%</b>
            </span>
          </div>
          {problem && w.on ? <Callout tone="bad">{problem}</Callout> : null}
          <div className="row">
            <Button variant="primary" onClick={() => void save()} disabled={busy || !dirty}>
              Save the wheel
            </Button>
          </div>
        </div>
        <div className="card stack wheel-preview">
          <h3>How it looks</h3>
          <WheelSvg slices={slices} className="wheel-svg" />
          <p className="muted small">Each slice is as wide as its chance, so the wheel shows the real odds.</p>
        </div>
      </div>
    </div>
  );
}
