import { getLocal, setLocal } from '../db/local';
import type { MailerSettings } from '../db/types';
import type { EmailContent } from './templates';

/**
 * Emails go out from the studio Gmail through the small Google Apps Script that
 * JoshWorks Studio uses (jworks_studio/apps-script/Mailer.gs): the app designs
 * the email and the script delivers it. Free Gmail sends about 100 a day, shared
 * with Studio. The link and key stay on this device (never in backups).
 */

export const DEFAULT_MAILER: MailerSettings = { url: '', key: '', fromName: 'JoshWorks', replyTo: '', summaryOn: true, summaryTo: '', summaryTime: '21:00' };

export async function getMailer(): Promise<MailerSettings> {
  return { ...DEFAULT_MAILER, ...(await getLocal<Partial<MailerSettings>>('mailer', {})) };
}

export async function setMailer(m: MailerSettings): Promise<void> {
  await setLocal('mailer', { ...m, url: m.url.trim(), key: m.key.trim(), fromName: m.fromName.trim(), replyTo: m.replyTo.trim(), summaryTo: m.summaryTo.trim() });
}

export const mailerReady = (m: Pick<MailerSettings, 'url' | 'key'>) => /^https:\/\/script\.google(usercontent)?\.com\//.test(m.url.trim()) && !!m.key.trim();

export const isEmail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim());

/** `retry`: worth trying again later (offline, quota); otherwise it needs fixing first. */
export class EmailError extends Error {
  constructor(
    message: string,
    readonly retry: boolean,
  ) {
    super(message);
  }
}

interface MailerReply {
  ok: boolean;
  error?: 'key' | 'to' | 'quota' | 'failed';
  message?: string;
  remaining?: number;
}

async function post(url: string, body: unknown): Promise<MailerReply> {
  const res = await fetch(url.trim(), {
    method: 'POST',
    // text/plain keeps it a "simple" request, so the browser doesn't ask Google for CORS permission first.
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!res) throw new EmailError('Couldn’t reach the mailer. It will try again when there’s a connection.', true);
  const text = await res.text().catch(() => '');
  try {
    return JSON.parse(text) as MailerReply;
  } catch {
    throw new EmailError('The mailer link didn’t answer like the JoshWorks mailer. Check the link in Settings → Email receipts.', false);
  }
}

function fail(r: MailerReply): EmailError {
  switch (r.error) {
    case 'key':
      return new EmailError('The mailer key doesn’t match. Copy it again from JoshWorks Studio (Settings → Email) into Settings → Email receipts.', false);
    case 'to':
      return new EmailError('That email address doesn’t look right.', false);
    case 'quota':
      return new EmailError('Gmail’s daily limit is used up (about 100 a day, shared with Studio). It goes out tomorrow.', true);
    default:
      return new EmailError(`Gmail didn’t send it: ${r.message || 'unknown error'}.`, true);
  }
}

/** Send one email now. Returns how many Gmail can still send today. */
/** A file sent with an email (base64, as the mailer script expects). */
export interface MailAttachment {
  name: string;
  type: string;
  data: string;
}

export async function blobToAttachment(name: string, blob: Blob): Promise<MailAttachment> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { name, type: blob.type || 'application/octet-stream', data: btoa(bin) };
}

export async function sendMail(m: MailerSettings, to: string, mail: EmailContent & { attachments?: MailAttachment[] }): Promise<number | undefined> {
  if (!mailerReady(m)) throw new EmailError('Email isn’t set up on this device yet (Settings → Email receipts).', false);
  if (!isEmail(to)) throw new EmailError('That email address doesn’t look right.', false);
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new EmailError('Offline. It goes out when there’s a connection.', true);
  const r = await post(m.url, {
    key: m.key.trim(),
    to: to.trim(),
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    name: m.fromName || 'JoshWorks',
    replyTo: m.replyTo || undefined,
    attachments: mail.attachments ?? [],
  });
  if (!r.ok) throw fail(r);
  return r.remaining;
}

/** Check the link and key; returns how many emails Gmail can still send today. */
export async function checkMailer(m: MailerSettings): Promise<number | undefined> {
  if (!mailerReady(m)) throw new EmailError('Paste the mailer link (it starts with https://script.google.com/) and the key first.', false);
  const r = await post(m.url, { key: m.key.trim(), ping: true });
  if (!r.ok) throw fail(r);
  return r.remaining;
}
