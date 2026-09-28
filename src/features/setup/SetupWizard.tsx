import { useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, FileUp, MonitorSmartphone, Store } from 'lucide-react';
import logo from '../../assets/brand/logo-128.png';
import { Button, Callout } from '../../components/ui';
import { Check, Field, TextInput } from '../../components/form';
import { SEED_MATERIALS, SEED_PRODUCTS, SEED_TEAM } from '../../db/seedData';
import { backupOwner, runJoinSetup, runRestoreSetup, runSetup } from '../../services/setup';
import { parseBackup, type BackupFile } from '../../services/backup';
import { readFileAsText } from '../../lib/files';
import { useApp } from '../../app/AppContext';
import { setLanding } from '../../app/landing';

type Step = 'welcome' | 'business' | 'pin' | 'import' | 'join' | 'restore';

export function SetupWizard({ onDone }: { onDone: () => void }) {
  const app = useApp();
  const [step, setStep] = useState<Step>('welcome');
  const [businessName, setBusinessName] = useState('JoshWorks');
  const [ownerName, setOwnerName] = useState('');
  const [letter, setLetter] = useState('A');
  const [deviceName, setDeviceName] = useState('Owner’s phone');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [importProducts, setImportProducts] = useState(true);
  const [importMaterials, setImportMaterials] = useState(true);
  const [importTeam, setImportTeam] = useState(true);
  const [calcRates, setCalcRates] = useState<'keep' | 'blank'>('keep');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [backup, setBackup] = useState<BackupFile | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const pinError = pin && !/^\d{4,8}$/.test(pin) ? 'Use 4 to 8 digits.' : pin && pin2 && pin !== pin2 ? 'The two PINs don’t match.' : '';

  const finish = async () => {
    setBusy(true);
    setError('');
    try {
      await runSetup({ businessName, ownerName, pin, deviceLetter: letter, deviceName, importProducts, importMaterials, importTeam, calcRates });
      try {
        await navigator.storage?.persist?.();
      } catch {
        /* not supported */
      }
      await app.refreshDevice();
      setLanding('/events?new=1');
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Setup failed. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const join = async () => {
    setBusy(true);
    await runJoinSetup(letter, deviceName);
    await app.refreshDevice();
    setBusy(false);
    setLanding('/settings?section=devices');
    onDone();
  };

  const pickBackup = async (file: File) => {
    setError('');
    try {
      const parsed = parseBackup(await readFileAsText(file));
      setBackup(parsed);
      setLetter(parsed.device?.letter || 'A');
      setDeviceName('This device');
    } catch (e) {
      setBackup(null);
      setError(e instanceof Error ? e.message : 'That file could not be read.');
    }
  };

  const restore = async () => {
    if (!backup) return;
    setBusy(true);
    setError('');
    try {
      await runRestoreSetup(backup, letter, deviceName);
      try {
        await navigator.storage?.persist?.();
      } catch {
        /* not supported */
      }
      await app.refreshDevice();
      setLanding('/');
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The restore failed. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const count = (t: keyof BackupFile['tables']) => ((backup?.tables[t] ?? []) as { deleted?: number }[]).filter((r) => r.deleted !== 1).length;
  const restoredOwner = backup ? backupOwner(backup) : null;

  return (
    <div className="main" style={{ gridRow: 'auto', minHeight: '100%' }}>
      <div className="page narrow" style={{ paddingTop: 40 }}>
        <div className="row" style={{ gap: 14 }}>
          <img src={logo} alt="" width={56} height={56} style={{ borderRadius: 14 }} />
          <div>
            <span className="eyebrow">Welcome</span>
            <h1>JoshWorks POS</h1>
          </div>
        </div>

        {step === 'welcome' ? (
          <div className="stack">
            <p className="muted">This app runs on this device and keeps working with no internet. Set it up once on your main device; other devices join it later.</p>
            <div className="grid-2">
              <button type="button" className="card pad-lg" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => setStep('business')}>
                <Store size={28} className="teal" />
                <h2>Set up JoshWorks POS</h2>
                <p className="muted">I&rsquo;m the owner and this is my main device.</p>
              </button>
              <button
                type="button"
                className="card pad-lg"
                style={{ textAlign: 'left', cursor: 'pointer' }}
                onClick={() => {
                  setLetter('B');
                  setDeviceName('Second phone');
                  setStep('join');
                }}
              >
                <MonitorSmartphone size={28} className="teal" />
                <h2>Add this device</h2>
                <p className="muted">Another device is already set up. This one will sell alongside it.</p>
              </button>
            </div>
            <button
              type="button"
              className="card"
              style={{ textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 14 }}
              onClick={() => {
                setError('');
                setStep('restore');
              }}
            >
              <FileUp size={24} className="teal" style={{ flex: 'none' }} />
              <span>
                <b>Restore from a backup file</b>
                <span className="muted small" style={{ display: 'block' }}>
                  Moving to a new phone, computer or browser? Start from the file you saved in Settings → Backup and devices.
                </span>
              </span>
            </button>
          </div>
        ) : null}

        {step === 'restore' ? (
          <div className="card pad-lg stack">
            <h2>Restore from a backup file</h2>
            <p className="muted">Everything in the file comes over: products, prices, costs, events, sales, the team, your business details and owner PIN.</p>
            <div>
              <Button onClick={() => fileRef.current?.click()}>
                <FileUp size={18} /> {backup ? 'Choose a different file' : 'Choose the backup file'}
              </Button>
              <input ref={fileRef} type="file" accept=".json,application/json" className="sr-only" aria-label="Backup file" onChange={(e) => e.target.files?.[0] && pickBackup(e.target.files[0])} />
            </div>
            {backup ? (
              <>
                <Callout tone={restoredOwner ? 'good' : 'warn'} title={`From ${backup.device?.name ?? 'a device'}, saved ${new Date(backup.exportedAt).toLocaleString('en-PH')}`}>
                  {[
                    plural(count('products'), 'product'),
                    plural(count('events'), 'event'),
                    plural(count('sales'), 'sale'),
                    plural(count('members'), 'person', 'people'),
                  ].join(' · ')}
                  .{' '}
                  {restoredOwner ? <>You&rsquo;ll be signed in as <b>{restoredOwner.name}</b>, the owner.</> : 'This file has no owner; add one afterwards in Switch person.'}
                </Callout>
                <div className="form-grid">
                  <Field label="Register letter for this device" htmlFor="rletter" hint="Keep the same letter if the old device won’t sell any more; otherwise pick a new one.">
                    <TextInput id="rletter" value={letter} maxLength={2} onChange={(e) => setLetter(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} />
                  </Field>
                  <Field label="Device name" htmlFor="rname">
                    <TextInput id="rname" value={deviceName} onChange={(e) => setDeviceName(e.target.value)} />
                  </Field>
                </div>
              </>
            ) : null}
            {error ? <Callout tone="bad">{error}</Callout> : null}
            <div className="row between">
              <Button variant="ghost" onClick={() => setStep('welcome')}>
                <ArrowLeft size={18} /> Back
              </Button>
              <Button variant="primary" size="lg" disabled={!backup || !letter || busy} onClick={restore}>
                {busy ? 'Restoring…' : 'Restore'}
              </Button>
            </div>
          </div>
        ) : null}

        {step === 'business' ? (
          <div className="card pad-lg stack">
            <h2>You and this device</h2>
            <div className="form-grid">
              <Field label="Business name" htmlFor="biz">
                <TextInput id="biz" value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
              </Field>
              <Field label="Your name (owner)" htmlFor="owner" hint="Pick your name if you're on the old team list.">
                <TextInput id="owner" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="Your name" autoFocus />
              </Field>
            </div>
            <div className="chip-row">
              {SEED_TEAM.map((t) => (
                <button key={t.name} type="button" className={`chip ${ownerName === t.name ? 'on' : ''}`} onClick={() => setOwnerName(t.name)}>
                  {t.name}
                </button>
              ))}
            </div>
            <div className="form-grid">
              <Field label="Register letter" htmlFor="letter" hint="Printed on receipts: A-0001. Each device needs its own letter.">
                <TextInput id="letter" value={letter} maxLength={2} onChange={(e) => setLetter(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} />
              </Field>
              <Field label="Device name" htmlFor="devname">
                <TextInput id="devname" value={deviceName} onChange={(e) => setDeviceName(e.target.value)} />
              </Field>
            </div>
            <div className="row between">
              <Button variant="ghost" onClick={() => setStep('welcome')}>
                <ArrowLeft size={18} /> Back
              </Button>
              <Button variant="primary" disabled={!ownerName.trim() || !letter} onClick={() => setStep('pin')}>
                Next <ArrowRight size={18} />
              </Button>
            </div>
          </div>
        ) : null}

        {step === 'pin' ? (
          <div className="card pad-lg stack">
            <h2>Owner PIN</h2>
            <p className="muted">
              Cashiers need this PIN to void a sale, give a big discount, or switch the device back to you. It works offline. Keep it to yourself.
            </p>
            <div className="form-grid">
              <Field label="PIN (4 to 8 digits)" htmlFor="pin1" error={pinError || undefined}>
                <TextInput id="pin1" type="password" inputMode="numeric" autoComplete="new-password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} />
              </Field>
              <Field label="Type it again" htmlFor="pin2">
                <TextInput id="pin2" type="password" inputMode="numeric" autoComplete="new-password" value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, '').slice(0, 8))} />
              </Field>
            </div>
            <div className="row between wrap">
              <Button variant="ghost" onClick={() => setStep('business')}>
                <ArrowLeft size={18} /> Back
              </Button>
              <div className="actions">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setPin('');
                    setPin2('');
                    setStep('import');
                  }}
                >
                  Skip for now
                </Button>
                <Button variant="primary" disabled={!pin || !!pinError || pin !== pin2} onClick={() => setStep('import')}>
                  Next <ArrowRight size={18} />
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {step === 'import' ? (
          <div className="card pad-lg stack">
            <h2>Start from your old sheets?</h2>
            <p className="muted">Nothing from past events comes over: no sales and no prices. These only save typing.</p>
            <div className="stack">
              <Check id="imp-products" checked={importProducts} onChange={setImportProducts} label={`Product names and categories (${SEED_PRODUCTS.length} items)`} sub="Prices and costs stay blank. You set them per event." />
              <Check id="imp-materials" checked={importMaterials} onChange={setImportMaterials} label={`Materials list (${SEED_MATERIALS.length} items)`} sub="Vinyl, laminate, ink, sleeves… Costs and stock counts stay blank." />
              <Check id="imp-team" checked={importTeam} onChange={setImportTeam} label={`Team names and role weights (${SEED_TEAM.length} people)`} sub={SEED_TEAM.map((t) => t.name).join(', ')} />
            </div>
            <div className="field">
              <span className="label">Pricing calculator rates</span>
              <div className="stack tight">
                <label className="check" htmlFor="rates-keep">
                  <input id="rates-keep" type="radio" name="rates" checked={calcRates === 'keep'} onChange={() => setCalcRates('keep')} />
                  <span>
                    Keep my current rates
                    <span className="sub">25% overhead, 45% target margin, 30% minimum, labor rates per role, add-on %</span>
                  </span>
                </label>
                <label className="check" htmlFor="rates-blank">
                  <input id="rates-blank" type="radio" name="rates" checked={calcRates === 'blank'} onChange={() => setCalcRates('blank')} />
                  <span>Start blank</span>
                </label>
              </div>
            </div>
            {error ? <Callout tone="bad">{error}</Callout> : null}
            <div className="row between">
              <Button variant="ghost" onClick={() => setStep('pin')}>
                <ArrowLeft size={18} /> Back
              </Button>
              <Button variant="primary" size="lg" disabled={busy} onClick={finish}>
                {busy ? 'Setting up…' : 'Finish setup'}
              </Button>
            </div>
          </div>
        ) : null}

        {step === 'join' ? (
          <div className="card pad-lg stack">
            <h2>Add this device</h2>
            <p className="muted">Give this device its own register letter so its receipts never clash with the main device&rsquo;s.</p>
            <div className="form-grid">
              <Field label="Register letter" htmlFor="jletter" hint="The main device is usually A.">
                <TextInput id="jletter" value={letter} maxLength={2} onChange={(e) => setLetter(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} />
              </Field>
              <Field label="Device name" htmlFor="jname">
                <TextInput id="jname" value={deviceName} onChange={(e) => setDeviceName(e.target.value)} />
              </Field>
            </div>
            <Callout tone="info" title="Next: get the products and event from the main device">
              On the main device open Settings → Backup and devices → Share this device&rsquo;s data, send the file here, then open it here with Merge a file. With cloud sync on, signing in does this automatically.
            </Callout>
            <div className="row between">
              <Button variant="ghost" onClick={() => setStep('welcome')}>
                <ArrowLeft size={18} /> Back
              </Button>
              <Button variant="primary" disabled={!letter || busy} onClick={join}>
                Continue
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
