import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowDown, ArrowUp, CloudDownload, Disc3, ExternalLink, Film, ImagePlus, Music2, Pause, Play, Trash2, Volume2 } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { db } from '../../db/db';
import { setLocal } from '../../db/local';
import { useLocal } from '../../hooks/data';
import { Button, Callout, IconButton, Segmented, Toggle } from '../../components/ui';
import { Field, NumberInput, Select } from '../../components/form';
import { uid } from '../../lib/ids';
import { DEFAULT_DISPLAY, type DisplaySettings } from '../../display/slides';
import { refreshStickers } from '../../display/stickers';
import { callOrder, loadVoices, rankVoices } from '../../display/voice';
import { DriveError, driveFolders } from '../../drive/drive';
import { playLanding, playSpin, unlockAudio } from '../../display/sound';
import { wheelSoundChoice } from '../../display/wheelSounds';
import { landingTurn, type WheelSlice } from '../../domain/wheel';
import { relativeTime } from '../../lib/time';
import type { DisplayMedia } from '../../db/types';
import { SAMPLE_KINDS, SAMPLE_KIND_NAME, sampleKindFromName, type SampleKind } from '../../domain/stick';

/** Big videos make the device slow to open: anything over this is refused. */
const MAX_MB = 150;
/** Music and sound files. */
const MAX_AUDIO_MB = 40;
/** Eight even slices, for trying the wheel's sounds. */
const TEST_SLICES: WheelSlice[] = Array.from({ length: 8 }, (_, i) => ({ id: String(i), label: '', from: i * 45, to: (i + 1) * 45 }));

/**
 * Settings → Customer screen: how long before the idle slides, what plays, and
 * the owner's own ads. All of it stays on this device, the one that runs the
 * second monitor.
 */
