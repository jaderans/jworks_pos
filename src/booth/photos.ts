import { alive, db } from '../db/db';
import { audit, patch } from '../db/write';
import { getLocal, setLocal, type DeviceInfo } from '../db/local';
import { getSetting } from '../db/settings';
import { uid } from '../lib/ids';
import { boothExpired, boothFileName, boothNumber } from '../domain/booth';
import { saveToDrive, DriveError } from '../drive/drive';
import { blobToAttachment, isEmail } from '../email/send';
import { boothPhotoEmail } from '../email/templates';
import { flushOutbox, queueEmail } from '../email/outbox';
import type { BoothPhoto, BusinessSettings, PrintOrder, PrintRates } from '../db/types';

/**
 * Booth photos on this laptop: kept with the customer's yes, used for a
 * service order (and then copied to Drive → Booth photos), emailed to them,
 * and deleted after 30 days when no order uses them.
 */

export async function keepBoothPhoto(o: { blob: Blob; frame: string; name: string; contact: string; eventId: string | null; by: string | null; device: DeviceInfo }): Promise<BoothPhoto> {
  const seq = (await getLocal<number>('boothSeq', 0)) + 1;
  await setLocal('boothSeq', seq);
  const now = Date.now();
  const photo: BoothPhoto = {
    id: uid(),
    number: boothNumber(o.device.letter, seq),
    at: now,
    blob: o.blob,
    frame: o.frame,
    name: o.name.trim(),
    contact: o.contact.trim(),
    eventId: o.eventId,
    consentAt: now,
    consentBy: o.by,
    usedFor: null,
    drive: null,
  };
  await db.boothPhotos.put(photo);
  await audit('create', 'boothPhoto', photo.id, `Booth photo ${photo.number} kept with the customer’s yes${photo.name ? ` (${photo.name})` : ''}`);
  return photo;
}

export async function updateBoothPhoto(id: string, changes: Partial<Pick<BoothPhoto, 'name' | 'contact'>>): Promise<void> {
  await db.boothPhotos.update(id, { ...(changes.name !== undefined ? { name: changes.name.trim() } : {}), ...(changes.contact !== undefined ? { contact: changes.contact.trim() } : {}) });
}

export async function deleteBoothPhoto(id: string): Promise<void> {
  const p = await db.boothPhotos.get(id);
  if (!p) return;
  await db.boothPhotos.delete(id);
  await audit('delete', 'boothPhoto', id, `Booth photo ${p.number} deleted`);
}

/** Copy a photo used for an order to Drive → Booth photos, and put the link on the order. */
export async function sendBoothPhotoToDrive(id: string): Promise<'saved' | 'waiting'> {
  const p = await db.boothPhotos.get(id);
  if (!p?.usedFor) return 'waiting';
  if (p.drive?.state === 'saved') return 'saved';
  try {
    const { url } = await saveToDrive('photos', boothFileName(p), p.blob);
    await db.boothPhotos.update(id, { drive: { state: 'saved', url } });
    const order = await db.printOrders.get(p.usedFor.id);
    if (url && order && order.deleted !== 1 && !order.files.includes(url)) await patch(db.printOrders, order.id, { files: order.files ? `${order.files}\n${url}` : url });
    return 'saved';
  } catch (e) {
    const error = e instanceof DriveError || e instanceof Error ? e.message : 'Couldn’t save it to Drive.';
    await db.boothPhotos.update(id, { drive: { state: 'waiting', error } });
    return 'waiting';
  }
}

/** The photo is for this order: it stays as long as the order does, and goes to Drive for the studio. */
export async function attachBoothPhoto(id: string, order: Pick<PrintOrder, 'id' | 'number'>): Promise<'saved' | 'waiting'> {
  const p = await db.boothPhotos.get(id);
  if (!p) return 'waiting';
  await db.boothPhotos.update(id, { usedFor: { kind: 'print', id: order.id, number: order.number } });
  await audit('update', 'boothPhoto', id, `Booth photo ${p.number} used for service order ${order.number}`);
  return sendBoothPhotoToDrive(id);
}

/** Delete photos past 30 days that no order uses. */
export async function cleanBoothPhotos(now = Date.now()): Promise<number> {
  const photos = await db.boothPhotos.toArray();
  if (!photos.length) return 0;
  const orders = new Set(alive(await db.printOrders.toArray()).map((o) => o.id));
  const gone = photos.filter((p) => boothExpired(p, (oid) => orders.has(oid), now)).map((p) => p.id);
  if (gone.length) {
    await db.boothPhotos.bulkDelete(gone);
    await audit('delete', 'boothPhoto', null, `${gone.length} booth photo${gone.length === 1 ? '' : 's'} deleted after 30 days`);
  }
  return gone.length;
}

/** Email the framed photo to the customer, through the studio mailer (queued while offline). */
export async function emailBoothPhoto(id: string, to: string, eventName: string): Promise<void> {
  const p = await db.boothPhotos.get(id);
  if (!p) throw new Error('That photo was deleted.');
  const addr = to.trim().toLowerCase();
  if (!isEmail(addr)) throw new Error('Type their email address.');
  const business = await getSetting<BusinessSettings>('business');
  const rates = await getSetting<PrintRates>('printRates');
  const from = Math.min(...rates.illustration.tiers.map((t) => t.price).filter((x) => x > 0));
  await queueEmail({
    kind: 'photo',
    saleId: null,
    to: addr,
    toName: p.name,
    mail: boothPhotoEmail(business, { customerName: p.name, number: p.number, eventName, illustrationFrom: Number.isFinite(from) ? from : 0 }),
    attachments: [await blobToAttachment(boothFileName(p), p.blob)],
  });
  await db.boothPhotos.update(id, { emailedTo: addr, ...(p.contact ? {} : { contact: addr }) });
  void flushOutbox();
}

let started = false;

/** Clean up at start and once a day; copy waiting photos to Drive when back online. */
export function startBoothPhotos(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  const retry = async () => {
    const waiting = (await db.boothPhotos.toArray()).filter((p) => p.usedFor && p.drive?.state !== 'saved');
    for (const p of waiting) if ((await sendBoothPhotoToDrive(p.id)) === 'waiting') break;
  };
  const run = () => {
    void cleanBoothPhotos().catch(() => 0);
    if (navigator.onLine) void retry().catch(() => undefined);
  };
  window.addEventListener('online', () => void retry().catch(() => undefined));
  window.setInterval(run, 6 * 3_600_000);
  run();
}
