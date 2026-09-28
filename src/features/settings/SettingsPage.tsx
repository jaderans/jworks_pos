import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Download, HardDrive, Merge, Plus, QrCode, Share2, Smartphone, Upload } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { usePaymentMethods, useSettingRows } from '../../hooks/data';
import { DEFAULT_BUSINESS, setSetting, settingValue } from '../../db/settings';
import { setLocal, updateDevice } from '../../db/local';
import { Dialog } from '../../components/Dialog';
import { Badge, Button, Callout, PageHeader, Toggle } from '../../components/ui';
import { Check, Field, Select, TextArea, TextInput } from '../../components/form';
import { canShareFiles, compressImage, downloadBlob, readFileAsDataURL, readFileAsText, shareBlob } from '../../lib/files';
import { backupBlob, backupFileName, exportAll, mergeBackup, parseBackup, wipeAll, type BackupFile, type MergeStats } from '../../services/backup';
import { savePaymentMethod, setOwnerPin, verifyOwnerPin } from '../../services/team';
import { backupOwner } from '../../services/setup';
import { CloudSection } from './CloudSection';
import type { BusinessSettings, PaymentMethod, SecuritySettings } from '../../db/types';

export default function SettingsPage() {
  const app = useApp();
  const [params] = useSearchParams();
  const owner = app.can('settings');
  useEffect(() => {
    const section = params.get('section');
    if (section) window.setTimeout(() => document.getElementById(`s-${section}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
  }, [params]);
  return (
    <div className="page narrow">
      <PageHeader title="Settings" subtitle={owner ? 'Business, devices, payments, backups and cloud sync.' : 'This device and how the app looks.'} />
      {owner ? <BusinessSection /> : null}
      <DeviceSection />
      {owner ? <PinSection /> : null}
      {owner ? <PaymentsSection /> : null}
      <BackupSection owner={owner} />
      <CloudSection />
      <InstallSection />
    </div>
  );
}

function Section({ id, title, children, sub }: { id: string; title: string; children: React.ReactNode; sub?: string }) {
  return (
    <section id={`s-${id}`} className="card pad-lg" style={{ scrollMarginTop: 80 }}>
      <h2>{title}</h2>
      {sub ? <p className="sub">{sub}</p> : null}
      {children}
    </section>
  );
}

function BusinessSection() {
  const app = useApp();
  const rows = useSettingRows();
  const saved = settingValue<BusinessSettings>(rows, 'business');
  const [f, setF] = useState<BusinessSettings>(saved);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) setF(saved);
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (c: Partial<BusinessSettings>) => {
    setF({ ...f, ...c });
    setDirty(true);
  };
  return (
    <Section id="business" title="Business" sub="Shown on receipts, reports and quotes.">
      <div className="form-grid">
        <Field label="Business name" htmlFor="bz-name">
          <TextInput id="bz-name" value={f.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="Tagline" htmlFor="bz-tag">
          <TextInput id="bz-tag" value={f.tagline} onChange={(e) => set({ tagline: e.target.value })} />
        </Field>
        <Field label="Address" htmlFor="bz-addr">
          <TextInput id="bz-addr" value={f.address} onChange={(e) => set({ address: e.target.value })} />
        </Field>
        <Field label="Contact (page, email or number)" htmlFor="bz-contact">
          <TextInput id="bz-contact" value={f.contact} onChange={(e) => set({ contact: e.target.value })} />
        </Field>
        <Field label="Receipt footer" htmlFor="bz-footer" className="span-2">
          <TextInput id="bz-footer" value={f.receiptFooter} onChange={(e) => set({ receiptFooter: e.target.value })} placeholder={DEFAULT_BUSINESS.receiptFooter} />
        </Field>
      </div>
      <div>
        <Button
          variant="primary"
          disabled={!dirty}
          onClick={async () => {
            await setSetting('business', f);
            setDirty(false);
            app.toast('Saved', { tone: 'good' });
          }}
        >
          Save
        </Button>
      </div>
    </Section>
  );
}

function DeviceSection() {
  const app = useApp();
  const [letter, setLetter] = useState(app.device.letter);
  const [name, setName] = useState(app.device.name);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [usage, setUsage] = useState('');
  useEffect(() => {
    setLetter(app.device.letter);
    setName(app.device.name);
  }, [app.device]);
  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null));
    navigator.storage
      ?.estimate?.()
      .then((e) => setUsage(e.usage ? `${(e.usage / 1024 / 1024).toFixed(1)} MB used` : ''))
      .catch(() => undefined);
  }, []);
  const save = async () => {
    await updateDevice({ letter, name });
    await app.refreshDevice();
    app.toast('Device saved', { tone: 'good' });
  };
  return (
    <Section id="device" title="This device" sub="Every device that sells needs its own register letter, so receipt numbers never clash, even offline.">
      <div className="form-grid">
        <Field label="Register letter" htmlFor="dv-letter" hint={`Receipts from this device: ${letter || 'A'}-0001, ${letter || 'A'}-0002…`}>
          <TextInput id="dv-letter" value={letter} maxLength={2} onChange={(e) => setLetter(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} />
        </Field>
        <Field label="Device name" htmlFor="dv-name">
          <TextInput id="dv-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      </div>
      <div className="row wrap between">
        <Button onClick={save} disabled={letter === app.device.letter && name === app.device.name}>
          Save device
        </Button>
        <span className="muted tiny mono">ID {app.device.deviceId.slice(0, 8)}</span>
      </div>
      <hr className="divider" />
      <div className="row between wrap">
        <div>
          <b className="row" style={{ gap: 6 }}>
            <HardDrive size={18} /> Storage {persisted ? <Badge tone="good">Kept permanently</Badge> : <Badge tone="warn">May be cleared</Badge>}
          </b>
          <p className="muted small">{persisted ? 'The browser won’t clear this app’s data to free space.' : 'Ask the browser to keep this app’s data. Installing the app also helps.'} {usage}</p>
        </div>
        {!persisted ? (
          <Button
            size="sm"
            onClick={async () => {
              const ok = await navigator.storage?.persist?.();
              setPersisted(!!ok);
              app.toast(ok ? 'This device will keep the data' : 'The browser said no. Install the app, then try again.', { tone: ok ? 'good' : 'bad' });
            }}
          >
            Keep data on this device
          </Button>
        ) : null}
      </div>
    </Section>
  );
}

function PinSection() {
  const app = useApp();
  const rows = useSettingRows();
  const sec = settingValue<SecuritySettings>(rows, 'security');
  const [current, setCurrent] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [error, setError] = useState('');
  const change = async () => {
    setError('');
    if (sec.pinHash && !(await verifyOwnerPin(current))) {
      setError('The current PIN is not right.');
      return;
    }
    if (!/^\d{4,8}$/.test(pin)) {
      setError('Use 4 to 8 digits.');
      return;
    }
    if (pin !== pin2) {
      setError('The new PINs don’t match.');
      return;
    }
    await setOwnerPin(pin);
    setCurrent('');
    setPin('');
    setPin2('');
    app.toast('Owner PIN changed', { tone: 'good' });
  };
  return (
    <Section id="pin" title="Owner PIN" sub="Needed on a cashier's device to void a sale, give a big discount, give an item free, or switch back to the owner. Works offline.">
      <div className="form-grid">
        {sec.pinHash ? (
          <Field label="Current PIN" htmlFor="pin-cur">
            <TextInput id="pin-cur" type="password" inputMode="numeric" autoComplete="off" value={current} onChange={(e) => setCurrent(e.target.value.replace(/\D/g, ''))} />
          </Field>
        ) : (
          <Callout tone="warn">No PIN is set, so anyone using the app can do owner actions.</Callout>
        )}
        <Field label="New PIN" htmlFor="pin-new">
          <TextInput id="pin-new" type="password" inputMode="numeric" autoComplete="new-password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} />
        </Field>
        <Field label="New PIN again" htmlFor="pin-new2">
          <TextInput id="pin-new2" type="password" inputMode="numeric" autoComplete="new-password" value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, '').slice(0, 8))} />
        </Field>
      </div>
      {error ? <Callout tone="bad">{error}</Callout> : null}
      <div className="actions">
        <Button variant="primary" onClick={change} disabled={!pin}>
          {sec.pinHash ? 'Change PIN' : 'Set PIN'}
        </Button>
        {sec.pinHash ? (
          <Button
            variant="ghost"
            onClick={async () => {
              if (!(await verifyOwnerPin(current))) {
                setError('Type the current PIN first.');
                return;
              }
              await setOwnerPin(null);
              setCurrent('');
              app.toast('PIN removed');
            }}
          >
            Remove PIN
          </Button>
        ) : null}
      </div>
    </Section>
  );
}

const KIND_LABEL: Record<PaymentMethod['kind'], string> = { cash: 'Cash', ewallet: 'E-wallet', bank: 'Bank', card: 'Card', other: 'Other' };

function PaymentsSection() {
  const methods = usePaymentMethods();
  const [editing, setEditing] = useState<Partial<PaymentMethod> | null>(null);
  return (
    <Section id="payments" title="Payment methods" sub="Turn methods on per event in Event → Settings. Add your QR codes so customers can scan them on the pay screen.">
      <div className="card flush">
        <div className="list">
          {(methods ?? []).map((m) => (
            <div key={m.id} className="list-item">
              {m.qr ? <img src={m.qr} alt="" className="thumb" /> : <span className="avatar lg"><QrCode size={18} /></span>}
              <span className="main-text">
                <b>{m.name}</b>
                <span>
                  {KIND_LABEL[m.kind]}
                  {m.requireRef ? ' · asks for a reference no.' : ''}
                  {m.accountNumber ? ` · ${m.accountNumber}` : ''}
                </span>
              </span>
              {m.active ? <Badge tone="good">On</Badge> : <Badge>Off</Badge>}
              <Button size="sm" onClick={() => setEditing(m)}>
                Edit
              </Button>
            </div>
          ))}
        </div>
      </div>
      <div>
        <Button onClick={() => setEditing({ kind: 'ewallet', requireRef: 1, active: 1 })}>
          <Plus size={16} /> Add a payment method
        </Button>
      </div>
      <PaymentMethodDialog method={editing} onClose={() => setEditing(null)} />
    </Section>
  );
}

function PaymentMethodDialog({ method, onClose }: { method: Partial<PaymentMethod> | null; onClose: () => void }) {
  const app = useApp();
  const [f, setF] = useState<Partial<PaymentMethod>>({});
  useEffect(() => {
    if (method) setF({ name: '', kind: 'ewallet', requireRef: 1, qr: null, accountName: '', accountNumber: '', active: 1, ...method });
  }, [method]);
  if (!method) return null;
  return (
    <Dialog
      open={!!method}
      onClose={onClose}
      title={method.id ? `Edit ${method.name}` : 'New payment method'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!f.name?.trim()}
            onClick={async () => {
              await savePaymentMethod({ ...f, name: f.name!.trim() });
              app.toast('Saved', { tone: 'good' });
              onClose();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Name" htmlFor="pm-name">
          <TextInput id="pm-name" value={f.name ?? ''} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. GCash" />
        </Field>
        <Field label="Type" htmlFor="pm-kind">
          <Select id="pm-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as PaymentMethod['kind'] })}>
            {(Object.keys(KIND_LABEL) as PaymentMethod['kind'][]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Account name" htmlFor="pm-acct" hint="Shown to the customer on the pay screen.">
          <TextInput id="pm-acct" value={f.accountName ?? ''} onChange={(e) => setF({ ...f, accountName: e.target.value })} />
        </Field>
        <Field label="Account or mobile number" htmlFor="pm-num">
          <TextInput id="pm-num" value={f.accountNumber ?? ''} onChange={(e) => setF({ ...f, accountNumber: e.target.value })} />
        </Field>
      </div>
      <div className="row wrap" style={{ gap: 20 }}>
        <Toggle id="pm-ref" checked={f.requireRef === 1} onChange={(v) => setF({ ...f, requireRef: v ? 1 : 0 })} label="Ask for a reference number" />
        <Toggle id="pm-active" checked={f.active === 1} onChange={(v) => setF({ ...f, active: v ? 1 : 0 })} label="Available" />
      </div>
      {f.kind !== 'cash' ? (
        <div className="field">
          <span className="label">QR code</span>
          <div className="row wrap">
            {f.qr ? <img src={f.qr} alt="QR code" className="qr-img" style={{ width: 140, height: 140 }} /> : null}
            <label className="btn" htmlFor="pm-qr">
              <Upload size={16} /> {f.qr ? 'Replace QR image' : 'Upload QR image'}
            </label>
            <input
              id="pm-qr"
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const small = await compressImage(file, 720, 0.9, 'image/png');
                setF({ ...f, qr: await readFileAsDataURL(small) });
              }}
            />
            {f.qr ? (
              <Button variant="ghost" onClick={() => setF({ ...f, qr: null })}>
                Remove
              </Button>
            ) : null}
          </div>
          <span className="hint">Save the QR from your GCash or bank app as an image, then upload it here.</span>
        </div>
      ) : null}
    </Dialog>
  );
}

function BackupSection({ owner }: { owner: boolean }) {
  const app = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<BackupFile | null>(null);
  const [replace, setReplace] = useState(false);
  const [stats, setStats] = useState<MergeStats | null>(null);
  const [photos, setPhotos] = useState(false);

  const share = async (asShare: boolean) => {
    const file = await exportAll(photos);
    const blob = backupBlob(file);
    const name = backupFileName(file, asShare ? 'device' : 'backup');
    if (asShare && (await shareBlob(blob, name, 'JoshWorks POS data'))) return;
    downloadBlob(blob, name);
    app.toast('File saved to Downloads', { tone: 'good' });
  };

  const pick = async (file: File) => {
    try {
      const parsed = parseBackup(await readFileAsText(file));
      setPending(parsed);
      setStats(null);
      setReplace(false);
    } catch (e) {
      app.toast(e instanceof Error ? e.message : 'That file could not be read.', { tone: 'bad' });
    }
  };

  const apply = async () => {
    if (!pending) return;
    if (replace && !(await app.confirm({ title: 'Replace everything on this device?', message: 'All data here is erased first, then the file is loaded. Use this only to move to a new phone.', confirmLabel: 'Erase and replace', tone: 'danger' }))) return;
    if (replace) await wipeAll();
    const s = await mergeBackup(pending);
    if (replace) {
      const owner = backupOwner(pending);
      if (owner) await setLocal('currentMemberId', owner.id);
    }
    setStats(s);
    app.toast(`Merged: ${s.added} new, ${s.updated} updated`, { tone: 'good' });
  };

  const counts = pending ? Object.entries(pending.tables).map(([k, v]) => [k, (v as unknown[]).length] as const).filter(([, n]) => n > 0) : [];

  return (
    <Section id="devices" title="Backup and devices" sub="With no internet, two phones combine their sales through a file. Records carry an ID and a timestamp, so merging the same file twice never doubles a sale.">
      <div className="grid-2">
        <div className="stack tight">
          <b className="row" style={{ gap: 6 }}>
            <Share2 size={18} /> Share this device&rsquo;s data
          </b>
          <p className="muted small">Send it to the main device by Nearby Share, Bluetooth, Messenger or a cable, then merge it there.</p>
          <div className="actions">
            {canShareFiles() ? (
              <Button variant="teal" onClick={() => share(true)}>
                Share file
              </Button>
            ) : null}
            <Button onClick={() => share(false)}>
              <Download size={16} /> Download file
            </Button>
          </div>
          <Check id="bk-photos" checked={photos} onChange={setPhotos} label="Include receipt photos" sub="Makes the file bigger." />
        </div>
        <div className="stack tight">
          <b className="row" style={{ gap: 6 }}>
            <Merge size={18} /> Merge a file from another device
          </b>
          <p className="muted small">Or restore a backup. Newer copies win; nothing is deleted.</p>
          <div>
            <Button onClick={() => fileRef.current?.click()}>
              <Upload size={16} /> Choose a file
            </Button>
            <input ref={fileRef} type="file" accept=".json,application/json" className="sr-only" onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
          </div>
        </div>
      </div>
      <Dialog
        open={!!pending}
        onClose={() => setPending(null)}
        title="Merge this file?"
        footer={
          stats ? (
            <Button variant="primary" onClick={() => setPending(null)}>
              Done
            </Button>
          ) : (
            <>
              <Button onClick={() => setPending(null)}>Cancel</Button>
              <Button variant={replace ? 'danger' : 'primary'} onClick={apply}>
                {replace ? 'Erase and replace' : 'Merge'}
              </Button>
            </>
          )
        }
      >
        {pending ? (
          <>
            <p>
              From <b>{pending.device?.name ?? 'a device'}</b> (register {pending.device?.letter ?? '?'}), saved {new Date(pending.exportedAt).toLocaleString('en-PH')}.
            </p>
            {pending.device?.deviceId === app.device.deviceId ? <Callout tone="info">This file came from this same device. Merging it changes nothing unless it&rsquo;s an older backup.</Callout> : null}
            {pending.device?.letter === app.device.letter && pending.device?.deviceId !== app.device.deviceId ? (
              <Callout tone="warn">That device uses the same register letter ({app.device.letter}) as this one. Give one of them a different letter in Settings → This device so receipt numbers don&rsquo;t repeat.</Callout>
            ) : null}
            <p className="small muted">{counts.map(([k, n]) => `${n} ${k}`).join(' · ')}</p>
            {owner ? <Toggle id="bk-replace" checked={replace} onChange={setReplace} label="Replace everything on this device instead (for moving to a new phone)" /> : null}
            {stats ? (
              <Callout tone="good" title="Merged">
                {stats.added} new and {stats.updated} updated records; {stats.unchanged} were already here.
              </Callout>
            ) : null}
          </>
        ) : null}
      </Dialog>
    </Section>
  );
}

function InstallSection() {
  const [prompt, setPrompt] = useState<(Event & { prompt: () => Promise<void> }) | null>(null);
  const [installed, setInstalled] = useState(window.matchMedia?.('(display-mode: standalone)').matches ?? false);
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as Event & { prompt: () => Promise<void> });
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);
  return (
    <Section id="install" title="Install the app" sub="Installed, it opens from its own icon, full screen, and works with no internet.">
      {installed ? (
        <Callout tone="good">This device is running the installed app.</Callout>
      ) : (
        <>
          {prompt ? (
            <div>
              <Button variant="primary" onClick={() => prompt.prompt()}>
                <Smartphone size={18} /> Install JoshWorks POS
              </Button>
            </div>
          ) : null}
          <ul className="small" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
            <li>
              <b>Android (Chrome):</b> menu ⋮ → Add to Home screen → Install.
            </li>
            <li>
              <b>iPhone or iPad (Safari):</b> Share → Add to Home Screen. Open it from the new icon from then on.
            </li>
            <li>
              <b>Windows (Chrome or Edge):</b> the install icon at the right end of the address bar.
            </li>
          </ul>
          <p className="muted small">Open the app once while online after installing. After that it works offline.</p>
        </>
      )}
    </Section>
  );
}

export { TextArea };
