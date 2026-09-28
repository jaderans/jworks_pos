import { useSyncExternalStore } from 'react';
import type { AppRole } from '../db/types';

export interface CloudAccess {
  role: AppRole;
  memberId: string | null;
  active: boolean;
}

/** Cloud sync status, shared by the sync engine and the UI. */
export interface SyncStatus {
  enabled: boolean;
  state: 'idle' | 'syncing' | 'ok' | 'error' | 'signed-out';
  message: string;
  lastSyncAt: number | null;
  userEmail: string | null;
  needsVerification: boolean;
  access: CloudAccess | null;
  ws: string | null;
}

let status: SyncStatus = {
  enabled: false,
  state: 'idle',
  message: 'Cloud sync is not set up.',
  lastSyncAt: null,
  userEmail: null,
  needsVerification: false,
  access: null,
  ws: null,
};
const listeners = new Set<() => void>();

export function setSyncStatus(next: Partial<SyncStatus>) {
  status = { ...status, ...next };
  listeners.forEach((l) => l());
}

export const getSyncStatus = () => status;

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => status,
  );
}
