import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { Camera, Download, Mail, Monitor, Palette, Printer, RefreshCw, RotateCcw, Trash2, X } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { db } from '../../db/db';
import { setLocal } from '../../db/local';
import { settingValue } from '../../db/settings';
import { useLocal, useSettingRows } from '../../hooks/data';
import { Badge, Button, Callout, EmptyState, PageHeader, Segmented } from '../../components/ui';
import { Check, Field, Select, TextInput } from '../../components/form';
import { peso } from '../../lib/money';
import { fmtDate } from '../../lib/time';
import { downloadBlob } from '../../lib/files';
import { BOOTH_FRAMES, boothDaysLeft, boothFileName, boothFrame, type BoothFrameKey } from '../../domain/booth';
import { listCameras, useCamera } from '../../booth/camera';
import { captureBoothPhoto } from '../../booth/frames';
import { FramePreview } from '../../booth/FramePreview';
import { PhotoImg } from '../../booth/PhotoImg';
import { deleteBoothPhoto, emailBoothPhoto, keepBoothPhoto, sendBoothPhotoToDrive } from '../../booth/photos';
import { boothSender, type BoothShow } from '../../display/channel';
import { openCustomerScreen, useSecondScreen } from '../../display/screens';
import type { BoothPhoto, BusinessSettings, PrintRates } from '../../db/types';
import './booth.css';

interface BoothPrefs {
  camera: string;
  frame: BoothFrameKey;
  mirror: boolean;
  countdown: number;
}
const DEFAULT_PREFS: BoothPrefs = { camera: '', frame: 'sticker', mirror: true, countdown: 3 };

const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms));
const looksLikeEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

/**
 * Selling → Services → Photo booth: the customer's photo in a JoshWorks frame,
 * shown on the customer screen as a sticker preview. Kept only with their yes;
 * then turned into a service order, emailed to them, or deleted after 30 days.
 */
