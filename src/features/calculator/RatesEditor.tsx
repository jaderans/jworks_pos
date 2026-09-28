import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { useSettingRows } from '../../hooks/data';
import { SHEET_CALC_SETTINGS, setSetting, settingValue } from '../../db/settings';
import { Button, IconButton, Toggle } from '../../components/ui';
import { Field, MoneyInput, NumberInput, TextInput } from '../../components/form';
import type { CalcSettings } from '../../db/types';

export function RatesEditor() {
  const app = useApp();
  const settingRows = useSettingRows();
  const saved = settingValue<CalcSettings>(settingRows, 'calc');
  const [f, setF] = useState<CalcSettings>(saved);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) setF(saved);
  }, [settingRows]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (changes: Partial<CalcSettings>) => {
    setF({ ...f, ...changes });
    setDirty(true);
  };
  const save = async () => {
    await setSetting('calc', f);
    setDirty(false);
    app.toast('Rates saved', { tone: 'good' });
  };

  return (
    <div className="stack loose">
      <div className="card">
        <h2>Business defaults</h2>
        <div className="form-grid">
          <Field label="Overhead (% of direct cost)" htmlFor="rt-over" hint="Rent, internet, software, electricity, wear. 20–30% is normal for a small studio.">
            <NumberInput id="rt-over" value={f.overheadPct} onChange={(n) => set({ overheadPct: n ?? 0 })} suffix="%" />
          </Field>
          <Field label="Minimum acceptable margin" htmlFor="rt-min" hint="Below this the calculator turns red. Your walk-away line.">
            <NumberInput id="rt-min" value={f.minMarginPct} onChange={(n) => set({ minMarginPct: n ?? 0 })} suffix="%" />
          </Field>
          <Field label="Default target margin" htmlFor="rt-margin">
            <NumberInput id="rt-margin" value={f.targetMarginPct} onChange={(n) => set({ targetMarginPct: n ?? 0 })} suffix="%" />
          </Field>
          <Field label="Default markup on cost" htmlFor="rt-markup">
            <NumberInput id="rt-markup" value={f.markupPct} onChange={(n) => set({ markupPct: n ?? 0 })} suffix="%" />
          </Field>
          <Field label="Round prices up to the nearest" htmlFor="rt-round">
            <NumberInput id="rt-round" value={f.roundTo} onChange={(n) => set({ roundTo: Math.max(1, n ?? 1) })} prefix="₱" />
          </Field>
          <div className="field" style={{ alignContent: 'end' }}>
            <Toggle id="rt-vat" checked={f.vatRegistered} onChange={(v) => set({ vatRegistered: v })} label="VAT-registered" />
          </div>
          <Field label="VAT rate" htmlFor="rt-vatpct">
            <NumberInput id="rt-vatpct" value={f.vatPct} onChange={(n) => set({ vatPct: n ?? 0 })} suffix="%" />
          </Field>
          <Field label="Expanded withholding tax (EWT)" htmlFor="rt-ewt">
            <NumberInput id="rt-ewt" value={f.ewtPct} onChange={(n) => set({ ewtPct: n ?? 0 })} suffix="%" />
          </Field>
        </div>
      </div>
      <div className="card">
        <h2>Add-on rates</h2>
        <div className="form-grid">
          <Field label="Rush fee" htmlFor="rt-rush" hint="Delivery inside the normal turnaround.">
            <NumberInput id="rt-rush" value={f.addons.rush} onChange={(n) => set({ addons: { ...f.addons, rush: n ?? 0 } })} suffix="%" />
          </Field>
          <Field label="Extra revision round" htmlFor="rt-rev">
            <NumberInput id="rt-rev" value={f.addons.revision} onChange={(n) => set({ addons: { ...f.addons, revision: n ?? 0 } })} suffix="%" />
          </Field>
          <Field label="Source files" htmlFor="rt-src" hint="Editable AI/PSD/INDD handover.">
            <NumberInput id="rt-src" value={f.addons.sourceFiles} onChange={(n) => set({ addons: { ...f.addons, sourceFiles: n ?? 0 } })} suffix="%" />
          </Field>
          <Field label="Full IP buy-out" htmlFor="rt-ip" hint="The client owns the work and you can't show it.">
            <NumberInput id="rt-ip" value={f.addons.ipBuyout} onChange={(n) => set({ addons: { ...f.addons, ipBuyout: n ?? 0 } })} suffix="%" />
          </Field>
        </div>
      </div>
      <div className="card">
        <div className="card-head">
          <h2>Labor rates per hour</h2>
          <Button size="sm" onClick={() => set({ roles: [...f.roles, { name: 'New role', rate: 0, covers: '' }] })}>
            <Plus size={16} /> Add role
          </Button>
        </div>
        {f.roles.map((r, i) => (
          <div key={i} className="row wrap">
            <TextInput aria-label="Role" value={r.name} onChange={(e) => set({ roles: f.roles.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)) })} style={{ flex: 1, minWidth: 170 }} />
            <div style={{ width: 150 }}>
              <MoneyInput ariaLabel={`Rate for ${r.name}`} value={r.rate} onChange={(c) => set({ roles: f.roles.map((x, k) => (k === i ? { ...x, rate: c ?? 0 } : x)) })} />
            </div>
            <TextInput aria-label="What it covers" value={r.covers} placeholder="What this covers" onChange={(e) => set({ roles: f.roles.map((x, k) => (k === i ? { ...x, covers: e.target.value } : x)) })} style={{ flex: 2, minWidth: 200 }} />
            <IconButton label={`Remove ${r.name}`} size="sm" onClick={() => set({ roles: f.roles.filter((_, k) => k !== i) })}>
              <Trash2 size={16} />
            </IconButton>
          </div>
        ))}
        <p className="sub">Raise these as the studio&rsquo;s reputation grows.</p>
      </div>
      <div className="card">
        <h2>Job categories</h2>
        <TextInput aria-label="Categories, one per line" value={f.categories.join(', ')} onChange={(e) => set({ categories: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
        <p className="sub">Separate with commas.</p>
      </div>
      <div className="actions">
        <Button variant="primary" onClick={save} disabled={!dirty}>
          Save rates
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setF(SHEET_CALC_SETTINGS);
            setDirty(true);
          }}
        >
          Reset to the old sheet&rsquo;s rates
        </Button>
      </div>
    </div>
  );
}
