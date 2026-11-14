import { useMemo } from 'react';
import { useApp } from '../../app/AppContext';
import { setSetting, settingValue } from '../../db/settings';
import { useProducts, useSettingRows } from '../../hooks/data';
import { Segmented } from '../../components/ui';
import { Check, Field, NumberInput, Select, TextInput } from '../../components/form';
import { DEFAULT_STICK, ENJOY, PACK_CODES, PACK_NAME, guessPack, packOf, type PackCode, type StickSettings } from '../../domain/stick';

/**
 * Settings → Couple-of-Stickers: which products are packs (most are known by
 * their names), how long a pack takes, how many make them at once, and the
 * stubs' paper. Shared by every device.
 */
export function StickSection() {
  const app = useApp();
  const rows = useSettingRows();
  const products = useProducts();
  const s: StickSettings = { ...DEFAULT_STICK, ...settingValue<Partial<StickSettings>>(rows, 'stick') };
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
