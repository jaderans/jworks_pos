import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Camera, Image as ImageIcon, Pencil, Plus, Trash2 } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { useEventData } from './useEventData';
import { useMaterials } from '../../hooks/data';
import { db } from '../../db/db';
import { Dialog } from '../../components/Dialog';
import { Badge, Button, Callout, IconButton, Loading, Stat } from '../../components/ui';
import { Check, Field, MoneyInput, NumberInput, Select, TextArea, TextInput } from '../../components/form';
import { peso, sum, type Cents } from '../../lib/money';
import { deleteSpend, saveSpend, savePhoto, setReimbursed, setSpendStatus, SPEND_STATUS_LABEL, SPEND_TYPE_HINT, SPEND_TYPE_LABEL } from '../../services/spend';
import type { JWEvent, SpendItem, SpendStatus, SpendType } from '../../db/types';

const TYPES: SpendType[] = ['booth_fee', 'consumable', 'asset', 'material'];

export default function SpendTab({ ev }: { ev: JWEvent }) {
  const app = useApp();
  const d = useEventData(ev);
  const [editing, setEditing] = useState<Partial<SpendItem> | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);

  const byType = useMemo(() => {
    const m = new Map<SpendType, SpendItem[]>();
    for (const t of TYPES) m.set(t, []);
    for (const s of d.spend) m.get(s.type)?.push(s);
    return m;
  }, [d.spend]);

  if (d.loading) return <Loading />;
  const c = d.share.costs;
  const line = (s: SpendItem) => Math.round(s.qty * s.unitCost);
  const owed = d.spend.filter((s) => s.paidBy && s.status === 'bought' && s.reimbursed !== 1);
  const owedBy = new Map<string, Cents>();
  for (const s of owed) owedBy.set(s.paidBy!, (owedBy.get(s.paidBy!) ?? 0) + line(s));
  const boughtTotal = sum(d.spend.filter((s) => s.status === 'bought').map(line));

  return (
    <div className="stack loose">
      <div className="row between wrap">
        <p className="muted" style={{ maxWidth: '70ch' }}>
          Everything {ev.name} cost. Only items marked <b>Bought</b> count. Materials go into stock and reach the event through the production cost of what sells, so they aren&rsquo;t counted twice.
        </p>
        <Button variant="primary" onClick={() => setEditing({ type: 'consumable', status: 'to_buy', qty: 1 })}>
          <Plus size={18} /> Add spend
        </Button>
      </div>

      <div className="stats">
        <Stat label="Counted against the event" value={peso(c.total)} hint={ev.share.poolMode === 'supplies' ? 'Booth fee, used up, assets, materials used' : 'Booth fee + used up + assets’ share'} />
        <Stat label="Booth fee" value={peso(c.boothFee)} />
        <Stat label="Used up at the event" value={peso(c.consumables)} />
        <Stat label="Reusable assets (this event’s share)" value={peso(c.assets)} />
        <Stat label="Materials to stock" value={peso(c.materialsBought)} hint="Counted when products sell" />
        <Stat label="Still to buy" value={peso(c.planned)} hint={`${peso(boughtTotal)} bought so far`} />
      </div>

      {owedBy.size ? (
        <Callout tone="warn" title="To reimburse">
          {[...owedBy.entries()].map(([id, amt]) => `${d.memberMap.get(id)?.name ?? 'Someone'} ${peso(amt)}`).join(' · ')}
        </Callout>
      ) : null}

      {TYPES.map((t) => {
        const items = byType.get(t) ?? [];
        return (
          <section key={t} className="stack tight">
            <div className="row between wrap">
              <div>
                <h2>{SPEND_TYPE_LABEL[t]}</h2>
                <p className="muted small">{SPEND_TYPE_HINT[t]}</p>
              </div>
              <Button size="sm" onClick={() => setEditing({ type: t, status: t === 'booth_fee' ? 'bought' : 'to_buy', qty: 1, name: t === 'booth_fee' ? 'Booth fee' : '' })}>
                <Plus size={16} /> Add
              </Button>
            </div>
            {items.length ? (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th className="r">Qty × cost</th>
                      <th className="r">Total</th>
                      <th>Status</th>
                      <th className="hide-phone">Paid by</th>
                      <th className="r"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((s) => (
                      <tr key={s.id} className={s.status === 'not_needed' ? 'muted' : ''}>
                        <td>
                          <b>{s.name}</b>
                          <div className="muted tiny">
                            {t === 'asset' ? `Spread over ${s.amortizeEvents} events · ${peso(Math.round(line(s) / Math.max(1, s.amortizeEvents)))} here` : null}
                            {t === 'material' && s.materialId ? `Restocks the materials list${s.stocked ? ' (added)' : ''}` : null}
                            {t === 'material' && ev.share.poolMode === 'supplies' ? ` · ${s.pctUsed}% used` : null}
                            {s.notes ? ` ${s.notes}` : ''}
                          </div>
                        </td>
                        <td className="r">
                          {s.qty} × {peso(s.unitCost)}
                        </td>
                        <td className="r strong">{peso(line(s))}</td>
                        <td>
                          <select className="select" style={{ minHeight: 36, width: 'auto' }} aria-label={`Status of ${s.name}`} value={s.status} onChange={(e) => setSpendStatus(s.id, e.target.value as SpendStatus)}>
                            {(['to_buy', 'bought', 'not_needed'] as SpendStatus[]).map((st) => (
                              <option key={st} value={st}>
                                {SPEND_STATUS_LABEL[st]}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="hide-phone">
                          {s.paidBy ? (
                            <label className="check" htmlFor={`reimb-${s.id}`}>
                              <input id={`reimb-${s.id}`} type="checkbox" checked={s.reimbursed === 1} onChange={(e) => setReimbursed(s.id, e.target.checked)} />
                              <span className="small">
                                {d.memberMap.get(s.paidBy)?.name ?? 'Member'}
                                <span className="sub">{s.reimbursed ? 'Paid back' : 'To pay back'}</span>
                              </span>
                            </label>
                          ) : (
                            <span className="muted small">JoshWorks funds</span>
                          )}
                        </td>
                        <td className="r">
                          <div className="actions" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                            {s.photoId ? (
                              <IconButton label="See receipt photo" size="sm" onClick={() => setPhoto(s.photoId)}>
                                <ImageIcon size={16} />
                              </IconButton>
                            ) : null}
                            <IconButton label={`Edit ${s.name}`} size="sm" onClick={() => setEditing(s)}>
                              <Pencil size={16} />
                            </IconButton>
                            <IconButton
                              label={`Delete ${s.name}`}
                              size="sm"
                              onClick={async () => {
                                if (await app.confirm({ title: `Remove ${s.name}?`, confirmLabel: 'Remove', tone: 'danger' })) await deleteSpend(s.id);
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
            ) : (
              <p className="muted small">Nothing here yet.</p>
            )}
          </section>
        );
      })}

      <SpendDialog ev={ev} item={editing} onClose={() => setEditing(null)} members={d.members} />
      <PhotoDialog id={photo} onClose={() => setPhoto(null)} />
    </div>
  );
}

function SpendDialog({ ev, item, onClose, members }: { ev: JWEvent; item: Partial<SpendItem> | null; onClose: () => void; members: { id: string; name: string; active: 0 | 1 }[] }) {
  const app = useApp();
  const materials = useMaterials();
  const [f, setF] = useState<Partial<SpendItem>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (item) setF({ qty: 1, unitCost: 0, amortizeEvents: 5, pctUsed: 100, paidBy: null, ...item });
  }, [item]);
  if (!item) return null;
  const type = (f.type ?? 'consumable') as SpendType;

  const save = async () => {
    if (!f.name?.trim()) return;
    setBusy(true);
    await saveSpend({ ...f, eventId: ev.id, name: f.name.trim(), type });
    setBusy(false);
    app.toast('Saved', { tone: 'good' });
    onClose();
  };

  return (
    <Dialog
      open={!!item}
      onClose={onClose}
      title={item.id ? 'Edit booth spend' : 'Add booth spend'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy || !f.name?.trim()} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <Field label="Type" htmlFor="sp-type" hint={SPEND_TYPE_HINT[type]}>
        <Select id="sp-type" value={type} onChange={(e) => setF({ ...f, type: e.target.value as SpendType })}>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {SPEND_TYPE_LABEL[t]}
            </option>
          ))}
        </Select>
      </Field>
      {type === 'material' ? (
        <Field label="Material" htmlFor="sp-mat" hint="Picking one adds the packs to its stock when marked Bought.">
          <Select
            id="sp-mat"
            value={f.materialId ?? ''}
            onChange={(e) => {
              const m = (materials ?? []).find((x) => x.id === e.target.value);
              setF({ ...f, materialId: e.target.value || null, name: f.name || m?.name || '', unitCost: f.unitCost || m?.packCost || 0 });
            }}
          >
            <option value="">Not linked</option>
            {(materials ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} (pack of {m.packQty} {m.unit})
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <Field label="Item" htmlFor="sp-name">
        <TextInput id="sp-name" value={f.name ?? ''} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Tarpaulin backdrop" autoFocus />
      </Field>
      <div className="form-grid">
        <Field label={type === 'material' ? 'Packs' : 'Quantity'} htmlFor="sp-qty">
          <NumberInput id="sp-qty" value={f.qty ?? 1} onChange={(n) => setF({ ...f, qty: n ?? 0 })} />
        </Field>
        <Field label={type === 'material' ? 'Cost per pack' : 'Cost each'} htmlFor="sp-cost">
          <MoneyInput id="sp-cost" value={f.unitCost ?? 0} onChange={(c) => setF({ ...f, unitCost: c ?? 0 })} />
        </Field>
      </div>
      {type === 'asset' ? (
        <Field label="Spread the cost over how many events?" htmlFor="sp-amort" hint="Stands and displays come home with you. Each event carries its share.">
          <NumberInput id="sp-amort" decimals={false} min={1} value={f.amortizeEvents ?? 5} onChange={(n) => setF({ ...f, amortizeEvents: Math.max(1, n ?? 1) })} suffix="events" />
        </Field>
      ) : null}
      {type === 'material' && ev.share.poolMode === 'supplies' ? (
        <Field label="% used at this event" htmlFor="sp-pct" hint="Old-sheet mode: only this share counts against the event.">
          <NumberInput id="sp-pct" value={f.pctUsed ?? 100} onChange={(n) => setF({ ...f, pctUsed: Math.max(0, Math.min(100, n ?? 0)) })} suffix="%" />
        </Field>
      ) : null}
      <Field label="Status" htmlFor="sp-status">
        <Select id="sp-status" value={f.status ?? 'to_buy'} onChange={(e) => setF({ ...f, status: e.target.value as SpendStatus })}>
          {(['to_buy', 'bought', 'not_needed'] as SpendStatus[]).map((st) => (
            <option key={st} value={st}>
              {SPEND_STATUS_LABEL[st]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Who paid" htmlFor="sp-paid" hint="If someone paid from their own pocket, the event lists them to reimburse.">
        <Select id="sp-paid" value={f.paidBy ?? ''} onChange={(e) => setF({ ...f, paidBy: e.target.value || null })}>
          <option value="">JoshWorks funds</option>
          {members
            .filter((m) => m.active === 1)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} (to reimburse)
              </option>
            ))}
        </Select>
      </Field>
      {f.paidBy ? <Check id="sp-reimb" checked={f.reimbursed === 1} onChange={(v) => setF({ ...f, reimbursed: v ? 1 : 0 })} label="Already paid back" /> : null}
      <div className="field">
        <span className="label">Receipt photo</span>
        <div className="row wrap">
          <label className="btn sm" htmlFor="sp-photo">
            <Camera size={16} /> {f.photoId ? 'Replace photo' : 'Add photo'}
          </label>
          <input
            id="sp-photo"
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const id = await savePhoto(file);
              setF((cur) => ({ ...cur, photoId: id }));
              app.toast('Photo attached', { tone: 'good' });
            }}
          />
          {f.photoId ? <Badge tone="good">Photo attached</Badge> : <span className="muted small">Stays on this device.</span>}
        </div>
      </div>
      <Field label="Notes" htmlFor="sp-notes">
        <TextArea id="sp-notes" rows={2} value={f.notes ?? ''} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </Field>
    </Dialog>
  );
}

function PhotoDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const photo = useLiveQuery(async () => (id ? db.photos.get(id) : undefined), [id]);
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!photo) return;
    const u = URL.createObjectURL(photo.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [photo]);
  return (
    <Dialog open={!!id} onClose={onClose} title="Receipt photo" size="wide">
      {photo ? <img src={url} alt="Receipt" style={{ borderRadius: 12, margin: '0 auto' }} /> : <p className="muted">This photo is on another device.</p>}
    </Dialog>
  );
}
