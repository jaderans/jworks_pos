/** The team's Firebase project details. None of this is secret: security comes from the rules and sign-in. */
export interface FirebaseSettings {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  /** Local testing against the Firebase emulators. */
  emulator?: { host: string; authPort: number; firestorePort: number };
}

export interface CloudConfig {
  firebase: FirebaseSettings;
  /** Workspace id: the team's folder in the database. */
  ws: string;
}

/**
 * Accepts the snippet copied from the Firebase console
 * (`const firebaseConfig = { apiKey: "…", … };`) or plain JSON.
 */
export function parseFirebaseConfig(text: string): FirebaseSettings {
  const t = text.trim();
  if (!t) throw new Error('Paste the firebaseConfig from your Firebase project settings.');
  let obj: Record<string, unknown> | null = null;
  try {
    const json = JSON.parse(t);
    if (json && typeof json === 'object') obj = json as Record<string, unknown>;
  } catch {
    obj = null;
  }
  if (!obj) {
    obj = {};
    const re = /(\w+)\s*:\s*["'`]([^"'`]+)["'`]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(t))) obj[m[1]] = m[2];
  }
  const cfg = obj as Partial<FirebaseSettings>;
  const missing = (['apiKey', 'authDomain', 'projectId', 'appId'] as const).filter((k) => !cfg[k] || typeof cfg[k] !== 'string');
  if (missing.length) throw new Error(`The config is missing ${missing.join(', ')}. Copy the whole firebaseConfig block.`);
  return {
    apiKey: cfg.apiKey!,
    authDomain: cfg.authDomain!,
    projectId: cfg.projectId!,
    appId: cfg.appId!,
    storageBucket: cfg.storageBucket,
    messagingSenderId: cfg.messagingSenderId,
    emulator: cfg.emulator,
  };
}

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'team';

function b64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export interface InvitePayload {
  c: CloudConfig;
  e?: string;
  n?: string;
}

/** A link a designer opens on their phone to join the team's sync. */
export function inviteLink(cfg: CloudConfig, email?: string, name?: string): string {
  const payload: InvitePayload = { c: cfg, e: email, n: name };
  const base = `${location.origin}${location.pathname}`;
  return `${base}#/join?i=${b64urlEncode(JSON.stringify(payload))}`;
}

export function readInvite(param: string | null): InvitePayload | null {
  if (!param) return null;
  try {
    const p = JSON.parse(b64urlDecode(param)) as InvitePayload;
    if (!p?.c?.firebase?.apiKey || !p.c.ws) return null;
    return p;
  } catch {
    return null;
  }
}
