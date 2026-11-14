import { blobToAttachment, getMailer, mailerReady } from '../email/send';

/**
 * Google Drive, through the same Apps Script that sends the email
 * (jworks_studio/apps-script/Mailer.gs): it keeps the POS's files in a
 * "JoshWorks POS" folder in the studio account's Drive, and only ever reads
 * or writes inside it. Same link and key as email, so nothing new to set up
 * beyond updating the script once.
 */

export type DriveFolder = 'stickers' | 'photos' | 'ads';

export interface DriveFile {
  id: string;
  name: string;
  type: string;
  size: number;
  /** Last changed, ms. */
  updated: number;
}

/** setup: email isn't set up. old-script: the script predates Drive. offline: no connection. */
export class DriveError extends Error {
  constructor(
    message: string,
    readonly kind: 'setup' | 'old-script' | 'offline' | 'failed',
  ) {
    super(message);
  }
}

interface Reply {
  ok: boolean;
  error?: string;
  message?: string;
  drive?: boolean;
  files?: DriveFile[];
  folders?: Record<DriveFolder, string>;
  data?: string;
  type?: string;
  id?: string;
  url?: string;
}

const OLD = 'The Google script needs updating for Drive: in JoshWorks Studio, Settings → Email → Copy the script, paste it over the old one, run authorize, then Deploy → Manage deployments → Edit → New version.';

async function call(body: Record<string, unknown>): Promise<Reply> {
  const m = await getMailer();
  if (!mailerReady(m)) throw new DriveError('Drive uses the Google script from Settings → Email receipts. Set that up first.', 'setup');
  const res = await fetch(m.url.trim(), {
    method: 'POST',
    // text/plain keeps it a "simple" request, so the browser doesn't ask Google for CORS permission first.
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ key: m.key.trim(), ...body }),
  }).catch(() => null);
  if (!res) throw new DriveError('Couldn’t reach Google Drive. Check the connection.', 'offline');
  let r: Reply;
  try {
    r = (await res.json()) as Reply;
  } catch {
    throw new DriveError('The Google script didn’t answer. Check the link in Settings → Email receipts.', 'failed');
  }
  if (r.ok) return r;
  if (r.error === 'key') throw new DriveError('The script’s key doesn’t match. Copy it again from JoshWorks Studio into Settings → Email receipts.', 'setup');
  // A script from before Drive treats the request as an email with no address.
  if (r.error === 'to' || r.error === 'action') throw new DriveError(OLD, 'old-script');
  throw new DriveError(r.message || `Drive said no (${r.error ?? 'unknown'}).`, 'failed');
}

/** Is Drive ready to use? Never throws. */
export async function driveStatus(): Promise<{ ok: true } | { ok: false; kind: DriveError['kind']; message: string }> {
  try {
    const r = await call({ ping: true });
    return r.drive ? { ok: true } : { ok: false, kind: 'old-script', message: OLD };
  } catch (e) {
    return e instanceof DriveError ? { ok: false, kind: e.kind, message: e.message } : { ok: false, kind: 'failed', message: String(e) };
  }
}

export async function driveFolders(): Promise<Record<DriveFolder, string>> {
  return (await call({ action: 'drive.folders' })).folders ?? { stickers: '', photos: '', ads: '' };
}

/** Images and videos in a POS folder, newest first. */
export async function listDrive(folder: DriveFolder): Promise<DriveFile[]> {
  return (await call({ action: 'drive.list', folder })).files ?? [];
}

export async function getDriveFile(folder: DriveFolder, id: string): Promise<Blob> {
  const r = await call({ action: 'drive.get', folder, id });
  const bin = atob(r.data ?? '');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: r.type || 'application/octet-stream' });
}

export async function saveToDrive(folder: DriveFolder, name: string, blob: Blob): Promise<{ id: string; url: string }> {
  const r = await call({ action: 'drive.save', folder, file: await blobToAttachment(name, blob) });
  return { id: r.id ?? '', url: r.url ?? '' };
}