export function DisplaySection() {
  const app = useApp();
  const saved = useLocal<Partial<DisplaySettings>>('display', DEFAULT_DISPLAY);
  const s: DisplaySettings = { ...DEFAULT_DISPLAY, ...(saved ?? {}) };
  const media = useLiveQuery(() => db.displayMedia.orderBy('sort').toArray(), []);
  const fileRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLInputElement>(null);
  const ads = media?.filter((m) => m.kind !== 'audio' && m.role !== 'sample');
  const samples = media?.filter((m) => m.role === 'sample') ?? [];
  const sampleRef = useRef<HTMLInputElement>(null);
  const audioFiles = media?.filter((m) => m.kind === 'audio');
  const soundFiles = audioFiles?.filter((m) => m.role === 'sound') ?? [];
  const [testing, setTesting] = useState(false);
  const testWheel = async () => {
    await unlockAudio();
    const c = await wheelSoundChoice({ ...s, wheelSound: true });
    if (!c) return;
    setTesting(true);
    const ms = 4000;
    playSpin(TEST_SLICES, landingTurn(TEST_SLICES, '3', 0.5, 4), ms, c);
    window.setTimeout(() => {
      playLanding(true, c);
      setTesting(false);
    }, ms + 150);
  };
  const addAudio = async (files: FileList | null) => {
    let added = 0;
    for (const [i, file] of [...(files ?? [])].entries()) {
      if (!file.type.startsWith('audio/')) {
        app.toast(`${file.name} isn’t a music or sound file (MP3, M4A, WAV or OGG).`, { tone: 'bad' });
        continue;
      }
      if (file.size > MAX_AUDIO_MB * 1024 * 1024) {
        app.toast(`${file.name} is over ${MAX_AUDIO_MB} MB.`, { tone: 'bad' });
        continue;
      }
      const last = media?.length ? media[media.length - 1].sort : 0;
      // Short files are most likely sound effects; songs are music.
      await db.displayMedia.put({ id: uid(), name: file.name.replace(/\.[^.]+$/, ''), kind: 'audio', role: file.size < 1.5 * 1024 * 1024 ? 'sound' : 'music', mime: file.type, blob: file, seconds: 0, on: 1, sort: last + i + 1, addedAt: Date.now() });
      added++;
    }
    if (audioRef.current) audioRef.current.value = '';
    if (added) app.toast(`${added} file${added === 1 ? '' : 's'} added`, { tone: 'good' });
  };
  const set = (ch: Partial<DisplaySettings>) => void setLocal('display', { ...s, ...ch });
  const art = useLiveQuery(() => db.stickerArt.count(), []);
  const synced = useLocal<{ at: number; total: number } | null>('stickerSync', null);
  const [checking, setChecking] = useState(false);
  const [driveNote, setDriveNote] = useState<{ tone: 'bad' | 'info'; text: string } | null>(null);
  const [folder, setFolder] = useState('');
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    void loadVoices().then((v) => setVoices(rankVoices(v)));
  }, []);
  const checkDrive = async () => {
    setChecking(true);
    setDriveNote(null);
    try {
      const r = await refreshStickers();
      app.toast(`${r.total} design${r.total === 1 ? '' : 's'} in Drive${r.added ? `, ${r.added} new` : ''}${r.removed ? `, ${r.removed} taken out` : ''}`, { tone: 'good' });
      setFolder((await driveFolders().catch(() => null))?.stickers ?? '');
    } catch (e) {
      setDriveNote({ tone: e instanceof DriveError && e.kind === 'offline' ? 'info' : 'bad', text: e instanceof Error ? e.message : 'Couldn’t check Drive' });
    } finally {
      setChecking(false);
    }
  };

  const add = async (files: FileList | null) => {
    const list = [...(files ?? [])];
    let added = 0;
    for (const [i, file] of list.entries()) {
      const kind = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : null;
      if (!kind) {
        app.toast(`${file.name} isn’t an image or a video.`, { tone: 'bad' });
        continue;
      }
      if (file.size > MAX_MB * 1024 * 1024) {
        app.toast(`${file.name} is over ${MAX_MB} MB. Export a shorter or smaller video.`, { tone: 'bad' });
        continue;
      }
      const last = media?.length ? media[media.length - 1].sort : 0;
      await db.displayMedia.put({ id: uid(), name: file.name.replace(/\.[^.]+$/, ''), kind, mime: file.type, blob: file, seconds: 8, on: 1, sort: last + i + 1, addedAt: Date.now() });
      added++;
    }
    if (fileRef.current) fileRef.current.value = '';
    if (added) app.toast(`${added} ad${added === 1 ? '' : 's'} added to the customer screen`, { tone: 'good' });
  };
  /** Stickers made for past customers: the file name says the pack ("Couple - Eliza & Renz.png"), or it's set here. */
  const addSamples = async (files: FileList | null) => {
    let added = 0;
    for (const [i, file] of [...(files ?? [])].entries()) {
      if (!file.type.startsWith('image/')) {
        app.toast(`${file.name} isn’t an image.`, { tone: 'bad' });
        continue;
      }
      if (file.size > MAX_MB * 1024 * 1024) {
        app.toast(`${file.name} is over ${MAX_MB} MB.`, { tone: 'bad' });
        continue;
      }
      const last = media?.length ? media[media.length - 1].sort : 0;
      const name = file.name.replace(/\.[^.]+$/, '');
      await db.displayMedia.put({ id: uid(), name, kind: 'image', role: 'sample', sample: sampleKindFromName(name) ?? 'couple', mime: file.type, blob: file, seconds: 0, on: 1, sort: last + i + 1, addedAt: Date.now() });
      added++;
    }
    if (sampleRef.current) sampleRef.current.value = '';
    if (added) app.toast(`${added} sample${added === 1 ? '' : 's'} added`, { tone: 'good' });
  };
  const patch = (m: DisplayMedia, ch: Partial<DisplayMedia>) => void db.displayMedia.update(m.id, ch);
  const move = async (list: DisplayMedia[] | undefined, k: number, by: -1 | 1) => {
    if (!list) return;
    const a = list[k];
    const b = list[k + by];
    if (!a || !b) return;
    await db.transaction('rw', db.displayMedia, async () => {
      await db.displayMedia.update(a.id, { sort: b.sort });
      await db.displayMedia.update(b.id, { sort: a.sort });
    });
  };
  const remove = async (m: DisplayMedia) => {
    if (await app.confirm({ title: `Remove ${m.name}?`, message: 'It stops playing on the customer screen and is deleted from this device.', confirmLabel: 'Remove', tone: 'danger' })) await db.displayMedia.delete(m.id);
  };

  return (
    <section id="s-display" className="card pad-lg stack" style={{ scrollMarginTop: 80 }}>
      <h2>Customer screen</h2>
      <p className="sub">The screen customers see on a second monitor (Sell → Customer screen). These settings and your ads stay on this device.</p>
      <div className="form-grid">
        <Field label="Idle slides start after" htmlFor="ds-idle">
          <Segmented<string>
            label="Idle slides start after"
            value={String(s.idleSeconds)}
            onChange={(v) => set({ idleSeconds: Number(v) })}
            options={[
              { value: '20', label: '20 s' },
              { value: '30', label: '30 s' },
              { value: '60', label: '1 min' },
            ]}
          />
        </Field>
        <Field label="Each slide shows for" htmlFor="ds-slide">
          <NumberInput id="ds-slide" decimals={false} min={3} value={s.slideSeconds} onChange={(n) => set({ slideSeconds: Math.min(60, Math.max(3, Math.round(n ?? 8))) })} suffix="s" />
        </Field>
      </div>
      <div className="stack tight">
        <Toggle id="ds-side" checked={s.sideAds} onChange={(v) => set({ sideAds: v })} label="Play slides beside the cart while a customer is buying" />
        <Toggle id="ds-prices" checked={s.priceSlides} onChange={(v) => set({ priceSlides: v })} label="Price slides: this event’s prices, bundle deals, printing and illustration rates, the booth coupon" />
        <Toggle id="ds-best" checked={s.bestSellers} onChange={(v) => set({ bestSellers: v })} label="Best sellers today (after 3 products have sold)" />
        <Toggle id="ds-own" checked={s.ownAds} onChange={(v) => set({ ownAds: v })} label="Your own ads, between the slides" />
        <Toggle id="ds-stickers" checked={s.driveStickers} onChange={(v) => set({ driveStickers: v })} label="Custom sticker designs from Google Drive" />
        <Toggle id="ds-call" checked={s.callOut} onChange={(v) => set({ callOut: v })} label="Call ready orders out loud: a chime, then “Order Q A zero seven, your order is ready”" />
        {s.callOut ? (
          <div className="row wrap" style={{ alignItems: 'flex-end' }}>
            <Field label="Voice" htmlFor="ds-voice" hint="“Needs internet” voices sound the most natural; with no signal it uses one that works offline." className="grow">
              <Select id="ds-voice" value={s.voice} onChange={(e) => set({ voice: e.target.value })}>
                <option value="">The best woman’s voice on this laptop</option>
                {voices.map((v) => (
                  <option key={v.name} value={v.name}>
                    {v.name} · {v.localService ? 'works offline' : 'needs internet'}
                  </option>
                ))}
              </Select>
            </Field>
            <Button size="sm" onClick={() => void callOrder('QA-07', 'Leanna', s.voice)}>
              <Volume2 size={16} /> Test the voice
            </Button>
          </div>
        ) : null}
      </div>
      <div className="stack tight" aria-label="Sounds and music" role="group">
        <b>Sounds and music</b>
        <p className="muted small">
          The customer screen plays sound once someone clicks it: its <b>Full screen and sound</b> button, or a customer tapping the prize wheel. If it can’t, the register plays the wheel’s sounds instead.
        </p>
        <Toggle id="ds-wheel-sound" checked={s.wheelSound} onChange={(v) => set({ wheelSound: v })} label="Prize wheel sounds: a tick for each slice, an upbeat tune while it spins, a fanfare for a prize" />
        {s.wheelSound ? (
          <div className="form-grid">
            <Field label="Tune while it spins" htmlFor="ds-tune">
              <Select id="ds-tune" value={s.spinTune} onChange={(e) => set({ spinTune: e.target.value })}>
                <option value="">The built-in upbeat tune</option>
                <option value="none">Ticks only</option>
                {soundFiles.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Prize sound" htmlFor="ds-win">
              <Select id="ds-win" value={s.winSound} onChange={(e) => set({ winSound: e.target.value })}>
                <option value="">The built-in fanfare</option>
                {soundFiles.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={`Wheel volume: ${s.soundVolume}%`} htmlFor="ds-vol">
              <input id="ds-vol" type="range" min={0} max={100} step={5} value={s.soundVolume} onChange={(e) => set({ soundVolume: Number(e.target.value) })} className="range" />
            </Field>
            <div style={{ alignSelf: 'end' }}>
              <Button size="sm" onClick={() => void testWheel()} disabled={testing}>
                <Disc3 size={16} /> {testing ? 'Spinning…' : 'Test the wheel sounds'}
              </Button>
            </div>
          </div>
        ) : null}
        <Toggle id="ds-music" checked={s.music} onChange={(v) => set({ music: v })} label="Background music from your files" />
        {s.music ? (
          <div className="form-grid">
            <Field label="Music plays" htmlFor="ds-music-when">
              <Segmented<DisplaySettings['musicWhen']>
                label="Music plays"
                value={s.musicWhen}
                onChange={(v) => set({ musicWhen: v })}
                options={[
                  { value: 'always', label: 'All the time' },
                  { value: 'idle', label: 'Only on the idle slides' },
                ]}
              />
            </Field>
            <Field label={`Music volume: ${s.musicVolume}%`} htmlFor="ds-music-vol">
              <input id="ds-music-vol" type="range" min={0} max={100} step={5} value={s.musicVolume} onChange={(e) => set({ musicVolume: Number(e.target.value) })} className="range" />
            </Field>
          </div>
        ) : null}
        <Toggle id="ds-video-sound" checked={s.videoSound} onChange={(v) => set({ videoSound: v })} label="Play your ad videos with their sound (full screen; the music waits)" />
        <div className="row between wrap">
          <b className="small">Your music and sounds</b>
          <Button size="sm" onClick={() => audioRef.current?.click()}>
            <Music2 size={16} /> Add music or sounds
          </Button>
          <input ref={audioRef} type="file" accept="audio/*" multiple hidden aria-label="Music or sound files" onChange={(e) => void addAudio(e.target.files)} />
        </div>
        {audioFiles?.length ? (
          <div className="card flush">
            <div className="list">
              {audioFiles.map((m, k) => (
                <div key={m.id} className="list-item ad-row">
                  <Music2 size={24} className="muted" aria-hidden="true" />
                  <span className="main-text">
                    <b>{m.name}</b>
                    <span>{m.role === 'sound' ? 'A sound for the wheel' : 'Background music'}</span>
                  </span>
                  <Select aria-label={`What ${m.name} is`} value={m.role ?? 'music'} onChange={(e) => patch(m, { role: e.target.value as 'music' | 'sound' })} style={{ width: 'auto' }}>
                    <option value="music">Music</option>
                    <option value="sound">Wheel sound</option>
                  </Select>
                  <PreviewButton m={m} />
                  <Toggle id={`au-on-${m.id}`} checked={m.on === 1} onChange={(v) => patch(m, { on: v ? 1 : 0 })} label={<span className="sr-only">Play {m.name}</span>} />
                  <IconButton label={`Move ${m.name} up`} size="sm" plain disabled={k === 0} onClick={() => void move(audioFiles, k, -1)}>
                    <ArrowUp size={15} />
                  </IconButton>
                  <IconButton label={`Remove ${m.name}`} size="sm" plain onClick={() => void remove(m)}>
                    <Trash2 size={15} />
                  </IconButton>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="muted small">No files yet. Add songs (MP3 or M4A) for background music, or short sounds for the wheel’s tune and prize. They stay on this laptop.</p>
        )}
      </div>
      {s.driveStickers ? (
        <div className="stack tight">
          <b>Custom stickers from Google Drive</b>
          <p className="muted small">
            Put finished designs in Drive → JoshWorks POS → Custom stickers, named like <span className="mono">CS01-Couple.png</span>. The screen shows each one with its number and name,
            and the order’s status when the number matches an order. It checks every 5 minutes while online and keeps them for offline.
          </p>
          <div className="row wrap">
            <Button size="sm" onClick={() => void checkDrive()} disabled={checking}>
              <CloudDownload size={16} /> {checking ? 'Checking Drive…' : 'Check Drive now'}
            </Button>
            {folder ? (
              <a className="btn sm ghost" href={folder} target="_blank" rel="noreferrer">
                <ExternalLink size={16} /> Open the folder
              </a>
            ) : null}
            <span className="muted small" role="status">
              {art ? `${art} design${art === 1 ? '' : 's'} on this device` : 'No designs yet'}
              {synced ? `, checked ${relativeTime(synced.at)}` : ''}
            </span>
          </div>
          {driveNote ? <Callout tone={driveNote.tone}>{driveNote.text}</Callout> : null}
        </div>
      ) : null}
      <div className="stack tight">
        <div className="row between wrap">
          <b>Your ads</b>
          <Button size="sm" onClick={() => fileRef.current?.click()}>
            <ImagePlus size={16} /> Add images or videos
          </Button>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm" multiple hidden aria-label="Ad images or videos" onChange={(e) => void add(e.target.files)} />
        </div>
        <p className="muted small">Posters (JPG or PNG; 16:9 for a wide screen, 9:16 for a tall one) and short MP4 videos, up to {MAX_MB} MB each. Videos play to the end{s.videoSound ? ', with their sound when full screen' : ', without sound'}.</p>
        {ads?.length ? (
          <div className="card flush">
            <div className="list">
              {ads.map((m, k) => (
                <div key={m.id} className="list-item ad-row">
                  {m.kind === 'image' ? <AdThumb m={m} /> : <Film size={28} className="muted" aria-hidden="true" />}
                  <span className="main-text">
                    <b>{m.name}</b>
                    <span>{m.kind === 'video' ? 'Video, plays to the end' : `Image, ${m.seconds} s`}</span>
                  </span>
                  {m.kind === 'image' ? (
                    <div style={{ width: 92 }}>
                      <NumberInput ariaLabel={`Seconds for ${m.name}`} decimals={false} min={3} value={m.seconds} onChange={(n) => patch(m, { seconds: Math.min(120, Math.max(3, Math.round(n ?? 8))) })} suffix="s" />
                    </div>
                  ) : null}
                  <Toggle id={`ad-on-${m.id}`} checked={m.on === 1} onChange={(v) => patch(m, { on: v ? 1 : 0 })} label={<span className="sr-only">Play {m.name}</span>} />
                  <IconButton label={`Move ${m.name} up`} size="sm" plain disabled={k === 0} onClick={() => void move(ads, k, -1)}>
                    <ArrowUp size={15} />
                  </IconButton>
                  <IconButton label={`Move ${m.name} down`} size="sm" plain disabled={k === ads.length - 1} onClick={() => void move(ads, k, 1)}>
                    <ArrowDown size={15} />
                  </IconButton>
                  <IconButton label={`Remove ${m.name}`} size="sm" plain onClick={() => void remove(m)}>
                    <Trash2 size={15} />
                  </IconButton>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="muted small">No ads yet. The price slides play on their own.</p>
        )}
      </div>
      <div className="stack tight" role="group" aria-label="Sample stickers">
        <div className="row between wrap">
          <b>Couple-of-Stickers samples</b>
          <Button size="sm" onClick={() => sampleRef.current?.click()}>
            <ImagePlus size={16} /> Add samples
          </Button>
          <input ref={sampleRef} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden aria-label="Sample sticker images" onChange={(e) => void addSamples(e.target.files)} />
        </div>
        <p className="muted small">
          Stickers you made before, shown while a customer checks their order: Solo samples with a Solo Pack, Couple with a Couple Pack, Barkada with a Barkada Pack. Files named “Solo - …”, “Couple - …” or “Barkada - …” sort themselves. They stay on this laptop and never go online: add only ones those customers are happy to have shown.
        </p>
        {samples.length ? (
          <>
            <p className="small" role="status">
              {SAMPLE_KINDS.map((k) => `${samples.filter((m) => m.on === 1 && (m.sample ?? 'couple') === k).length} ${SAMPLE_KIND_NAME[k]}`).join(' · ')}
            </p>
            <div className="card flush">
              <div className="list">
                {samples.map((m) => (
                  <div key={m.id} className="list-item ad-row">
                    <AdThumb m={m} />
                    <span className="main-text">
                      <b>{m.name}</b>
                    </span>
                    <Select aria-label={`Pack for ${m.name}`} value={m.sample ?? 'couple'} onChange={(e) => patch(m, { sample: e.target.value as SampleKind })} style={{ width: 'auto' }}>
                      {SAMPLE_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {SAMPLE_KIND_NAME[k]}
                        </option>
                      ))}
                    </Select>
                    <Toggle id={`sm-on-${m.id}`} checked={m.on === 1} onChange={(v) => patch(m, { on: v ? 1 : 0 })} label={<span className="sr-only">Show {m.name}</span>} />
                    <IconButton label={`Remove ${m.name}`} size="sm" plain onClick={() => void remove(m)}>
                      <Trash2 size={15} />
                    </IconButton>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <p className="muted small">No samples yet. The order shows without them.</p>
        )}
      </div>
    </section>
  );
}

function AdThumb({ m }: { m: DisplayMedia }) {
  const url = useMemo(() => URL.createObjectURL(m.blob), [m.blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return <img src={url} alt="" className="ad-thumb" />;
}

/** Listen to a music or sound file before using it. */
function PreviewButton({ m }: { m: DisplayMedia }) {
  const [playing, setPlaying] = useState(false);
  const ref = useRef<HTMLAudioElement | null>(null);
  useEffect(
    () => () => {
      ref.current?.pause();
      if (ref.current) URL.revokeObjectURL(ref.current.src);
    },
    [],
  );
  const toggle = () => {
    if (playing && ref.current) {
      ref.current.pause();
      setPlaying(false);
      return;
    }
    if (!ref.current) {
      ref.current = new Audio(URL.createObjectURL(m.blob));
      ref.current.onended = () => setPlaying(false);
    }
    void ref.current.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  };
  return (
    <IconButton label={playing ? `Stop ${m.name}` : `Play ${m.name}`} size="sm" plain onClick={toggle}>
      {playing ? <Pause size={15} /> : <Play size={15} />}
    </IconButton>
  );
}
