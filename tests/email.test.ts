import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/db/db';
import { setLocal } from '../src/db/local';
import { toCents } from '../src/lib/money';
import { dayStart } from '../src/lib/time';
import { dayStock } from '../src/domain/stock';
import { daySummaryEmail, saleReceiptEmail } from '../src/email/templates';
import { flushOutbox, queueEmail, retryEmails } from '../src/email/outbox';
import { summaryRecipients } from '../src/email/automation';
import { DEFAULT_MAILER } from '../src/email/send';
import type { BusinessSettings, EventProduct, Sale } from '../src/db/types';
import type { ReportInput } from '../src/reports/eventReport';

const P = toCents;
const business: BusinessSettings = { name: 'JoshWorks', tagline: 'Creative studio', address: 'Iloilo City', contact: '0917', receiptFooter: 'Thank you for supporting JoshWorks!' };
const day = '2026-10-28';
const at = (h: number) => dayStart(day) + h * 3_600_000;

let n = 0;
function sale(total: number, lines: [string, number][], extra: Partial<Sale> = {}): Sale {
  n++;
  return {
    id: `s${n}`, createdAt: 0, updatedAt: 0, eventId: 'e1', sessionId: 'x1', deviceId: 'd', receiptNo: `A-000${n}`, at: at(10 + n), cashierId: null,
    lines: lines.map(([productId, qty]) => ({ productId, name: productId === 'p1' ? 'Cat Meme' : 'Enamel Pin', categoryId: null, qty, unitPrice: P(20), gross: P(20 * qty), bundleOff: 0, free: 0, freeReason: '', designerId: null })),
    subtotal: P(total), discountTotal: 0, discounts: [], total: P(total),
    payments: [{ methodId: 'cash', name: 'Cash', kind: 'cash', amount: P(total), tendered: P(total), ref: '' }],
    change: 0, note: '', status: 'completed', voidedAt: null, voidedBy: null, voidReason: '', ...extra,
  };
}
const ep = (productId: string, stockBrought: number | null): EventProduct => ({ id: productId, createdAt: 0, updatedAt: 0, eventId: 'e1', productId, price: null, active: 1, stockBrought });

describe('receipt email', () => {
  it('is branded and lists what was bought', () => {
    const s = sale(60, [['p1', 3]]);
    const mail = saleReceiptEmail(business, s, { eventName: 'Komiket Iloilo', customerName: 'Kaye <b>Dela Cruz</b>', stampLine: '+0 stamps, 1 on the card' });
    expect(mail.subject).toBe(`Your receipt ${s.receiptNo} · JoshWorks`);
    expect(mail.html).toContain('brand/email-logo.png');
    expect(mail.html).toContain('#167D88');
    expect(mail.html).toContain('3 × Cat Meme');
    expect(mail.html).toContain('₱60');
    expect(mail.html).toContain('not a BIR official receipt');
    expect(mail.html).not.toContain('<b>Dela');
    expect(mail.text).toContain('Stamp card: +0 stamps, 1 on the card');
  });
});

