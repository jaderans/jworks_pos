import { useMemo, useState } from 'react';
import { Plus, RotateCcw } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { setSetting, settingValue } from '../../db/settings';
import { useCategories, useOrders, useProducts, useSettingRows } from '../../hooks/data';
import { Button, Segmented } from '../../components/ui';
import { createCategory, createProduct, updateProduct } from '../../services/catalog';
import { setStubStart } from '../../services/stick';
import { Check, Field, NumberInput, Select, TextInput } from '../../components/form';
import { DEFAULT_STICK, ENJOY, PACK_CODES, PACK_NAME, guessPack, isAddOnCategory, nextStubNumber, packOf, type PackCode, type StickSettings } from '../../domain/stick';

/**
 * Settings → Couple-of-Stickers: which products are packs (most are known by
 * their names), how long a pack takes, how many make them at once, and the
 * stubs' paper. Shared by every device.
 */
export function StickSection() {
  const app = useApp();
  const rows = useSettingRows();
  const s: StickSettings = { ...DEFAULT_STICK, ...settingValue<Partial<StickSettings>>(rows, 'stick') };
  const products = useProducts();
  const categories = useCategories();
  const orders = useOrders();
  const ev = app.activeEvent;
  // The stubs at this event: the next number, and where they start.
  const taken = (orders ?? []).filter((o) => o.stick && o.eventId === ev?.id).map((o) => o.number);
  const startAt = ev ? (s.startAt?.[ev.id] ?? 1) : 1;
  const next = nextStubNumber(taken, { startAt, letter: s.numbers === 'letter' ? app.device.letter : null });
  const [start, setStart] = useState<number | null>(null);
  const addOnCat = (categories ?? []).find((c) => isAddOnCategory(c.name));
  const addOnProducts = (products ?? []).filter((p) => p.categoryId && p.categoryId === addOnCat?.id);
  const find = (word: RegExp) => addOnProducts.find((p) => word.test(p.name));
  /** On sale as an add-on (one that's turned off, like the starter Keychain conversion, doesn't count). */
  const has = (word: RegExp) => find(word)?.active === 1;
  /** Keychain and Pin add-ons, in the Add-on category, priced by the owner in Products and Edit prices. */
  const addKeychainPin = async () => {
    const cat = addOnCat ?? (await createCategory('Add-on'));
    // One already there but turned off: turn it on, rather than make a second.
    for (const [word, name] of [
      [/keychain/i, 'Keychain (add-on)'],
      [/\bpins?\b/i, 'Pin (add-on)'],
    ] as const) {
      const p = find(word);
      if (p && p.active !== 1) await updateProduct(p.id, { active: 1 });
      else if (!p) await createProduct({ name, categoryId: cat.id, trackStock: 0, price: null });
    }
    app.toast('Keychain and Pin add-ons are on. Give them a price in Products, and at each event in Edit prices.', { tone: 'good' });
  };
  // Saved as it changes, for every device.
  const set = (ch: Partial<StickSettings>) => void setSetting('stick', { ...s, ...ch }).catch((e: unknown) => app.toast(e instanceof Error ? e.message : 'Couldn’t save it', { tone: 'bad' }));
  // Packs first: those set here, or that look like one by name.
  const list = useMemo(
    () => (products ?? []).filter((p) => s.packs[p.id] || guessPack(p.name)).concat((products ?? []).filter((p) => !s.packs[p.id] && !guessPack(p.name))),
    [products, rows], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const setPack = (id: string, v: { pack: PackCode | null; singles: boolean }) => set({ packs: { ...s.packs, [id]: v } });
  return (
    <section id="s-stick" className="card pad-lg stack" style={{ scrollMarginTop: 80 }}>
      <h2>Couple-of-Stickers</h2>
      <p className="sub">
        After a pack is paid for, the register asks for their name, how each pack is made and the mini stickers, makes the order on Orders with one number, and prints the claim stub and the information
        stub. The stubs say when it should be ready and “{ENJOY}”
      </p>
      <div className="form-grid">
        <Field label="Minutes to print a pack" htmlFor="st-min-print">
          <NumberInput id="st-min-print" decimals={false} min={1} value={s.minutes.printing} onChange={(n) => set({ minutes: { ...s.minutes, printing: Math.max(1, Math.round(n ?? 20)) } })} suffix="min" />
        </Field>
        <Field label="Minutes to illustrate a pack" htmlFor="st-min-art">
          <NumberInput id="st-min-art" decimals={false} min={1} value={s.minutes.illustrating} onChange={(n) => set({ minutes: { ...s.minutes, illustrating: Math.max(1, Math.round(n ?? 30)) } })} suffix="min" />
        </Field>
        <Field label="Minutes each add-on adds" htmlFor="st-min-addon" hint="Making it a keychain or a pin.">
          <NumberInput id="st-min-addon" decimals={false} min={0} value={s.addOnMinutes} onChange={(n) => set({ addOnMinutes: Math.max(0, Math.round(n ?? 5)) })} suffix="min" />
        </Field>
        <Field label="People making stickers" htmlFor="st-makers" hint="Orders in line are shared among them.">
          <NumberInput id="st-makers" decimals={false} min={1} value={s.makers} onChange={(n) => set({ makers: Math.max(1, Math.round(n ?? 1)) })} />
        </Field>
        <Field label="Design numbers start with" htmlFor="st-prefix" hint="CS01, CS02… the names of the design files in Drive.">
          <TextInput id="st-prefix" value={s.designPrefix} onChange={(e) => set({ designPrefix: e.target.value.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 4) || 'CS' })} />
        </Field>
      </div>
      <Field label="Stub paper" htmlFor="st-paper" hint="The printer and paper are picked in the print window.">
        <Segmented<StickSettings['stubPaper']>
          label="Stub paper"
          value={s.stubPaper}
          onChange={(stubPaper) => set({ stubPaper })}
          options={[
            { value: 'sheet', label: 'A4 or Letter (cut)' },
            { value: 'r80', label: '80 mm receipt' },
            { value: 'r58', label: '58 mm receipt' },
          ]}
        />
      </Field>
      <div className="stack tight" role="group" aria-label="Stub numbers">
        <b>Stub numbers</b>
        <Segmented<StickSettings['numbers']>
          label="Stub number style"
          value={s.numbers}
          onChange={(numbers) => set({ numbers })}
          options={[
            { value: 'plain', label: '01, 02… (one register)' },
            { value: 'letter', label: 'A-01, B-01… (several registers)' },
          ]}
        />
        {ev ? (
          <>
            <p className="small" role="status">
              At {ev.name}, the next stub is <b>{next}</b>. Numbers follow the last Couple-of-Stickers order still on Orders: delete test orders and they go back down.
            </p>
            <div className="row wrap" style={{ alignItems: 'flex-end' }}>
              <Field label="Start the next stub at" htmlFor="st-start" hint="To follow on from pre-printed stubs.">
                <NumberInput id="st-start" decimals={false} min={1} value={start ?? startAt} onChange={(n) => setStart(n ?? null)} />
              </Field>
              <Button size="sm" onClick={() => void setStubStart(ev.id, start ?? startAt).then(() => app.toast('Saved', { tone: 'good' }))}>
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  void setStubStart(ev.id, 1).then(() => {
                    setStart(1);
                    app.toast(taken.length ? `Back to 01 once the ${taken.length} order${taken.length === 1 ? '' : 's'} on Orders are deleted.` : 'The next stub is 01.', { tone: 'good' });
                  })
                }
              >
                <RotateCcw size={15} /> Reset to 01
              </Button>
            </div>
          </>
        ) : (
          <p className="muted small">Pick an event at the top to see its stub numbers.</p>
        )}
      </div>
      <div className="stack tight">
        <b>Add-ons</b>
        <p className="muted small">
          Products in your Add-on category ({addOnProducts.length ? addOnProducts.map((p) => p.name).join(', ') : 'none yet'}) are add-ons: sold with a pack, they go on that pack’s information stub, and making it a keychain or a pin adds {s.addOnMinutes} minutes.
        </p>
        {!has(/keychain/i) || !has(/\bpins?\b/i) ? (
          <div>
            <Button size="sm" onClick={() => void addKeychainPin()}>
              <Plus size={15} /> Add Keychain and Pin add-ons
            </Button>
          </div>
        ) : null}
      </div>
      <div className="stack tight">
        <b>Which products are packs</b>
        <p className="muted small">Solo, Couple and Barkada products are found by their names; “Singles” in the name means singles. Change any here.</p>
        <div className="card flush">
          <div className="list">
            {list.map((p) => {
              const k = packOf(p, s);
              return (
                <div key={p.id} className="list-item">
                  <span className="main-text">
                    <b>{p.name}</b>
                    <span>{k ? `${PACK_NAME[k.pack]}${k.singles ? ', singles' : ''}` : 'Not a pack'}</span>
                  </span>
                  <Select aria-label={`Pack for ${p.name}`} value={k?.pack ?? ''} onChange={(e) => setPack(p.id, { pack: (e.target.value || null) as PackCode | null, singles: k?.singles ?? false })} style={{ width: 'auto' }}>
                    <option value="">Not a pack</option>
                    {PACK_CODES.map((c) => (
                      <option key={c} value={c}>
                        {c} · {PACK_NAME[c]}
                      </option>
                    ))}
                  </Select>
                  {k ? <Check id={`st-single-${p.id}`} checked={k.singles} onChange={(v) => setPack(p.id, { pack: k.pack, singles: v })} label="Singles" /> : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
