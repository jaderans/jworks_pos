import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { useCategories, useProducts, useSales, useSettingRows } from '../../hooks/data';
import { settingValue } from '../../db/settings';
import { peso } from '../../lib/money';
import { Badge, Button, Callout, IconButton, Segmented, Toggle } from '../../components/ui';
import { Field, MoneyInput, NumberInput, Select, TextInput } from '../../components/form';
import { uid } from '../../lib/ids';
import { updateEvent } from '../../services/events';
import { BLANK_WHEEL, MAX_SPINS, ONE_SPIN, pickText, tryAgainChance, wheelProblem, wheelRuleText, wheelSlices, winsToday, type SavedWheel, type WheelConfig, type WheelPrize } from '../../domain/wheel';
import { setSetting } from '../../db/settings';
import { WheelSvg } from '../display/WheelSvg';
import type { JWEvent, PrintRates } from '../../db/types';

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
  const settingRows = useSettingRows();
  const rates = settingValue<PrintRates>(settingRows, 'printRates');
  const saved = settingValue<{ list: SavedWheel[] }>(settingRows, 'wheels').list ?? [];
  const [saveName, setSaveName] = useState('');
  /** Keep this wheel to use at other events; the same name is replaced. */
  const keep = async () => {
    const name = saveName.trim() || ev.name;
    const { on: _on, ...wheel } = w;
    const old = saved.find((x) => x.name.toLowerCase() === name.toLowerCase());
    const entry: SavedWheel = { id: old?.id ?? uid(), name, wheel, savedAt: Date.now() };
    await setSetting('wheels', { list: [entry, ...saved.filter((x) => x.id !== entry.id)] });
    setSaveName('');
    app.toast(`“${name}” saved. Use it at any event from here.`, { tone: 'good' });
  };
  const useSaved = async (x: SavedWheel) => {
    if (dirty && !(await app.confirm({ title: `Use “${x.name}”?`, message: 'The prizes and rules here are replaced by the saved wheel’s. Save the wheel after to keep it at this event.', confirmLabel: 'Use it' }))) return;
    setW({ ...x.wheel, on: w.on });
    app.toast(`“${x.name}” loaded. Check it, then Save the wheel.`, { tone: 'good' });
  };
  const forget = async (x: SavedWheel) => {
    if (!(await app.confirm({ title: `Delete “${x.name}”?`, message: 'It comes off the saved wheels. Events already using it keep their wheel.', confirmLabel: 'Delete', tone: 'danger' }))) return;
    await setSetting('wheels', { list: saved.filter((y) => y.id !== x.id) });
  };
  // Services from the rate card to pick from; any other can be typed.
  const services = rates.illustration.tiers.map((t) => ({ label: `Sticker illustration, ${t.name.toLowerCase()} (1 design)`, value: t.price }));
  const [w, setW] = useState<WheelConfig>(ev.wheel ?? BLANK_WHEEL);
  const [busy, setBusy] = useState(false);
  useEffect(() => setW(ev.wheel ?? BLANK_WHEEL), [ev.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const wins = useMemo(() => winsToday(sales ?? []), [sales]);
  const dirty = JSON.stringify(w) !== JSON.stringify(ev.wheel ?? BLANK_WHEEL);
  const problem = wheelProblem(w);
  const spins = w.spins ?? ONE_SPIN;
  const slices = wheelSlices(w);
  const setPrize = (id: string, ch: Partial<WheelPrize>) => setW({ ...w, prizes: w.prizes.map((p) => (p.id === id ? { ...p, ...ch } : p)) });

  const save = async () => {
    if (problem && w.on) return app.toast(problem, { tone: 'bad' });
    setBusy(true);
    await updateEvent(ev.id, { wheel: { ...w, prizes: w.prizes.map((p) => ({ ...p, label: p.label.trim() })) } });
    setBusy(false);
    app.toast(w.on ? 'Prize wheel saved. Qualifying sales can spin now.' : 'Prize wheel saved (off).', { tone: 'good' });
  };
  /** The look only changes how it's drawn, never the odds, so it saves at once: the customer screen follows. */
  const setLook = async (look: 'chance' | 'equal') => {
    setW({ ...w, look });
    await updateEvent(ev.id, { wheel: { ...(ev.wheel ?? BLANK_WHEEL), look } });
    app.toast(look === 'equal' ? 'Same-size slices on the customer screen now.' : 'Slices as wide as their chance on the customer screen now.', { tone: 'good' });
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
          <p className="sub">After a sale that qualifies, the cashier taps Spin on the receipt and the wheel spins on the customer screen, as many times as the sale earned.</p>

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

          <h3>How many spins</h3>
          <Segmented<'sale' | 'mark'>
            label="Spins"
            value={spins.per}
            onChange={(per) => setW({ ...w, spins: { per, count: per === 'mark' ? Math.max(2, spins.count) : 1 } })}
            options={[
              { value: 'sale', label: 'A set number a sale' },
              { value: 'mark', label: 'One for every mark reached' },
            ]}
            full
          />
          <div className="form-grid">
            <Field
              label={spins.per === 'mark' ? 'Most spins on one sale' : 'Spins a sale'}
              htmlFor="wh-spins"
              hint={
                spins.per === 'mark'
                  ? `${[w.minSpend ? `${peso(w.minSpend * 2)} spins twice` : '', w.minItems ? `${w.minItems.count * 2} items spin twice` : ''].filter(Boolean).join(', ')}, and so on, up to this many.`
                  : 'Every sale that qualifies gets this many spins.'
              }
            >
              <NumberInput id="wh-spins" decimals={false} min={1} value={spins.count} onChange={(n) => setW({ ...w, spins: { per: spins.per, count: Math.min(MAX_SPINS, Math.max(1, Math.round(n ?? 1))) } })} suffix={spins.count === 1 ? 'spin' : 'spins'} />
            </Field>
          </div>
          <p className="muted small">Landing on a free spin (a prize that is “Another spin”) adds one more on top.</p>

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
                    <Select
                      id={`wp-${p.id}-kind`}
                      value={p.kind}
                      onChange={(e) => {
                        const kind = e.target.value as WheelPrize['kind'];
                        const named = p.label.trim() ? {} : kind === 'pick' ? { label: 'Free sticker' } : kind === 'spin' ? { label: 'Free spin' } : {};
                        setPrize(p.id, { kind, ...named, ...(kind === 'pick' && !p.pick ? { pick: { count: 1, what: 'sticker' } } : {}) });
                      }}
                    >
                      <option value="item">A free product (out of stock)</option>
                      <option value="pick">A free pick from a prize pile</option>
                      <option value="service">A free service</option>
                      <option value="voucher">A discount code</option>
                      <option value="spin">Another spin</option>
                    </Select>
                  </Field>
                  {p.kind === 'pick' ? (
                    <>
                      <Field label="They pick" htmlFor={`wp-${p.id}-count`} hint={`They choose ${pickText(p)} from a pile you set aside for prizes, any design. Nothing comes off a product’s stock; the Sales log shows the win.`}>
                        <NumberInput id={`wp-${p.id}-count`} decimals={false} min={1} value={p.pick?.count ?? 1} onChange={(n) => setPrize(p.id, { pick: { count: n && n > 0 ? Math.round(n) : 1, what: p.pick?.what ?? 'sticker' } })} />
                      </Field>
                      <Field label="Of" htmlFor={`wp-${p.id}-what`}>
                        <TextInput id={`wp-${p.id}-what`} value={p.pick?.what ?? 'sticker'} onChange={(e) => setPrize(p.id, { pick: { count: p.pick?.count ?? 1, what: e.target.value } })} placeholder="sticker" />
                      </Field>
                    </>
                  ) : p.kind === 'spin' ? (
                    <p className="muted small">Landing on it gives them one more spin, on top of the spins their sale earned.</p>
                  ) : p.kind === 'item' ? (
                    <Field
                      label="Product"
                      htmlFor={`wp-${p.id}-product`}
                      hint={(() => {
                        const picked = (products ?? []).find((x) => x.id === p.productId);
                        if (picked && picked.trackStock !== 1) return `${picked.name} has no stock count, so only this event’s sold count goes up. Turn on Track stock on the product to take it out of the studio stock too.`;
                        return 'Handed over free as a ₱0 sale: it comes out of stock, and the Sales log shows it as a wheel prize.';
                      })()}
                    >
                      <Select id={`wp-${p.id}-product`} value={p.productId ?? ''} onChange={(e) => setPrize(p.id, { productId: e.target.value || null })}>
                        <option value="">Pick a product…</option>
                        {(products ?? []).map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name}
                            {x.trackStock === 1 ? '' : ' (no stock count)'}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  ) : p.kind === 'service' ? (
                    <>
                      <Field label="Service" htmlFor={`wp-${p.id}-service`} hint="It goes on Services as a free order to make, and in the Sales log as a wheel prize.">
                        <TextInput
                          id={`wp-${p.id}-service`}
                          list="wp-services"
                          value={p.service?.label ?? ''}
                          placeholder="e.g. Sticker illustration, simple (1 design)"
                          onChange={(e) => {
                            const label = e.target.value;
                            const preset = services.find((x) => x.label === label);
                            setPrize(p.id, { service: { label, value: preset ? preset.value : (p.service?.value ?? 0) } });
                          }}
                        />
                      </Field>
                      <Field label="Worth" htmlFor={`wp-${p.id}-worth`} hint="What it would cost. It’s free for them.">
                        <MoneyInput id={`wp-${p.id}-worth`} value={p.service?.value ?? null} onChange={(c) => setPrize(p.id, { service: { label: p.service?.label ?? '', value: c ?? 0 } })} />
                      </Field>
                    </>
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
                          <NumberInput id={`wp-${p.id}-off`} min={1} value={p.voucher.value} onChange={(n) => setPrize(p.id, { voucher: { kind: 'percent', value: Math.round(n ?? 0), minSpend: p.voucher?.minSpend } })} suffix="%" />
                        ) : (
                          <MoneyInput id={`wp-${p.id}-off`} value={p.voucher?.value ?? null} onChange={(c) => setPrize(p.id, { voucher: { kind: 'amount', value: c ?? 0, minSpend: p.voucher?.minSpend } })} />
                        )}
                      </div>
                    </Field>
                  )}
                  {p.kind === 'voucher' ? (
                    <Field label="On a purchase of at least" htmlFor={`wp-${p.id}-min`} hint="So a discount can’t turn into a free item. Empty: any purchase.">
                      <MoneyInput id={`wp-${p.id}-min`} value={p.voucher?.minSpend || null} onChange={(c) => setPrize(p.id, { voucher: { kind: p.voucher?.kind ?? 'amount', value: p.voucher?.value ?? 0, minSpend: c ?? 0 } })} />
                    </Field>
                  ) : null}
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
          <datalist id="wp-services">
            {services.map((x) => (
              <option key={x.label} value={x.label}>
                {peso(x.value)}
              </option>
            ))}
          </datalist>
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
            {dirty ? <span className="muted small">Not saved yet: the register and customer screen use the saved wheel.</span> : null}
          </div>
        </div>
        <div className="card stack wheel-preview">
          <h3>How it looks</h3>
          <Segmented<'chance' | 'equal'>
            label="Slices"
            value={w.look ?? 'chance'}
            onChange={(look) => void setLook(look)}
            options={[
              { value: 'chance', label: 'As wide as their chance' },
              { value: 'equal', label: 'All the same size' },
            ]}
            full
          />
          <WheelSvg slices={slices} className="wheel-svg" />
          <p className="muted small">
            {w.look === 'equal'
              ? 'Every slice the same size, so the names are easy to read. The chances you set still decide where it stops.'
              : 'Each slice is as wide as its chance, so the wheel shows the real odds.'}
          </p>
        </div>
        <div className="card stack" role="group" aria-label="Saved wheels">
          <h3>Saved wheels</h3>
          <p className="muted small">Keep this wheel (its prizes, chances, rules and look) to use again at another event.</p>
          <div className="row wrap" style={{ alignItems: 'flex-end' }}>
            <Field label="Save it as" htmlFor="wh-save-name" className="grow">
              <TextInput id="wh-save-name" value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder={ev.name} />
            </Field>
            <Button onClick={() => void keep()} disabled={!w.prizes.length}>
              Save for other events
            </Button>
          </div>
          {saved.length ? (
            <div className="list">
              {saved.map((x) => (
                <div key={x.id} className="list-item">
                  <span className="main-text">
                    <b>{x.name}</b>
                    <span>
                      {x.wheel.prizes.length} prize{x.wheel.prizes.length === 1 ? '' : 's'}
                      {x.wheel.look === 'equal' ? ' · same-size slices' : ''}
                    </span>
                  </span>
                  <Button size="sm" onClick={() => void useSaved(x)}>
                    Use here
                  </Button>
                  <IconButton label={`Delete ${x.name}`} size="sm" plain onClick={() => void forget(x)}>
                    <Trash2 size={15} />
                  </IconButton>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted small">No saved wheels yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