describe('end-of-day summary', () => {
  const sales = [sale(60, [['p1', 3]]), sale(40, [['p2', 2]]), sale(20, [['p1', 1]], { status: 'voided' })];

  it('works out the booth inventory for the day', () => {
    const rows = dayStock([ep('p1', 10), ep('p2', 2), ep('p3', null)], (id) => id, sales, dayStart(day), dayStart('2026-10-29'));
    expect(rows.find((r) => r.productId === 'p1')).toMatchObject({ brought: 10, soldToday: 3, left: 7, status: 'ok' });
    expect(rows.find((r) => r.productId === 'p2')).toMatchObject({ brought: 2, left: 0, status: 'out' });
    expect(rows.find((r) => r.productId === 'p3')).toBeUndefined();
  });

  it('emails sales, payments and inventory, flagging what to restock', () => {
    const input = {
      business: 'JoshWorks',
      ev: { id: 'e1', name: 'Komiket Iloilo', venue: 'SM City' },
      sales,
      sessions: [],
      metrics: { gross: P(100) },
      products: new Map([
        ['p1', { name: 'Cat Meme' }],
        ['p2', { name: 'Enamel Pin' }],
      ]),
      eventProducts: [ep('p1', 10), ep('p2', 2)],
    } as unknown as ReportInput;
    const mail = daySummaryEmail(business, input, day, { reason: 'Sent automatically when the register closed.' });
    expect(mail.subject).toContain('End of day · Komiket Iloilo');
    expect(mail.text).toContain('Sales today: ₱100');
    expect(mail.text).toContain('Transactions: 2');
    expect(mail.text).toContain('Voided: 1');
    expect(mail.text).toContain('Cash: ₱100 (2)');
    expect(mail.text).toContain('RESTOCK BEFORE THE NEXT DAY');
    expect(mail.text).toContain('Enamel Pin: OUT');
    expect(mail.text).toContain('Cat Meme: sold 3 today · 7 left');
  });

  it('goes to the listed addresses, or the reply-to address', () => {
    expect(summaryRecipients({ ...DEFAULT_MAILER, summaryTo: 'a@jw.ph, b@jw.ph; nope', replyTo: 'r@jw.ph' })).toEqual(['a@jw.ph', 'b@jw.ph']);
    expect(summaryRecipients({ ...DEFAULT_MAILER, summaryTo: '', replyTo: 'r@jw.ph' })).toEqual(['r@jw.ph']);
    expect(summaryRecipients({ ...DEFAULT_MAILER })).toEqual([]);
  });
});

describe('outbox', () => {
  const replies: unknown[] = [];
  const bodies: Record<string, unknown>[] = [];
  beforeEach(async () => {
    await db.delete();
    await db.open();
    replies.length = 0;
    bodies.length = 0;
    await setLocal('mailer', { ...DEFAULT_MAILER, url: 'https://script.google.com/macros/s/x/exec', key: 'k' });
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      const r = replies.shift() ?? { ok: true, remaining: 90 };
      if (r === 'offline') throw new TypeError('Failed to fetch');
      return { text: async () => JSON.stringify(r) };
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const mail = { subject: 'Receipt', html: '<p>hi</p>', text: 'hi' };

  it('sends what is waiting, with the key and sender name', async () => {
    await queueEmail({ kind: 'receipt', saleId: 's1', to: 'Fan@JW.ph', toName: 'Fan', mail });
    const r = await flushOutbox();
    expect(r).toMatchObject({ sent: 1, left: 0 });
    expect(bodies[0]).toMatchObject({ key: 'k', to: 'fan@jw.ph', subject: 'Receipt', name: 'JoshWorks' });
    expect((await db.outbox.toArray())[0].status).toBe('sent');
  });

  it('keeps emails waiting when offline or over the daily limit, and retries later', async () => {
    await queueEmail({ kind: 'receipt', saleId: 's1', to: 'a@jw.ph', toName: '', mail });
    await queueEmail({ kind: 'receipt', saleId: 's2', to: 'b@jw.ph', toName: '', mail });
    replies.push('offline');
    expect(await flushOutbox()).toMatchObject({ sent: 0, left: 2 });
    replies.push({ ok: false, error: 'quota' });
    expect(await flushOutbox()).toMatchObject({ sent: 0, left: 2 });
    expect(await flushOutbox()).toMatchObject({ sent: 2, left: 0 });
  });

  it('marks a bad address as failed and can retry it', async () => {
    const item = await queueEmail({ kind: 'receipt', saleId: 's1', to: 'oops@jw.ph', toName: '', mail });
    replies.push({ ok: false, error: 'to' });
    await flushOutbox();
    expect(await db.outbox.get(item.id)).toMatchObject({ status: 'failed' });
    expect(await retryEmails()).toMatchObject({ sent: 1 });
  });
});
