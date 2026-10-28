import { alive, db } from '../db/db';
import { getLocal, setLocal } from '../db/local';
import { getSetting } from '../db/settings';
import { safeFileName } from '../lib/files';
import { addDays, dayStart, isoDate } from '../lib/time';
import { blobToAttachment, getMailer, isEmail, mailerReady } from './send';
import { daySummaryEmail, fmtSummaryReason } from './templates';
import { flushOutbox, queueEmail } from './outbox';
import type { BusinessSettings, MailerSettings } from '../db/types';

/**
 * The end-of-day summary goes out by itself: when a register closes, or at the
 * set time if no one closed one, and for any recent day that was missed (the
 * app was closed). Each event-day is summarized once, except that every
 * register close sends a fresh one.
 */

type Reason = 'closed' | 'scheduled' | 'catch-up' | 'manual';
const SENT_KEY = 'summariesSent';

/** Who gets the summary: the listed addresses, or the reply-to address if none are listed. */
export function summaryRecipients(m: MailerSettings): string[] {
  const listed = m.summaryTo.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(isEmail);
  return listed.length ? [...new Set(listed)] : isEmail(m.replyTo) ? [m.replyTo.trim().toLowerCase()] : [];
}

export async function queueDaySummary(eventId: string, day: string, reason: Reason): Promise<{ queued: number; message: string }> {
  const m = await getMailer();
  if (!m.summaryOn && reason !== 'manual') return { queued: 0, message: 'The end-of-day summary is turned off.' };
  const to = summaryRecipients(m);
  if (!to.length) return { queued: 0, message: 'Add who gets the summary in Settings → Email receipts.' };
  const key = `${eventId}:${day}`;
  const sent = await getLocal<Record<string, number>>(SENT_KEY, {});
  if (sent[key] && (reason === 'scheduled' || reason === 'catch-up')) return { queued: 0, message: 'Already sent.' };

  const { loadReportInput } = await import('../reports/loadReport');
  const input = await loadReportInput(eventId);
  if (!input) return { queued: 0, message: 'That event no longer exists.' };
  const hasSales = input.sales.some((s) => s.at >= dayStart(day) && s.at < dayStart(addDays(day, 1)));
  if (!hasSales && reason !== 'manual' && reason !== 'closed') return { queued: 0, message: 'No sales that day.' };

  const business = await getSetting<BusinessSettings>('business');
  const materials = alive(await db.materials.toArray());
  const mail = daySummaryEmail(business, input, day, { materials, reason: fmtSummaryReason(reason) });
  let attachments: Awaited<ReturnType<typeof blobToAttachment>>[] | undefined;
  try {
    const [{ buildEndOfDay }, { renderPdf }] = await Promise.all([import('../reports/eventReport'), import('../reports/pdf')]);
    const blob = await renderPdf(await buildEndOfDay(input, day));
    attachments = [await blobToAttachment(`${safeFileName(input.ev.name)} - end of day ${day}.pdf`, blob)];
  } catch {
    // The email still goes out without the PDF.
  }
  for (const addr of to) await queueEmail({ kind: 'summary', saleId: null, to: addr, toName: '', mail, attachments });
  await setLocal(SENT_KEY, { ...sent, [key]: Date.now() });
  void flushOutbox();
  return { queued: to.length, message: '' };
}

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : 21 * 60;
};

/** Summaries due now: today's after the set time, and any of the last three days that were missed. */
export async function sendDueSummaries(now = Date.now()): Promise<number> {
  const m = await getMailer();
  if (!m.summaryOn || !mailerReady(m) || !summaryRecipients(m).length) return 0;
  const today = isoDate(now);
  const d = new Date(now);
  const afterTime = d.getHours() * 60 + d.getMinutes() >= minutesOf(m.summaryTime);
  const recent = alive(await db.sales.where('at').aboveOrEqual(dayStart(addDays(today, -3))).toArray());
  const sent = await getLocal<Record<string, number>>(SENT_KEY, {});
  const due = [...new Set(recent.map((s) => `${s.eventId}:${isoDate(s.at)}`))].filter((k) => !sent[k] && (!k.endsWith(`:${today}`) || afterTime));
  let queued = 0;
  for (const k of due) {
    const [eventId, day] = [k.slice(0, k.lastIndexOf(':')), k.slice(k.lastIndexOf(':') + 1)];
    queued += (await queueDaySummary(eventId, day, day === today ? 'scheduled' : 'catch-up')).queued;
  }
  return queued;
}

let started = false;

/** Check for due summaries at start and every few minutes while the app is open. */
export function startDailySummary(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  const tick = () => void sendDueSummaries().catch(() => undefined);
  window.setTimeout(tick, 4000);
  window.setInterval(tick, 5 * 60_000);
}