export default function BoothPage() {
  const app = useApp();
  const navigate = useNavigate();
  const settingRows = useSettingRows();
  const business = settingValue<BusinessSettings>(settingRows, 'business');
  const rates = settingValue<PrintRates>(settingRows, 'printRates');
  const saved = useLocal<Partial<BoothPrefs>>('booth', DEFAULT_PREFS);
  const prefs = useMemo<BoothPrefs>(() => ({ ...DEFAULT_PREFS, ...(saved ?? {}) }), [saved]);
  const setPrefs = (p: Partial<BoothPrefs>) => void setLocal('booth', { ...prefs, ...p });
  const secondScreen = useSecondScreen();

  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [shot, setShot] = useState<Blob | null>(null);
  const [shotUrl, setShotUrl] = useState('');
  const [count, setCount] = useState<number | null>(null);
  const [flash, setFlash] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [emailTo, setEmailTo] = useState('');
  const [busy, setBusy] = useState(false);
  const photos = useLiveQuery(() => db.boothPhotos.orderBy('at').reverse().toArray(), []);
  const kept = photos?.find((p) => p.id === current) ?? null;
  const live = !shot && !kept;
  const cam = useCamera(prefs.camera, live);
  const alive = useRef(true);

  const eventName = app.activeEvent?.name ?? business.name ?? 'JoshWorks';
  const date = fmtDate(Date.now());
  const illustrationFrom = Math.min(...rates.illustration.tiers.map((t) => t.price).filter((x) => x > 0));
  const offer = Number.isFinite(illustrationFrom) ? `from ${peso(illustrationFrom)}` : '';

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // The cameras' names show once the browser has the camera permission.
  useEffect(() => {
    void listCameras().then(setCameras).catch(() => setCameras([]));
  }, [cam.video]);

  useEffect(() => {
    if (!shot) return setShotUrl('');
    const u = URL.createObjectURL(shot);
    setShotUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [shot]);

  // The customer screen follows the booth while this page is open.
  const sender = useRef<ReturnType<typeof boothSender> | null>(null);
  useEffect(() => {
    sender.current = boothSender();
    return () => {
      sender.current?.close();
      sender.current = null;
    };
  }, []);
  const show: BoothShow = {
    stage: kept ? 'kept' : shot ? 'preview' : count !== null ? 'countdown' : 'live',
    camera: cam.deviceId || prefs.camera,
    frame: kept?.frame ?? prefs.frame,
    mirror: prefs.mirror,
    count,
    photo: kept?.blob ?? shot,
    number: kept?.number ?? null,
    eventName,
    date,
    offer,
    at: 0,
  };
  const showKey = `${show.stage}|${show.camera}|${show.frame}|${show.mirror}|${show.count}|${kept?.id ?? ''}|${shotUrl}|${eventName}|${offer}`;
  useEffect(() => {
    sender.current?.send({ ...show, at: Date.now() });
  }, [showKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const take = async () => {
    const v = cam.video;
    if (!v || count !== null) return;
    for (let n = prefs.countdown; n > 0; n--) {
      setCount(n);
      await wait(1000);
      if (!alive.current) return;
    }
    setCount(null);
    setFlash(true);
    window.setTimeout(() => alive.current && setFlash(false), 350);
    try {
      const blob = await captureBoothPhoto(prefs.frame, v, v.videoWidth, v.videoHeight, { mirror: prefs.mirror, eventName, date });
      if (alive.current) setShot(blob);
    } catch (e) {
      app.toast(e instanceof Error ? e.message : 'Couldn’t take the photo', { tone: 'bad' });
    }
  };

  // Space bar takes the photo, unless someone is typing.
  useEffect(() => {
    if (!live) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.code !== 'Space' || t?.closest('input, textarea, select, button, [contenteditable]') || document.body.dataset.dialogOpen) return;
      e.preventDefault();
      void take();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const keep = async () => {
    if (!shot) return;
    setBusy(true);
    try {
      const p = await keepBoothPhoto({ blob: shot, frame: prefs.frame, name, contact, eventId: app.activeEventId, by: app.member?.id ?? null, device: app.device });
      setShot(null);
      setCurrent(p.id);
      setEmailTo(looksLikeEmail(contact) ? contact.trim() : '');
      setName('');
      setContact('');
      app.toast(`Photo ${p.number} kept`, { tone: 'good' });
    } catch (e) {
      app.toast(e instanceof Error ? e.message : 'Couldn’t keep it', { tone: 'bad' });
    } finally {
      setBusy(false);
    }
  };
  const discard = () => {
    setShot(null);
    setName('');
    setContact('');
  };
  const remove = async (p: BoothPhoto) => {
    const ok = await app.confirm({
      title: `Delete photo ${p.number}?`,
      message: p.usedFor ? `It’s on service order ${p.usedFor.number}. The copy in Google Drive stays; delete it there if you need to.` : 'It’s deleted from this laptop. You can’t undo this.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    await deleteBoothPhoto(p.id);
    if (current === p.id) setCurrent(null);
  };
  const email = async (p: BoothPhoto) => {
    setBusy(true);
    try {
      await emailBoothPhoto(p.id, emailTo, eventName);
      app.toast(`Photo ${p.number} is on its way to ${emailTo.trim()}`, { tone: 'good' });
    } catch (e) {
      app.toast(e instanceof Error ? e.message : 'Couldn’t email it', { tone: 'bad' });
    } finally {
      setBusy(false);
    }
  };
  const retryDrive = async (p: BoothPhoto) => {
    const r = await sendBoothPhotoToDrive(p.id);
    app.toast(r === 'saved' ? `Photo ${p.number} is in Drive` : 'Still not in Drive. It tries again by itself when there’s internet.', { tone: r === 'saved' ? 'good' : 'bad' });
  };
  const screen = async () => {
    const r = await openCustomerScreen();
    if (r === 'blocked') app.toast('The browser blocked the customer screen. Allow pop-ups for this site, then try again.', { tone: 'bad' });
    else if (r === 'moved') app.toast('The customer screen is on the second monitor. Click Full screen there.', { tone: 'good' });
  };
  const open = (p: BoothPhoto) => {
    setShot(null);
    setCurrent(p.id);
    setEmailTo(p.emailedTo ?? (looksLikeEmail(p.contact) ? p.contact : ''));
  };

  return (
    <div className="page wide">
      <PageHeader
        title="Photo booth"
        subtitle="The customer’s photo in a JoshWorks frame, shown on the customer screen as a sticker. Kept only if they say yes, and deleted after 30 days unless it’s used for an order."
        actions={
          <>
            <Button className="hide-phone" variant={secondScreen ? 'teal' : undefined} onClick={() => void screen()}>
              <Monitor size={18} /> Customer screen
            </Button>
            <Button onClick={() => navigate('/print')}>
              <Printer size={18} /> Services
            </Button>
          </>
        }
      />

      <div className="booth">
        <section className="booth-stage card" aria-label={kept ? `Photo ${kept.number}` : shot ? 'The photo' : 'Camera'}>
          {kept ? (
            <PhotoImg photo={kept} className={`booth-photo frame-${kept.frame}`} />
          ) : shot ? (
            <img src={shotUrl} alt="The photo" className={`booth-photo frame-${prefs.frame}`} />
          ) : cam.error ? (
            <div className="booth-nocam">
              <Camera size={40} aria-hidden="true" />
              <p>{cam.error}</p>
              <Button onClick={cam.retry}>
                <RefreshCw size={16} /> Try again
              </Button>
            </div>
          ) : (
            <div className="booth-live">
              <FramePreview video={cam.video} frame={prefs.frame} mirror={prefs.mirror} eventName={eventName} date={date} className="booth-canvas" label="Camera preview in the frame" />
              {count !== null ? (
                <b key={count} className="booth-count num" aria-live="assertive">
                  {count}
                </b>
              ) : null}
              {flash ? <div className="booth-flash" aria-hidden="true" /> : null}
            </div>
          )}
        </section>

        <aside className="booth-side">
          {kept ? (
            <div className="card booth-panel">
              <div className="row between wrap">
                <h2>Photo {kept.number}</h2>
                <Button size="sm" variant="ghost" onClick={() => setCurrent(null)}>
                  <Camera size={16} /> Take another
                </Button>
              </div>
              <p className="muted small">
                {kept.name || 'No name'}
                {kept.contact ? ` · ${kept.contact}` : ''} · kept {fmtDate(kept.at)} with their yes
              </p>
              {kept.usedFor ? (
                <Callout tone={kept.drive?.state === 'saved' ? 'good' : 'info'}>
                  Used for service order <b>{kept.usedFor.number}</b>, so it stays as long as the order does.{' '}
                  {kept.drive?.state === 'saved' ? (
                    <>
                      It’s in Google Drive → JoshWorks POS → Booth photos{kept.drive.url ? <> (<a href={kept.drive.url} target="_blank" rel="noreferrer">open</a>)</> : null}.
                    </>
                  ) : (
                    <>
                      Not in Drive yet{kept.drive?.error ? `: ${kept.drive.error}` : ''}.{' '}
                      <Button variant="link" size="sm" onClick={() => void retryDrive(kept)}>
                        Try again
                      </Button>
                    </>
                  )}
                </Callout>
              ) : (
                <>
                  <p className="booth-actions-label">Turn it into an order</p>
                  <div className="booth-actions">
                    <Button variant="primary" onClick={() => navigate(`/print?photo=${kept.id}`)}>
                      <Printer size={18} /> Sticker printing order
                    </Button>
                    <Button onClick={() => navigate(`/print?photo=${kept.id}&as=illustration`)}>
                      <Palette size={18} /> Illustration request
                    </Button>
                  </div>
                  <p className="muted small">Not ordered: deleted from this laptop in {boothDaysLeft(kept)} day{boothDaysLeft(kept) === 1 ? '' : 's'}.</p>
                </>
              )}
              <Field label="Email the photo to" htmlFor="bo-email" hint={kept.emailedTo ? `Sent to ${kept.emailedTo}.` : 'Through the studio mailer, like receipts. Offline, it waits and sends later.'}>
                <div className="row">
                  <TextInput id="bo-email" type="email" className="grow" value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder="name@email.com" />
                  <Button onClick={() => void email(kept)} disabled={busy || !emailTo.trim()}>
                    <Mail size={16} /> Email
                  </Button>
                </div>
              </Field>
              <div className="row wrap">
                <Button size="sm" onClick={() => downloadBlob(kept.blob, boothFileName(kept))}>
                  <Download size={16} /> Save a copy
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void remove(kept)}>
                  <Trash2 size={16} /> Delete
                </Button>
              </div>
            </div>
          ) : shot ? (
            <div className="card booth-panel">
              <h2>May we keep this photo?</h2>
              <Callout tone="info">
                Ask them, as the customer screen does: “We use it only for your order. If you don’t order, we delete it after 30 days.” Keep it only if they say yes.
              </Callout>
              <Field label="Their name" htmlFor="bo-name" hint="Optional.">
                <TextInput id="bo-name" value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Mobile or email" htmlFor="bo-contact" hint="Optional: for their order, or to email the photo.">
                <TextInput id="bo-contact" value={contact} onChange={(e) => setContact(e.target.value)} />
              </Field>
              <div className="booth-actions">
                <Button variant="primary" onClick={() => void keep()} disabled={busy}>
                  They said yes: keep it
                </Button>
                <Button onClick={discard}>
                  <RotateCcw size={16} /> Retake
                </Button>
                <Button variant="ghost" onClick={discard}>
                  <X size={16} /> They said no: delete it
                </Button>
              </div>
            </div>
          ) : (
            <div className="card booth-panel">
              <Button variant="primary" className="booth-shoot" onClick={() => void take()} disabled={!cam.video || count !== null}>
                <Camera size={22} /> {count !== null ? 'Smile…' : 'Take the photo'}
              </Button>
              <p className="muted small">Or press the space bar. A {prefs.countdown ? `${prefs.countdown}-second countdown shows` : 'photo is taken right away'} on both screens.</p>
              <Field label="Frame" htmlFor="bo-frame" hint={boothFrame(prefs.frame).hint}>
                <Segmented label="Frame" value={prefs.frame} options={BOOTH_FRAMES.map((f) => ({ value: f.key, label: f.name }))} onChange={(v) => setPrefs({ frame: v })} full />
              </Field>
              <Field label="Camera" htmlFor="bo-camera" hint="A phone (Phone Link, Camo, DroidCam) or a DSLR (its webcam app, or an HDMI capture card) shows up here as a camera.">
                <Select id="bo-camera" value={cam.deviceId || prefs.camera} onChange={(e) => setPrefs({ camera: e.target.value })}>
                  {!cameras.length ? <option value="">This laptop’s camera</option> : null}
                  {cameras.map((c, i) => (
                    <option key={c.deviceId || i} value={c.deviceId}>
                      {c.label || `Camera ${i + 1}`}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Countdown" htmlFor="bo-count">
                <Select id="bo-count" value={String(prefs.countdown)} onChange={(e) => setPrefs({ countdown: Number(e.target.value) })}>
                  <option value="3">3 seconds</option>
                  <option value="5">5 seconds</option>
                  <option value="0">None</option>
                </Select>
              </Field>
              <Check id="bo-mirror" checked={prefs.mirror} onChange={(v) => setPrefs({ mirror: v })} label="Mirror it" sub="Like a mirror, as people expect. Turn it off if there’s writing on a shirt or a sign." />
            </div>
          )}
        </aside>
      </div>

      <section className="card" aria-label="Kept photos">
        <div className="row between wrap">
          <h2>Kept photos</h2>
          <span className="muted small">On this laptop only. Never in backups or the cloud; photos used for an order are copied to Drive.</span>
        </div>
        {!photos ? null : !photos.length ? (
          <EmptyState icon={<Camera size={36} />} title="No photos kept yet">
            Photos show here once a customer says yes.
          </EmptyState>
        ) : (
          <ul className="booth-list">
            {photos.map((p) => (
              <li key={p.id}>
                <button type="button" className={`booth-thumb${p.id === current ? ' on' : ''}`} onClick={() => open(p)} aria-label={`Photo ${p.number}${p.name ? `, ${p.name}` : ''}`}>
                  <PhotoImg photo={p} className="booth-thumb-img" />
                  <span className="booth-thumb-text">
                    <b className="mono">{p.number}</b>
                    <span>{p.name || 'No name'}</span>
                    {p.usedFor ? <Badge tone="teal">{p.usedFor.number}</Badge> : <span className="muted tiny">Deleted in {boothDaysLeft(p)} d</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
