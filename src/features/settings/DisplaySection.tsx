import { useEffect, useMemo, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowDown, ArrowUp, Film, ImagePlus, Trash2 } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { db } from '../../db/db';
import { setLocal } from '../../db/local';
import { useLocal } from '../../hooks/data';
import { Button, IconButton, Segmented, Toggle } from '../../components/ui';
import { Field, NumberInput } from '../../components/form';
import { uid } from '../../lib/ids';
import { DEFAULT_DISPLAY, type DisplaySettings } from '../../display/slides';
import type { DisplayMedia } from '../../db/types';

/** Big videos make the device slow to open: anything over this is refused. */
const MAX_MB = 150;

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
  const set = (ch: Partial<DisplaySettings>) => void setLocal('display', { ...s, ...ch });

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
  const patch = (m: DisplayMedia, ch: Partial<DisplayMedia>) => void db.displayMedia.update(m.id, ch);
  const move = async (k: number, by: -1 | 1) => {
    if (!media) return;
    const a = media[k];
    const b = media[k + by];
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
      </div>
      <div className="stack tight">
        <div className="row between wrap">
          <b>Your ads</b>
          <Button size="sm" onClick={() => fileRef.current?.click()}>
            <ImagePlus size={16} /> Add images or videos
          </Button>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm" multiple hidden aria-label="Ad images or videos" onChange={(e) => void add(e.target.files)} />
        </div>
        <p className="muted small">Posters (JPG or PNG, 16:9 looks best) and short MP4 videos, up to {MAX_MB} MB each. Videos play to the end, without sound.</p>
        {media?.length ? (
          <div className="card flush">
            <div className="list">
              {media.map((m, k) => (
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
                  <IconButton label={`Move ${m.name} up`} size="sm" plain disabled={k === 0} onClick={() => void move(k, -1)}>
                    <ArrowUp size={15} />
                  </IconButton>
                  <IconButton label={`Move ${m.name} down`} size="sm" plain disabled={k === media.length - 1} onClick={() => void move(k, 1)}>
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
    </section>
  );
}

function AdThumb({ m }: { m: DisplayMedia }) {
  const url = useMemo(() => URL.createObjectURL(m.blob), [m.blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return <img src={url} alt="" className="ad-thumb" />;
}
