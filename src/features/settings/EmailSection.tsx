import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Mail, RefreshCw, Send, Sparkles } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { db } from '../../db/db';
import { getSetting } from '../../db/settings';
import { Badge, Button, Callout, Toggle } from '../../components/ui';
import { Field, TextInput } from '../../components/form';
import { fmtDateTime, isoDate } from '../../lib/time';
import { DEFAULT_MAILER, checkMailer, getMailer, isEmail, mailerReady, setMailer } from '../../email/send';
import { flushOutbox, queueEmail, retryEmails } from '../../email/outbox';
import { studioMailer } from '../../email/studio';
import { testEmail } from '../../email/templates';
import { queueDaySummary, summaryRecipients } from '../../email/automation';
import type { BusinessSettings, MailerSettings } from '../../db/types';

const STATUS_TONE = { queued: 'warn', sent: 'good', failed: 'bad' } as const;
const STATUS_LABEL = { queued: 'Waiting', sent: 'Sent', failed: 'Failed' } as const;
const KIND_LABEL = { receipt: 'Receipt', summary: 'End of day', test: 'Test' } as const;

/** Emailed receipts and the end-of-day summary, through the studio Gmail mailer that JoshWorks Studio uses. */
export function EmailSection() {
  const app = useApp();
  const [m, setM] = useState<MailerSettings>(DEFAULT_MAILER);
  const [loaded, setLoaded] = useState(false);
  const [studio, setStudio] = useState<Awaited<ReturnType<typeof studioMailer>>>(null);
  const [busy, setBusy] = useState('');
  const [status, setStatus] = useState<{ tone: 'good' | 'bad' | 'info'; text: string } | null>(null);
  const outbox = useLiveQuery(() => db.outbox.orderBy('at').reverse().limit(12).toArray(), []);
  const counts = useLiveQuery(async () => ({ queued: await db.outbox.where('status').equals('queued').count(), failed: await db.outbox.where('status').equals('failed').count() }), []);

  useEffect(() => {
    void getMailer().then((v) => {
      setM(v);
      setLoaded(true);
    });
    void studioMailer().then(setStudio);
  }, []);

  const set = (patch: Partial<MailerSettings>) => setM((v) => ({ ...v, ...patch }));
  const save = async (next = m, quiet = false) => {
    await setMailer(next);
    if (!quiet) app.toast('Email settings saved on this device', { tone: 'good' });
  };
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setStatus(null);
    try {
      await fn();
    } catch (e) {
      setStatus({ tone: 'bad', text: e instanceof Error ? e.message : 'That didn’t work.' });
    } finally {
      setBusy('');
    }
  };

  const useStudio = () =>
    run('studio', async () => {
      if (!studio) return;
      const next = { ...m, url: studio.url, key: studio.key, replyTo: m.replyTo || studio.replyTo, summaryTo: m.summaryTo || studio.replyTo };
      setM(next);
      await save(next, true);
      const left = await checkMailer(next);
      setStatus({ tone: 'good', text: `Connected to the studio Gmail through JoshWorks Studio’s mailer.${left !== undefined ? ` ${left} emails left today.` : ''}` });
    });
  const check = () =>
    run('check', async () => {
      await save(m, true);
      const left = await checkMailer(m);
      setStatus({ tone: 'good', text: `The mailer answered.${left !== undefined ? ` Gmail can send ${left} more emails today (shared with Studio).` : ''}` });
    });
  const sendTest = () =>
    run('test', async () => {
      await save(m, true);
      const to = summaryRecipients(m)[0] ?? (isEmail(m.replyTo) ? m.replyTo : '');
      if (!to) throw new Error('Add your email under “Send it to” or “Replies go to” first.');
      const business = await getSetting<BusinessSettings>('business');
      await queueEmail({ kind: 'test', saleId: null, to, toName: '', mail: testEmail(business) });
      const r = await flushOutbox();
      setStatus(r.sent ? { tone: 'good', text: `Test sent to ${to}. If it isn’t in the inbox, check Spam and mark it “Not spam”.` } : { tone: 'bad', text: r.error || 'The test is waiting to send.' });
    });
  const summaryNow = () =>
    run('summary', async () => {
      await save(m, true);
      if (!app.activeEventId) throw new Error('Pick an event first (top of the screen).');
      const r = await queueDaySummary(app.activeEventId, isoDate(Date.now()), 'manual');
      if (!r.queued) throw new Error(r.message);
      setStatus({ tone: 'good', text: `Today’s summary is on its way to ${summaryRecipients(m).join(', ')}.` });
    });

  if (!loaded) return null;
  const ready = mailerReady(m);
  const recipients = summaryRecipients(m);

  return (
    <section id="s-email" className="card pad-lg stack" style={{ scrollMarginTop: 80 }}>
      <div>
        <h2>Email receipts and end-of-day summary</h2>
        <p className="sub">
          Receipts go to customers from the studio Gmail, with the JoshWorks logo. The end-of-day summary (sales, registers and inventory, with the PDF) comes to you when a register closes. Offline, emails wait and go out by themselves once there’s a connection. The link and key stay on this device only.
        </p>
      </div>

      {studio && studio.url !== m.url ? (
        <Callout tone="info" title="JoshWorks Studio is on this device">
          Use the same studio Gmail mailer Studio already sends invoices with.{' '}
          <Button size="sm" variant="teal" onClick={useStudio} disabled={!!busy}>
            <Sparkles size={15} /> Use Studio’s mailer
          </Button>
        </Callout>
      ) : null}

      <div className="form-grid">
        <Field label="Mailer link" htmlFor="em-url" className="span-2" hint="From JoshWorks Studio: Settings → Email (the Web app URL ending in /exec).">
          <TextInput id="em-url" value={m.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://script.google.com/macros/s/…/exec" autoComplete="off" />
        </Field>
        <Field label="Mailer key" htmlFor="em-key">
          <TextInput id="em-key" type="password" value={m.key} onChange={(e) => set({ key: e.target.value })} autoComplete="off" />
        </Field>
        <Field label="Sender name" htmlFor="em-from">
          <TextInput id="em-from" value={m.fromName} onChange={(e) => set({ fromName: e.target.value })} />
        </Field>
        <Field label="Replies go to" htmlFor="em-reply" className="span-2" hint="When a customer replies to their receipt.">
          <TextInput id="em-reply" type="email" value={m.replyTo} onChange={(e) => set({ replyTo: e.target.value })} placeholder="jworks1505@gmail.com" />
        </Field>
      </div>

      <div className="stack tight">
        <h3>End-of-day summary</h3>
        <Toggle id="em-sum" checked={m.summaryOn} onChange={(summaryOn) => set({ summaryOn })} label="Email me the end-of-day summary" />
        <div className="form-grid">
          <Field label="Send it to" htmlFor="em-sumto" hint={recipients.length ? `Goes to ${recipients.join(', ')}.` : 'Your email; separate several with commas.'}>
            <TextInput id="em-sumto" value={m.summaryTo} onChange={(e) => set({ summaryTo: e.target.value })} placeholder="you@gmail.com, partner@gmail.com" />
          </Field>
          <Field label="If no register was closed, send it at" htmlFor="em-sumtime" hint="Only while the app is open; otherwise it goes out the next time it opens.">
            <TextInput id="em-sumtime" type="time" value={m.summaryTime} onChange={(e) => set({ summaryTime: e.target.value || '21:00' })} />
          </Field>
        </div>
      </div>

      {status ? <Callout tone={status.tone}>{status.text}</Callout> : null}
      <div className="actions">
        <Button variant="primary" onClick={() => save()} disabled={!!busy}>
          Save
        </Button>
        <Button onClick={check} disabled={!!busy || !ready}>
          <RefreshCw size={16} /> Check the connection
        </Button>
        <Button onClick={sendTest} disabled={!!busy || !ready}>
          <Mail size={16} /> Send a test
        </Button>
        <Button onClick={summaryNow} disabled={!!busy || !ready || !recipients.length}>
          <Send size={16} /> Send today’s summary now
        </Button>
      </div>

      {outbox && outbox.length ? (
        <div className="stack tight">
          <div className="row between wrap">
            <h3>Recent emails</h3>
            <div className="actions">
              {counts?.failed ? (
                <Button size="sm" onClick={() => run('retry', async () => void (await retryEmails()))} disabled={!!busy}>
                  Retry failed ({counts.failed})
                </Button>
              ) : null}
              {counts?.queued ? (
                <Button size="sm" onClick={() => run('flush', async () => void (await flushOutbox()))} disabled={!!busy}>
                  Send waiting ({counts.queued})
                </Button>
              ) : null}
            </div>
          </div>
          <div className="card flush">
            <div className="list">
              {outbox.map((o) => (
                <div key={o.id} className="list-item">
                  <Badge tone={STATUS_TONE[o.status]}>{STATUS_LABEL[o.status]}</Badge>
                  <span className="main-text">
                    <b>
                      {KIND_LABEL[o.kind]} · {o.to}
                    </b>
                    <span>{o.error && o.status !== 'sent' ? o.error : o.sentAt ? `Sent ${fmtDateTime(o.sentAt)}` : `Queued ${fmtDateTime(o.at)}`}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
