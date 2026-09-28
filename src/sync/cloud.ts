import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  browserLocalPersistence, connectAuthEmulator, createUserWithEmailAndPassword, indexedDBLocalPersistence, initializeAuth, onAuthStateChanged,
  sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword, signOut, type Auth, type User,
} from 'firebase/auth';
import {
  Timestamp, collection, connectFirestoreEmulator, deleteDoc, doc, getDoc, getDocs, initializeFirestore, memoryLocalCache, onSnapshot, query,
  serverTimestamp, setDoc, where, writeBatch, type Firestore, type Unsubscribe,
} from 'firebase/firestore';
import { liveQuery, type Subscription } from 'dexie';
import { alive, db, SYNCED_TABLES, syncedTable, type SyncedTableName } from '../db/db';
import { getLocal, setLocal } from '../db/local';
import { isNewer } from '../services/backup';
import { setSyncStatus, type CloudAccess } from './useSync';
import type { CloudConfig } from './config';
import type { AppRole, Member, Syncable } from '../db/types';

/**
 * Cloud sync with the team's Firebase project.
 * The on-device database stays the source of truth. Changes made here are
 * uploaded when there's a connection (they wait on the device otherwise);
 * changes from other devices stream in live and the newer copy of each
 * record wins. Photos never leave the device.
 */

const READ: Record<AppRole, readonly SyncedTableName[]> = {
  owner: SYNCED_TABLES.filter((t) => t !== 'settings'),
  cashier: ['categories', 'members', 'paymentMethods', 'products', 'bundleRules', 'events', 'eventProducts', 'roster', 'sessions', 'sales', 'stockMoves', 'payouts'],
  designer: ['categories', 'members', 'products', 'bundleRules', 'events', 'eventProducts', 'roster', 'sales', 'payouts'],
  partner: ['categories', 'products', 'events', 'payouts'],
};
const WRITE: Record<AppRole, readonly SyncedTableName[]> = {
  owner: SYNCED_TABLES,
  cashier: ['events', 'sessions', 'sales', 'stockMoves', 'audit'],
  designer: [],
  partner: [],
};
const SETTINGS_READ: Record<AppRole, readonly string[]> = {
  owner: [],
  cashier: ['business', 'security'],
  designer: ['business'],
  partner: ['business'],
};

let cfg: CloudConfig | null = null;
let fbApp: FirebaseApp | null = null;
let auth: Auth | null = null;
let fs: Firestore | null = null;
let authUnsub: Unsubscribe | null = null;
let listeners: Unsubscribe[] = [];
let pendingSub: Subscription | null = null;
let access: CloudAccess | null = null;
let pushing = false;
let again = false;
let timer: number | null = null;
let interval: number | null = null;
let lastPull: Record<string, number> = {};
let started = false;

const onlineHandler = () => schedulePush(500);

