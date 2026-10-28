import { db } from '../db/db';
import { uid } from '../lib/ids';
import { EmailError, getMailer, mailerReady, sendMail } from './send';
import type { EmailContent } from './templates';
import type { OutboxItem } from '../db/types';

/**
 * Emails wait here until they can go out: offline at the booth, they queue and
 * send by themselves once there's a connection. A browser lock keeps two open
 * tabs from sending the same email twice.
 */

export interface FlushResult {
  sent: number;
  left: number;
  error: string;
}

let running: Promise<FlushResult> | null = null;

export async function queueEmail(o: { kind: OutboxItem['kind']; saleId: string | null; to: string; toName: string; mail: EmailContent; attachments?: OutboxItem['attachments'] }): Promise<OutboxItem> {
  const item: OutboxItem = {
    id: uid(),
    at: Date.now(),
    kind: o.kind,
    saleId: o.saleId,
    to: o.to.trim().toLowerCase(),
    toName: o.toName,
    subject: o.mail.subject,
    html: o.mail.html,
    text: o.mail.text,
    attachments: o.attachments,
    status: 'queued',
    tries: 0,
    error: '',
    sentAt: null,
  };
  await db.outbox.put(item);
  return item;
}

/** Send what's waiting. Safe to call any time; calls while it runs share the same run. */
export function flushOutbox(): Promise<FlushResult> {
  if (!running) {
    running = withLock(run).finally(() => {
      running = null;
    });
  }
  return running;
}

async function withLock(fn: () => Promise<FlushResult>): Promise<FlushResult> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks) return fn();
  // Another tab is already sending: let it.
  return locks.request('jwpos-outbox', { ifAvailable: true }, async (lock) => (lock ? fn() : { sent: 0, left: await queuedCount(), error: '' }));
}

const queuedCount = () => db.outbox.where('status').equals('queued').count();

async function run(): Promise<FlushResult> {
  const m = await getMailer();
  if (!mailerReady(m)) {
    const left = await queuedCount();
    return { sent: 0, left, error: left ? 'Email isn’t set up on this device yet (Settings → Email receipts).' : '' };
  }
  let sent = 0;
  let error = '';
  const waiting = await db.outbox.where('status').equals('queued').sortBy('at');
  for (const item of waiting) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      error = 'Offline. Waiting emails go out when there’s a connection.';
      break;
    }
    try {
      await sendMail(m, item.to, item);
      await db.outbox.update(item.id, { status: 'sent', sentAt: Date.now(), tries: item.tries + 1, error: '' });
      sent++;
    } catch (e) {
      const err = e instanceof EmailError ? e : new EmailError(e instanceof Error ? e.message : 'The email didn’t send.', true);
      error = err.message;
      if (err.retry) {
        // Offline or the daily limit: everything after it would fail the same way.
        await db.outbox.update(item.id, { tries: item.tries + 1, error: err.message });
        break;
      }
      await db.outbox.update(item.id, { status: 'failed', tries: item.tries + 1, error: err.message });
    }
  }
  return { sent, left: await queuedCount(), error };
}

/** Put a failed email (or all of them) back in the queue, e.g. after fixing the address or the key. */
export async function retryEmails(ids?: string[]): Promise<FlushResult> {
  const failed = await db.outbox.where('status').equals('failed').toArray();
  for (const f of failed) if (!ids || ids.includes(f.id)) await db.outbox.update(f.id, { status: 'queued', error: '' });
  return flushOutbox();
}

export async function forgetEmail(id: string): Promise<void> {
  await db.outbox.delete(id);
}

let started = false;

/** Send waiting emails at start, whenever the device comes back online, and every few minutes (for the daily limit). */
export function startOutbox(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.addEventListener('online', () => void flushOutbox());
  window.setInterval(() => {
    if (navigator.onLine) void flushOutbox();
  }, 5 * 60_000);
  void flushOutbox();
}
