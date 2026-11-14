import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/db/db';
import { ensureDevice, setLocal } from '../src/db/local';
import { setWriterDevice } from '../src/db/write';
import { parseStickerName, refreshStickers } from '../src/display/stickers';
import { driveStatus, saveToDrive } from '../src/drive/drive';

describe('custom sticker file names', () => {
  it('read the number and the name', () => {
    expect(parseStickerName('CS01-Couple.png')).toEqual({ code: 'CS01', label: 'Couple' });
    expect(parseStickerName('CS02-CoupleSing.png')).toEqual({ code: 'CS02', label: 'Couple Sing' });
    expect(parseStickerName('CS05-Barkada.PNG')).toEqual({ code: 'CS05', label: 'Barkada' });
    expect(parseStickerName('cs10_pet-portrait.png')).toEqual({ code: 'CS10', label: 'Pet portrait' });
    expect(parseStickerName('QA-07 Custom name.png')).toEqual({ code: 'QA07', label: 'Custom name' });
    expect(parseStickerName('Mascot sample.jpg')).toEqual({ code: '', label: 'Mascot sample' });
  });
});

describe('Google Drive through the email script', () => {
  let files: { id: string; name: string; type: string; size: number; updated: number }[] = [];
  const calls: Record<string, unknown>[] = [];
  beforeEach(async () => {
    await db.delete();
    await db.open();
    setWriterDevice((await ensureDevice()).deviceId);
    await setLocal('mailer', { url: 'https://script.google.com/macros/s/TEST/exec', key: 'k' });
    calls.length = 0;
    files = [
      { id: 'f1', name: 'CS01-Couple.png', type: 'image/png', size: 4, updated: 1 },
      { id: 'f2', name: 'CS05-Barkada.png', type: 'image/png', size: 4, updated: 1 },
      { id: 'f3', name: 'notes.txt', type: 'text/plain', size: 4, updated: 1 },
    ];
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as Record<string, unknown>;
      calls.push(body);
      const reply =
        body.ping ? { ok: true, remaining: 90, drive: true }
        : body.action === 'drive.list' ? { ok: true, files }
        : body.action === 'drive.get' ? { ok: true, type: 'image/png', data: btoa('PNG!') }
        : body.action === 'drive.save' ? { ok: true, id: 'new', url: 'https://drive.google.com/file/d/new' }
        : { ok: false, error: 'to' };
      return new Response(JSON.stringify(reply));
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('copies new designs onto the device, then drops the ones taken out of the folder', async () => {
    expect(await refreshStickers()).toEqual({ added: 2, removed: 0, total: 2 });
    const art = await db.stickerArt.orderBy('code').toArray();
    expect(art.map((a) => [a.code, a.label, a.type])).toEqual([['CS01', 'Couple', 'image/png'], ['CS05', 'Barkada', 'image/png']]);
    expect(await art[0].blob.text()).toBe('PNG!');
    // Unchanged files aren't fetched again.
    calls.length = 0;
    expect(await refreshStickers()).toEqual({ added: 0, removed: 0, total: 2 });
    expect(calls.filter((c) => c.action === 'drive.get')).toEqual([]);
    files = files.slice(1);
    expect(await refreshStickers()).toEqual({ added: 0, removed: 1, total: 1 });
    expect((await db.stickerArt.toArray()).map((a) => a.code)).toEqual(['CS05']);
  });

  it('sends the key, saves files, and tells an old script from a new one', async () => {
    expect(await saveToDrive('photos', 'booth.jpg', new Blob(['jpg'], { type: 'image/jpeg' }))).toEqual({ id: 'new', url: 'https://drive.google.com/file/d/new' });
    expect(calls.at(-1)).toMatchObject({ key: 'k', action: 'drive.save', folder: 'photos', file: { name: 'booth.jpg', type: 'image/jpeg' } });
    expect(await driveStatus()).toEqual({ ok: true });
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ ok: true, remaining: 90 })));
    expect(await driveStatus()).toMatchObject({ ok: false, kind: 'old-script' });
    await setLocal('mailer', { url: '', key: '' });
    expect(await driveStatus()).toMatchObject({ ok: false, kind: 'setup' });
  });
});