async function ensureFirebase(c: CloudConfig) {
  if (fbApp && cfg && JSON.stringify(cfg) === JSON.stringify(c)) return;
  await teardown(false);
  cfg = c;
  const { emulator, ...options } = c.firebase;
  fbApp = initializeApp(options, `jwpos-${c.firebase.projectId}`);
  auth = initializeAuth(fbApp, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
  fs = initializeFirestore(fbApp, { localCache: memoryLocalCache(), ignoreUndefinedProperties: true });
  if (emulator) {
    connectAuthEmulator(auth, `http://${emulator.host}:${emulator.authPort}`, { disableWarnings: true });
    connectFirestoreEmulator(fs, emulator.host, emulator.firestorePort);
  }
}

async function teardown(signOutUser: boolean) {
  stopListeners();
  authUnsub?.();
  authUnsub = null;
  pendingSub?.unsubscribe();
  pendingSub = null;
  if (interval) window.clearInterval(interval);
  interval = null;
  window.removeEventListener('online', onlineHandler);
  if (signOutUser && auth) await signOut(auth).catch(() => undefined);
  if (fbApp) await deleteApp(fbApp).catch(() => undefined);
  fbApp = null;
  auth = null;
  fs = null;
  access = null;
  started = false;
}

function stopListeners() {
  listeners.forEach((u) => u());
  listeners = [];
}

export async function getCloudConfig(): Promise<CloudConfig | null> {
  return getLocal<CloudConfig | null>('cloudConfig', null);
}

export async function startCloudSync(): Promise<void> {
  const c = await getCloudConfig();
  if (!c) {
    setSyncStatus({ enabled: false, state: 'idle', message: 'Cloud sync is not set up.', access: null, userEmail: null, ws: null });
    return;
  }
  if (started && cfg && JSON.stringify(cfg) === JSON.stringify(c)) return;
  await ensureFirebase(c);
  started = true;
  lastPull = await getLocal<Record<string, number>>('lastPull', {});
  setSyncStatus({ enabled: true, state: 'signed-out', message: 'Sign in to sync with the team.', ws: c.ws });
  authUnsub = onAuthStateChanged(auth!, (u) => void onUser(u));
  window.addEventListener('online', onlineHandler);
}

/** Save the team's Firebase details on this device and start syncing. */
export async function connectCloud(c: CloudConfig): Promise<void> {
  await setLocal('cloudConfig', c);
  await setLocal('lastPull', {});
  await startCloudSync();
}

/** Stop syncing on this device. Its data stays here. */
export async function disconnectCloud(): Promise<void> {
  await teardown(true);
  cfg = null;
  await setLocal('cloudConfig', null);
  await setLocal('lastPull', {});
  setSyncStatus({ enabled: false, state: 'idle', message: 'Cloud sync is not set up.', access: null, userEmail: null, needsVerification: false, ws: null });
}

const need = () => {
  if (!auth || !fs || !cfg) throw new Error('Cloud sync is not connected on this device.');
  return { auth, fs, cfg };
};

export async function signUpCloud(email: string, password: string): Promise<void> {
  const { auth } = need();
  const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
  await sendEmailVerification(cred.user).catch(() => undefined);
}

export async function signInCloud(email: string, password: string): Promise<void> {
  const { auth } = need();
  await signInWithEmailAndPassword(auth, email.trim(), password);
}

export async function resendVerification(): Promise<void> {
  const { auth } = need();
  if (auth.currentUser) await sendEmailVerification(auth.currentUser);
}

/** After clicking the email link: refresh the account so the app sees it's verified. */
export async function checkVerified(): Promise<boolean> {
  const { auth } = need();
  const u = auth.currentUser;
  if (!u) return false;
  await u.reload();
  await u.getIdToken(true);
  if (u.emailVerified) await onUser(u);
  return u.emailVerified;
}

export async function resetPassword(email: string): Promise<void> {
  const { auth } = need();
  await sendPasswordResetEmail(auth, email.trim());
}

export async function signOutCloud(): Promise<void> {
  const { auth } = need();
  await signOut(auth);
}

export function friendlyError(e: unknown): string {
  const code = (e as { code?: string })?.code ?? '';
  const map: Record<string, string> = {
    'auth/invalid-credential': 'That email and password don’t match.',
    'auth/wrong-password': 'That password is not right.',
    'auth/user-not-found': 'No account with that email yet. Create one instead.',
    'auth/email-already-in-use': 'That email already has an account. Sign in instead.',
    'auth/weak-password': 'Use a password of at least 6 characters.',
    'auth/invalid-email': 'That email address doesn’t look right.',
    'auth/network-request-failed': 'No connection. Try again when you’re online.',
    'auth/too-many-requests': 'Too many tries. Wait a few minutes, then try again.',
    'permission-denied': 'This account isn’t allowed to do that. Check its role in Team.',
    unavailable: 'Can’t reach the cloud right now. Sales keep saving on this device.',
  };
  return map[code] ?? (e instanceof Error ? e.message : 'Something went wrong with cloud sync.');
}

const isDenied = (e: unknown) => (e as { code?: string })?.code === 'permission-denied';

/** The owner member on this device (the account that sets up the workspace). */
async function localOwnerId(): Promise<string | null> {
  const current = await getLocal<string | null>('currentMemberId', null);
  const owners = alive(await db.members.where('appRole').equals('owner').toArray());
  return owners.find((m) => m.id === current)?.id ?? owners[0]?.id ?? null;
}

async function resolveAccess(user: User): Promise<CloudAccess | null> {
  const { fs, cfg } = need();
  const email = (user.email ?? '').toLowerCase();
  const accRef = doc(fs, 'ws', cfg.ws, 'access', email);
  const acc = await getDoc(accRef).catch((e) => (isDenied(e) ? null : Promise.reject(e)));
  if (acc?.exists()) {
    const d = acc.data();
    return { role: d.role as AppRole, memberId: (d.memberId as string) ?? null, active: d.active !== false };
  }
  const wsRef = doc(fs, 'ws', cfg.ws);
  const ws = await getDoc(wsRef).catch((e) => (isDenied(e) ? null : Promise.reject(e)));
  const ownerId = await localOwnerId();
  const setupDone = await getLocal<boolean>('setupDone', false);
  if ((!ws || !ws.exists()) && setupDone && ownerId) {
    // First connection from the owner's device: create the team's workspace.
    const business = (await db.settings.get('business'))?.value as { name?: string } | undefined;
    await setDoc(wsRef, { name: business?.name ?? 'JoshWorks', ownerUid: user.uid, ownerEmail: email, createdAt: Date.now() });
    await setDoc(accRef, { role: 'owner', memberId: ownerId, active: true, email, updatedAt: Date.now() });
    const me = await db.members.get(ownerId);
    if (me && me.email !== email) await db.members.put({ ...me, email, updatedAt: Date.now(), _sync: 1 });
    return { role: 'owner', memberId: ownerId, active: true };
  }
  if (ws?.exists() && ws.data().ownerUid === user.uid) {
    await setDoc(accRef, { role: 'owner', memberId: ownerId, active: true, email, updatedAt: Date.now() });
    return { role: 'owner', memberId: ownerId, active: true };
  }
  return null;
}

async function onUser(user: User | null) {
  stopListeners();
  access = null;
  if (!user) {
    setSyncStatus({ enabled: true, state: 'signed-out', message: 'Sign in to sync with the team.', userEmail: null, needsVerification: false, access: null });
    return;
  }
  if (!user.emailVerified) {
    setSyncStatus({
      enabled: true,
      state: 'signed-out',
      message: `Open the verification link sent to ${user.email}, then tap “I’ve verified”.`,
      userEmail: user.email,
      needsVerification: true,
      access: null,
    });
    return;
  }
  setSyncStatus({ enabled: true, state: 'syncing', message: 'Connecting to the team…', userEmail: user.email, needsVerification: false });
  let a: CloudAccess | null;
  try {
    a = await resolveAccess(user);
  } catch (e) {
    setSyncStatus({ state: 'error', message: friendlyError(e) });
    return;
  }
  if (!a || !a.active) {
    setSyncStatus({ state: 'error', message: `${user.email} isn’t on the team yet. The owner adds this email in Team, then tap Sync now.`, access: null });
    return;
  }
  access = a;
  if (a.role !== 'owner') {
    if (a.memberId) await setLocal('currentMemberId', a.memberId);
    await setLocal('setupDone', true);
  }
  setSyncStatus({ access: a, message: 'Syncing…' });
  startListeners(a);
  pendingSub?.unsubscribe();
  let lastCount = -1;
  pendingSub = liveQuery(countPending).subscribe({
    next: (n) => {
      if (n > 0 && n !== lastCount) schedulePush(1200);
      lastCount = n;
    },
  });
  if (interval) window.clearInterval(interval);
  interval = window.setInterval(() => schedulePush(0), 30_000);
  schedulePush(200);
}

async function countPending(): Promise<number> {
  let n = 0;
  for (const t of SYNCED_TABLES) n += await syncedTable(t).where('_sync').equals(1).count();
  return n;
}

function startListeners(a: CloudAccess) {
  const { fs, cfg } = need();
  const tables = READ[a.role];
  for (const t of tables) {
    const col = collection(fs, 'ws', cfg.ws, `t_${t}`);
    const q =
      t === 'payouts' && a.role !== 'owner'
        ? query(col, where('memberId', '==', a.memberId ?? '__none__'))
        : query(col, where('_srv', '>=', Timestamp.fromMillis(lastPull[t] ?? 0)));
    listeners.push(
      onSnapshot(
        q,
        (snap) => void applyRemote(t, snap.docChanges().filter((c) => c.type !== 'removed').map((c) => ({ id: c.doc.id, data: c.doc.data() }))),
        (err) => setSyncStatus({ state: 'error', message: `${friendlyError(err)} (${t})` }),
      ),
    );
  }
  if (a.role === 'owner') {
    const col = collection(fs, 'ws', cfg.ws, 't_settings');
    listeners.push(
      onSnapshot(
        query(col, where('_srv', '>=', Timestamp.fromMillis(lastPull.settings ?? 0))),
        (snap) => void applyRemote('settings', snap.docChanges().filter((c) => c.type !== 'removed').map((c) => ({ id: c.doc.id, data: c.doc.data() }))),
        (err) => setSyncStatus({ state: 'error', message: friendlyError(err) }),
      ),
    );
  } else {
    for (const key of SETTINGS_READ[a.role]) {
      listeners.push(
        onSnapshot(
          doc(fs, 'ws', cfg.ws, 't_settings', key),
          (d) => d.exists() && void applyRemote('settings', [{ id: d.id, data: d.data() }]),
          () => undefined,
        ),
      );
    }
  }
}

let persistTimer: number | null = null;
function persistLastPull() {
  if (persistTimer) window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => void setLocal('lastPull', lastPull), 800);
}

