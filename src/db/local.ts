import { db } from './db';
import { uid } from '../lib/ids';

/** Values that belong to this device only (never synced). */

export async function getLocal<T>(key: string, fallback: T): Promise<T> {
  const row = await db.local.get(key);
  return row === undefined ? fallback : (row.value as T);
}

export async function setLocal(key: string, value: unknown): Promise<void> {
  await db.local.put({ key, value });
}

export interface DeviceInfo {
  deviceId: string;
  /** Register letter printed on receipts: A-0001, B-0001... */
  letter: string;
  name: string;
}

export async function ensureDevice(): Promise<DeviceInfo> {
  const existing = await getLocal<DeviceInfo | null>('device', null);
  if (existing?.deviceId) return existing;
  const info: DeviceInfo = { deviceId: uid(), letter: 'A', name: 'This device' };
  await setLocal('device', info);
  return info;
}

export async function updateDevice(changes: Partial<DeviceInfo>): Promise<DeviceInfo> {
  const cur = await ensureDevice();
  const next = { ...cur, ...changes, letter: (changes.letter ?? cur.letter).toUpperCase().slice(0, 2) || 'A' };
  await setLocal('device', next);
  return next;
}

/** Next receipt number for this device, reserved atomically. */
export async function nextReceiptSeq(): Promise<number> {
  return db.transaction('rw', db.local, async () => {
    const cur = await getLocal<number>('receiptSeq', 0);
    const next = cur + 1;
    await setLocal('receiptSeq', next);
    return next;
  });
}
