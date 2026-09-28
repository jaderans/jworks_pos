import type { Table } from 'dexie';
import { db } from './db';
import { uid } from '../lib/ids';
import type { AuditEntry, Syncable } from './types';

/**
 * All app writes to synced tables go through these helpers. They stamp
 * updatedAt, mark the record as waiting to upload (_sync = 1) and record
 * which device wrote it. The sync engine writes remote records directly.
 */

let writerDevice = 'local';
let actorId: string | null = null;

export function setWriterDevice(deviceId: string) {
  writerDevice = deviceId;
}
export function setActor(memberId: string | null) {
  actorId = memberId;
}
export const currentActor = () => actorId;
export const currentDevice = () => writerDevice;

export type NewRecord<T extends Syncable> = Omit<T, 'id' | 'createdAt' | 'updatedAt' | 'deleted' | '_sync' | '_dev'> & { id?: string };

export function build<T extends Syncable>(fields: NewRecord<T>): T {
  const now = Date.now();
  return { ...(fields as object), id: fields.id ?? uid(), createdAt: now, updatedAt: now, deleted: 0, _sync: 1, _dev: writerDevice } as T;
}

export async function save<T extends Syncable>(table: Table<T, string>, rec: T): Promise<T> {
  const out = { ...rec, updatedAt: Math.max(Date.now(), (rec.updatedAt ?? 0) + 1), _sync: 1 as const, _dev: writerDevice };
  if (!out.createdAt) out.createdAt = out.updatedAt;
  if (out.deleted === undefined) out.deleted = 0;
  await table.put(out);
  return out;
}

export async function saveMany<T extends Syncable>(table: Table<T, string>, recs: readonly T[]): Promise<void> {
  const now = Date.now();
  await table.bulkPut(
    recs.map((r) => ({ ...r, createdAt: r.createdAt || now, updatedAt: Math.max(now, (r.updatedAt ?? 0) + 1), deleted: r.deleted ?? 0, _sync: 1 as const, _dev: writerDevice })),
  );
}

export async function create<T extends Syncable>(table: Table<T, string>, fields: NewRecord<T>): Promise<T> {
  const rec = build<T>(fields);
  await table.put(rec);
  return rec;
}

export async function patch<T extends Syncable>(table: Table<T, string>, id: string, changes: NoInfer<Partial<T>>): Promise<void> {
  const mods = { ...changes, updatedAt: Date.now(), _sync: 1, _dev: writerDevice } as Record<string, unknown>;
  await table.update(id, mods as never);
}

/** Tombstone delete, so the delete also syncs. */
export async function remove<T extends Syncable>(table: Table<T, string>, id: string): Promise<void> {
  await patch(table, id, { deleted: 1 } as Partial<T>);
}

export async function audit(action: string, entity: string, entityId: string | null, summary: string): Promise<void> {
  await create<AuditEntry>(db.audit, { at: Date.now(), actorId, action, entity, entityId, summary });
}