async function applyRemote(table: SyncedTableName, docs: { id: string; data: Record<string, unknown> }[]) {
  if (!docs.length) return;
  let maxSrv = lastPull[table] ?? 0;
  const incoming: Syncable[] = docs.map(({ id, data }) => {
    const { _srv, _by, ...rest } = data as { _srv?: unknown; _by?: unknown } & Record<string, unknown>;
    void _by;
    if (_srv instanceof Timestamp) maxSrv = Math.max(maxSrv, _srv.toMillis());
    return { ...(rest as unknown as Syncable), id };
  });
  const t = syncedTable(table);
  await db.transaction('rw', t, async () => {
    const locals = (await t.bulkGet(incoming.map((r) => r.id))) as (Syncable | undefined)[];
    const put = incoming.filter((r, i) => isNewer(r, locals[i])).map((r) => ({ ...r, _sync: 0 as const }));
    if (put.length) await t.bulkPut(put);
  });
  if (maxSrv > (lastPull[table] ?? 0)) {
    lastPull[table] = maxSrv;
    persistLastPull();
  }
  setSyncStatus({ state: 'ok', lastSyncAt: Date.now(), message: 'Up to date' });
}

function toRemote(r: Syncable, uid: string) {
  const { _sync, ...rest } = r;
  void _sync;
  return { ...rest, _srv: serverTimestamp(), _by: uid };
}

