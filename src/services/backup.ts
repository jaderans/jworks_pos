import { db, SYNCED_TABLES, syncedTable, type SyncedTableName } from '../db/db';
import { ensureDevice } from '../db/local';
import { audit } from '../db/write';
import { readFileAsDataURL } from '../lib/files';
import type { Syncable } from '../db/types';

/**
 * Backups and device merges use the same file: every synced record with its
 * updatedAt. Merging keeps the newer copy of each record, so importing the
 * same file twice, or files from two phones, can never double a sale.
 */

export interface BackupFile {
  app: 'jworks-pos';
  version: 1;
  exportedAt: number;
  device: { deviceId: string; letter: string; name: string };
  tables: Partial<Record<SyncedTableName, Syncable[]>>;
  photos?: { id: string; mime: string; at: number; dataUrl: string }[];
}

export async function exportAll(includePhotos = false): Promise<BackupFile> {
  const device = await ensureDevice();
  const tables: BackupFile['tables'] = {};
  for (const name of SYNCED_TABLES) {
    const rows = (await syncedTable(name).toArray()) as Syncable[];
    tables[name] = rows.map(({ _sync, ...rest }) => rest as Syncable);
  }
  const file: BackupFile = { app: 'jworks-pos', version: 1, exportedAt: Date.now(), device, tables };
  if (includePhotos) {
    const photos = await db.photos.toArray();
    file.photos = await Promise.all(photos.map(async (p) => ({ id: p.id, mime: p.mime, at: p.at, dataUrl: await readFileAsDataURL(p.blob) })));
  }
  return file;
}

export function backupBlob(file: BackupFile): Blob {
  return new Blob([JSON.stringify(file)], { type: 'application/json' });
}

export function parseBackup(text: string): BackupFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This file isn’t a JoshWorks POS backup (it isn’t valid JSON).');
  }
  const f = data as Partial<BackupFile>;
  if (!f || f.app !== 'jworks-pos' || typeof f.tables !== 'object' || f.tables === null) {
    throw new Error('This file isn’t a JoshWorks POS backup.');
  }
  if (f.version !== 1) throw new Error('This backup was made by a newer version of the app. Update the app, then try again.');
  for (const [name, rows] of Object.entries(f.tables)) {
    if (!(SYNCED_TABLES as readonly string[]).includes(name)) continue;
    if (!Array.isArray(rows)) throw new Error(`The backup's ${name} section is damaged.`);
    for (const r of rows as Syncable[]) {
      if (!r || typeof r.id !== 'string' || typeof r.updatedAt !== 'number') throw new Error(`The backup's ${name} section has a damaged record.`);
    }
  }
  return f as BackupFile;
}

export interface MergeStats {
  added: number;
  updated: number;
  unchanged: number;
  byTable: Record<string, { added: number; updated: number }>;
}

/** Newer wins; on a tie the higher device id wins, so every device ends with the same result. */
export function isNewer(incoming: Syncable, local: Syncable | undefined): boolean {
  if (!local) return true;
  if (incoming.updatedAt !== local.updatedAt) return incoming.updatedAt > local.updatedAt;
  return (incoming._dev ?? '') > (local._dev ?? '');
}

export async function mergeBackup(file: BackupFile, opts: { markForUpload: boolean } = { markForUpload: true }): Promise<MergeStats> {
  const stats: MergeStats = { added: 0, updated: 0, unchanged: 0, byTable: {} };
  const names = SYNCED_TABLES.filter((n) => Array.isArray(file.tables[n]));
  await db.transaction('rw', names.map((n) => syncedTable(n)), async () => {
    for (const name of names) {
      const table = syncedTable(name);
      const incoming = file.tables[name] as Syncable[];
      const existing = new Map(((await table.bulkGet(incoming.map((r) => r.id))) as (Syncable | undefined)[]).map((r, i) => [incoming[i].id, r]));
      const toPut: Syncable[] = [];
      let added = 0;
      let updated = 0;
      for (const rec of incoming) {
        const local = existing.get(rec.id);
        if (!isNewer(rec, local)) {
          stats.unchanged++;
          continue;
        }
        if (local) updated++;
        else added++;
        toPut.push({ ...rec, _sync: opts.markForUpload ? 1 : 0 });
      }
      if (toPut.length) await table.bulkPut(toPut);
      stats.added += added;
      stats.updated += updated;
      stats.byTable[name] = { added, updated };
    }
  });
  if (file.photos?.length) {
    for (const p of file.photos) {
      if (await db.photos.get(p.id)) continue;
      const blob = await (await fetch(p.dataUrl)).blob();
      await db.photos.put({ id: p.id, blob, mime: p.mime, at: p.at });
    }
  }
  await audit('merge', 'app', null, `Merged a file from ${file.device?.name ?? 'another device'} (${file.device?.letter ?? '?'}): ${stats.added} new, ${stats.updated} updated`);
  return stats;
}

/** Erase everything on this device (used before restoring onto a device that should match a backup exactly). */
export async function wipeAll(): Promise<void> {
  await db.transaction('rw', SYNCED_TABLES.map((n) => syncedTable(n)), async () => {
    for (const n of SYNCED_TABLES) await syncedTable(n).clear();
  });
}

export function backupFileName(file: BackupFile, kind: 'backup' | 'device'): string {
  const d = new Date(file.exportedAt);
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  return kind === 'device' ? `jworks-pos-device-${file.device.letter}-${stamp}.json` : `jworks-pos-backup-${stamp}.json`;
}
