import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/db';
import { ensureDevice } from '../src/db/local';
import { setWriterDevice } from '../src/db/write';
import { BOOTH_FRAMES, boothDaysLeft, boothExpired, boothFileName, boothFrame, boothNumber, centerSquare } from '../src/domain/booth';
import { cleanBoothPhotos, keepBoothPhoto } from '../src/booth/photos';
import type { BoothPhoto, PrintOrder } from '../src/db/types';

const DAY = 86_400_000;

beforeEach(async () => {
  await db.delete();
  await db.open();
  setWriterDevice((await ensureDevice()).deviceId);
});

describe('photo booth rules', () => {
  it('numbers photos by laptop, and crops the middle square of the camera', () => {
    expect(boothNumber('A', 7)).toBe('BA-007');
    expect(boothNumber('C', 112)).toBe('BC-112');
    expect(centerSquare(1920, 1080)).toEqual({ sx: 420, sy: 0, size: 1080 });
    expect(centerSquare(720, 1280)).toEqual({ sx: 0, sy: 280, size: 720 });
  });

  it('the sticker frame keeps a see-through edge; the others are photos', () => {
    expect(boothFrame('sticker').type).toBe('image/png');
    expect(boothFrame('polaroid').type).toBe('image/jpeg');
    expect(boothFrame('nope').key).toBe(BOOTH_FRAMES[0].key);
  });

  it('an unused photo is deleted after 30 days; one on an order stays while the order does', () => {
    const p = { at: 0, usedFor: null };
    expect(boothDaysLeft(p, 0)).toBe(30);
    expect(boothDaysLeft(p, 29.5 * DAY)).toBe(1);
    expect(boothExpired(p, () => false, 29 * DAY)).toBe(false);
    expect(boothExpired(p, () => false, 30 * DAY)).toBe(true);
    const used = { at: 0, usedFor: { kind: 'print' as const, id: 'po1', number: 'PA-001' } };
    expect(boothExpired(used, (id) => id === 'po1', 400 * DAY)).toBe(false);
    // Its order was deleted: it goes like any other.
    expect(boothExpired(used, () => false, 30 * DAY)).toBe(true);
  });

  it('names the file after the photo and the customer’s first name', () => {
    const blob = new Blob(['x'], { type: 'image/png' });
    expect(boothFileName({ number: 'BA-007', name: 'Leanna Rosales', blob })).toBe('BA-007 Leanna - JoshWorks photo.png');
    expect(boothFileName({ number: 'BA-008', name: '', blob: new Blob(['x'], { type: 'image/jpeg' }) })).toBe('BA-008 - JoshWorks photo.jpg');
  });
});

describe('booth photos on this laptop', () => {
  const device = { deviceId: 'd1', letter: 'A', name: 'Booth laptop' };
  const blob = () => new Blob(['photo'], { type: 'image/png' });

  it('keeps a photo only with a yes, numbered in order', async () => {
    const a = await keepBoothPhoto({ blob: blob(), frame: 'sticker', name: ' Leanna ', contact: '', eventId: 'ev1', by: 'm1', device });
    const b = await keepBoothPhoto({ blob: blob(), frame: 'plain', name: '', contact: 'kaye@jw.test', eventId: 'ev1', by: 'm1', device });
    expect([a.number, b.number]).toEqual(['BA-001', 'BA-002']);
    expect(a).toMatchObject({ name: 'Leanna', consentBy: 'm1', usedFor: null });
    expect(a.consentAt).toBeGreaterThan(0);
    expect(await db.boothPhotos.count()).toBe(2);
  });

  it('the clean-up deletes old unused photos and photos of deleted orders, and keeps the rest', async () => {
    const now = Date.now();
    const photo = (id: string, ageDays: number, orderId?: string): BoothPhoto => ({
      id, number: id, at: now - ageDays * DAY, blob: blob(), frame: 'sticker', name: '', contact: '', eventId: null, consentAt: now, consentBy: null,
      usedFor: orderId ? { kind: 'print', id: orderId, number: 'PA-001' } : null,
    });
    await db.printOrders.bulkPut([{ id: 'live', deleted: 0 } as PrintOrder, { id: 'gone', deleted: 1 } as PrintOrder]);
    await db.boothPhotos.bulkPut([photo('old', 31), photo('new', 3), photo('ordered', 90, 'live'), photo('orphan', 45, 'gone')]);
    expect(await cleanBoothPhotos(now)).toBe(2);
    expect((await db.boothPhotos.toArray()).map((p) => p.id).sort()).toEqual(['new', 'ordered']);
  });
});