/** Clear the upload flag only if nothing changed the record while it was uploading. */
async function markSynced(table: SyncedTableName, rows: Syncable[]) {
  const t = syncedTable(table);
  await db.transaction('rw', t, async () => {
    const cur = (await t.bulkGet(rows.map((r) => r.id))) as (Syncable | undefined)[];
    const done = cur.filter((c, i): c is Syncable => !!c && c._sync === 1 && c.updatedAt === rows[i].updatedAt).map((c) => ({ ...c, _sync: 0 as const }));
    if (done.length) await t.bulkPut(done);
  });
}

async function pushOnce(): Promise<number> {
  const { fs, cfg, auth } = need();
  const a = access;
  const uid = auth.currentUser?.uid;
  if (!a || !uid) return 0;
  const writable = new Set(WRITE[a.role]);
  let pushed = 0;
  for (const t of SYNCED_TABLES) {
    const table = syncedTable(t);
    const rows = (await table.where('_sync').equals(1).limit(200).toArray()) as Syncable[];
    if (!rows.length) continue;
    if (!writable.has(t)) {
      // This role can't change these in the cloud; keep them on this device only.
      await markSynced(t, rows);
      continue;
    }
    const batch = writeBatch(fs);
    for (const r of rows) batch.set(doc(fs, 'ws', cfg.ws, `t_${t}`, r.id), toRemote(r, uid));
    try {
      await batch.commit();
      pushed += rows.length;
      await markSynced(t, rows);
    } catch (e) {
      if (!isDenied(e)) throw e;
      // One record was older than the cloud copy, or not allowed: send them one by one.
      for (const r of rows) {
        try {
          await setDoc(doc(fs, 'ws', cfg.ws, `t_${t}`, r.id), toRemote(r, uid));
          pushed++;
        } catch (e2) {
          if (!isDenied(e2)) throw e2;
        }
        await markSynced(t, [r]);
      }
    }
  }
  return pushed;
}

export function schedulePush(delay = 0) {
  if (timer) window.clearTimeout(timer);
  timer = window.setTimeout(() => void push(), delay);
}

async function push() {
  if (!access || !auth?.currentUser) return;
  if (pushing) {
    again = true;
    return;
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    setSyncStatus({ state: 'ok', message: 'Offline. Changes wait on this device.' });
    return;
  }
  pushing = true;
  setSyncStatus({ state: 'syncing', message: 'Uploading…' });
  try {
    for (let i = 0; i < 50; i++) {
      const n = await pushOnce();
      if (n === 0 || (await countPending()) === 0) break;
    }
    setSyncStatus({ state: 'ok', lastSyncAt: Date.now(), message: 'Up to date' });
  } catch (e) {
    setSyncStatus({ state: 'error', message: friendlyError(e) });
  } finally {
    pushing = false;
    if (again) {
      again = false;
      schedulePush(500);
    }
  }
}

export async function syncNow(): Promise<void> {
  if (auth?.currentUser && !access) await onUser(auth.currentUser);
  else await push();
}

// ----- team access (owner) -----

export interface AccessRow {
  email: string;
  role: AppRole;
  memberId: string | null;
  active: boolean;
}

export async function listAccess(): Promise<AccessRow[]> {
  const { fs, cfg } = need();
  const snap = await getDocs(collection(fs, 'ws', cfg.ws, 'access'));
  return snap.docs.map((d) => ({ email: d.id, role: d.data().role as AppRole, memberId: (d.data().memberId as string) ?? null, active: d.data().active !== false }));
}

/** Give a team member cloud access with their role (or update it). */
export async function grantAccess(m: Member): Promise<void> {
  const { fs, cfg } = need();
  const email = m.email.trim().toLowerCase();
  if (!email) throw new Error(`Add ${m.name}'s email first.`);
  await setDoc(doc(fs, 'ws', cfg.ws, 'access', email), { role: m.appRole, memberId: m.id, active: m.active === 1, name: m.name, email, updatedAt: Date.now() });
}

export async function revokeAccess(email: string): Promise<void> {
  const { fs, cfg } = need();
  await deleteDoc(doc(fs, 'ws', cfg.ws, 'access', email.trim().toLowerCase()));
}

export const isCloudOwner = () => access?.role === 'owner';
