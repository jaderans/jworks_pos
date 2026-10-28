import { peso, sum } from '../lib/money';
import { addDays, dayStart, fmtDateTime, fmtIsoWeekday, fmtTime, isoDate } from '../lib/time';
import { drawerState } from '../domain/summary';
import { dayStock } from '../domain/stock';
import type { BusinessSettings, Material, Sale } from '../db/types';
import type { ReportInput } from '../reports/eventReport';

/**
 * Branded emails in the JoshWorks Studio style: a table layout with inline
 * styles (what Gmail, Outlook and phone mail apps render reliably), the
 * letterhead's teal-to-gold bar, the logo, and a plain-text copy (it helps keep
 * mail out of spam).
 */

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

const PUBLIC_BASE = 'https://jaderans.github.io/jworks_pos/';

/** Where the published app (and its email logo) lives. Emails sent while testing on this computer still use the live site. */
export function appBase(): string {
  if (typeof window === 'undefined' || /^(localhost|127\.|192\.168\.)/.test(window.location.hostname)) return PUBLIC_BASE;
  return `${window.location.origin}${window.location.pathname.replace(/[^/]*$/, '')}`;
}

const INK = '#231F20';
const TEAL = '#167D88';
const FONT = "'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

interface Layout {
  preheader: string;
  heading: string;
  paragraphs: string[];
  highlight?: { label: string; value: string };
  rows?: [string, string][];
  /** Titled lists after the main rows: payments, registers, inventory. */
  sections?: { title: string; rows: [string, string][]; warn?: boolean }[];
  note?: string;
}

function layout(b: BusinessSettings, l: Layout): string {
  const logo = `${appBase()}brand/email-logo.png`;
  const p = (t: string) => `<p style="margin:0 0 14px;font:15px/1.6 ${FONT};color:#3A3536">${t}</p>`;
  const rows = l.rows?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 18px;border-collapse:collapse;background:#F1F8F9;border-radius:12px">${l.rows
        .map(
          ([k, v], i) =>
            `<tr><td style="padding:10px 16px;font:13px ${FONT};color:#5B5556;${i ? 'border-top:1px solid #DCEBEC;' : ''}">${esc(k)}</td><td align="right" style="padding:10px 16px;font:600 14px ${FONT};color:${INK};${i ? 'border-top:1px solid #DCEBEC;' : ''}">${esc(v)}</td></tr>`,
        )
        .join('')}</table>`
    : '';
  const highlight = l.highlight
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px"><tr><td style="padding:16px 18px;border:2px solid ${TEAL};border-radius:12px">
        <div style="font:600 12px ${FONT};letter-spacing:.08em;text-transform:uppercase;color:${TEAL}">${esc(l.highlight.label)}</div>
        <div style="font:800 28px/1.2 ${FONT};color:${INK};margin-top:4px">${esc(l.highlight.value)}</div>
      </td></tr></table>`
    : '';
  const sections = (l.sections ?? [])
    .filter((x) => x.rows.length)
    .map(
      (x) =>
        `<div style="font:700 13px ${FONT};color:${x.warn ? '#A35E00' : TEAL};letter-spacing:.06em;text-transform:uppercase;margin:6px 0 8px">${esc(x.title)}</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;border-collapse:collapse;background:${x.warn ? '#FDF3E3' : '#F1F8F9'};border-radius:12px">${x.rows
          .map(
            ([k, v], i) =>
              `<tr><td style="padding:9px 16px;font:13px ${FONT};color:#3A3536;${i ? 'border-top:1px solid #DCEBEC;' : ''}">${esc(k)}</td><td align="right" style="padding:9px 16px;font:600 13px ${FONT};color:${INK};${i ? 'border-top:1px solid #DCEBEC;' : ''}">${esc(v)}</td></tr>`,
          )
          .join('')}</table>`,
    )
    .join('');
  const contact = [b.address, b.contact].filter(Boolean).map(esc).join(' &middot; ');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${esc(l.heading)}</title></head>
<body style="margin:0;padding:0;background:#EDF2F2">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(l.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EDF2F2"><tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#FFFFFF;border-radius:16px;overflow:hidden;border-collapse:separate">
    <tr><td style="padding:0;line-height:0;font-size:0">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td width="60%" style="height:6px;background:${TEAL}"></td><td width="40%" style="height:6px;background:#ECC039"></td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:26px 30px 6px"><img src="${logo}" width="180" alt="JoshWorks · Graphic Designer" style="display:block;width:180px;max-width:60%;height:auto;border:0"></td></tr>
    <tr><td style="padding:14px 30px 0">
      <h1 style="margin:0 0 14px;font:800 23px/1.3 ${FONT};color:${INK}">${esc(l.heading)}</h1>
      ${l.paragraphs.map(p).join('')}
      ${highlight}${rows}${sections}
      ${l.note ? `<p style="margin:0 0 14px;font:13px/1.55 ${FONT};color:#6B6566">${l.note}</p>` : ''}
      ${p(`Thank you,<br><strong>${esc(b.name || 'JoshWorks')}</strong>`)}
    </td></tr>
    <tr><td style="padding:16px 30px 22px;border-top:1px solid #EEF0F0">
      <p style="margin:0;font:12px/1.6 ${FONT};color:#8A8485">${esc(b.name || 'JoshWorks')}${b.tagline ? ` &middot; ${esc(b.tagline)}` : ''}${contact ? `<br>${contact}` : ''}</p>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

function plain(l: Layout, b: BusinessSettings): string {
  const strip = (s: string) => s.replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&middot;/g, '·');
  return [
    l.heading,
    '',
    ...l.paragraphs.map(strip),
    ...(l.highlight ? ['', `${l.highlight.label}: ${l.highlight.value}`] : []),
    ...(l.rows ?? []).map(([k, v]) => `${k}: ${v}`),
    ...(l.sections ?? []).filter((x) => x.rows.length).flatMap((x) => ['', x.title.toUpperCase(), ...x.rows.map(([k, v]) => `${k}: ${v}`)]),
    ...(l.note ? ['', strip(l.note)] : []),
    '',
    `Thank you,\n${b.name || 'JoshWorks'}`,
    '',
    [b.name, b.address, b.contact].filter(Boolean).join(' · '),
  ].join('\n');
}

const build = (b: BusinessSettings, subject: string, l: Layout): EmailContent => ({ subject, html: layout(b, l), text: plain(l, b) });

/** A booth sale's receipt: what they bought, discounts, how they paid, and their stamps. */
export function saleReceiptEmail(b: BusinessSettings, sale: Sale, o: { eventName: string; customerName?: string; stampLine?: string }): EmailContent {
  const name = o.customerName?.split(/\s+/)[0];
  return build(b, `Your receipt ${sale.receiptNo} · ${b.name || 'JoshWorks'}`, {
    preheader: `${peso(sale.total)} at ${o.eventName}. Thank you for supporting ${b.name || 'JoshWorks'}!`,
    heading: 'Thank you for your purchase!',
    paragraphs: [`Hi ${esc(name || 'there')}, here’s your receipt from the ${esc(b.name || 'JoshWorks')} booth at <strong>${esc(o.eventName)}</strong>.`],
    highlight: { label: 'Total paid', value: peso(sale.total) },
    rows: [
      ...sale.lines.map((l) => [`${l.qty} × ${l.name}`, l.free ? 'Free' : peso(l.gross)] as [string, string]),
      ...sale.discounts.map((d) => [d.label, `−${peso(d.amount)}`] as [string, string]),
      ['Paid by', sale.payments.map((p) => p.name).join(' + ')],
      ['Receipt no.', sale.receiptNo],
      ['Date', fmtDateTime(sale.at)],
      ...(o.stampLine ? ([['Stamp card', o.stampLine]] as [string, string][]) : []),
    ],
    note: `${b.receiptFooter ? `${esc(b.receiptFooter)} ` : ''}This is an acknowledgment receipt for your records, not a BIR official receipt.`,
  });
}

export function testEmail(b: BusinessSettings): EmailContent {
  return build(b, `Test email from ${b.name || 'JoshWorks'} POS`, {
    preheader: 'Emailed receipts are set up.',
    heading: 'Emailed receipts are working',
    paragraphs: ['This test came from JoshWorks POS through the studio Gmail. Receipts look like this, with the items, discounts and how the customer paid.'],
    rows: [
      ['1 × Cat Meme (Solo)', peso(2000)],
      ['Paid by', 'GCash'],
    ],
  });
}

/**
 * The end-of-day summary for the owner: the day's sales and payments, each
 * register's count, and the booth's inventory (what's left, what's low).
 */
export function daySummaryEmail(b: BusinessSettings, i: ReportInput, day: string, o: { materials?: readonly Material[]; reason: string }): EmailContent {
  const from = dayStart(day);
  const to = dayStart(addDays(day, 1));
  const allToday = i.sales.filter((x) => x.at >= from && x.at < to);
  const daySales = allToday.filter((x) => x.kind !== 'deposit');
  const done = daySales.filter((x) => x.status === 'completed');
  const deposits = allToday.filter((x) => x.kind === 'deposit' && x.status === 'completed');
  const gross = sum(done.map((x) => x.total));
  const items = sum(done.flatMap((x) => x.lines.map((l) => l.qty)));
  const discounts = sum(done.map((x) => x.discountTotal));
  const methods = new Map<string, { name: string; amount: number; count: number }>();
  for (const x of [...done, ...deposits])
    for (const pm of x.payments) {
      if (pm.kind === 'deposit') continue;
      const v = methods.get(pm.methodId) ?? { name: pm.name, amount: 0, count: 0 };
      v.amount += pm.amount;
      v.count += 1;
      methods.set(pm.methodId, v);
    }
  const registers = i.sessions
    .filter((x) => isoDate(x.openedAt) === day)
    .map((x) => {
      const d = drawerState(x, i.sales);
      const result = d.counted === null ? 'still open' : d.overShort === 0 ? 'balanced' : (d.overShort ?? 0) > 0 ? `over ${peso(d.overShort)}` : `short ${peso(-(d.overShort ?? 0))}`;
      return [`Register ${x.letter}${x.closedAt ? ` (closed ${fmtTime(x.closedAt)})` : ''}`, d.counted === null ? `expected ${peso(d.expected)} · ${result}` : `counted ${peso(d.counted)} · ${result}`] as [string, string];
    });
  const stock = dayStock(i.eventProducts, (id) => i.products.get(id)?.name ?? 'Deleted product', i.sales.filter((x) => x.status === 'completed'), from, to);
  const restock = stock.filter((r) => r.status === 'out' || r.status === 'low');
  const reorder = (o.materials ?? []).filter((m) => m.deleted !== 1 && m.reorderAt > 0 && (m.counted === 1 || m.onHand > 0) && m.onHand <= m.reorderAt);
  const left = (r: (typeof stock)[number]) => (r.left === null ? 'not counted' : r.left <= 0 ? 'OUT' : `${r.left} left`);
  const venue = i.ev.venue ? ` at ${esc(i.ev.venue)}` : '';
  return build(b, `End of day · ${i.ev.name} · ${fmtIsoWeekday(day)}`, {
    preheader: `${peso(gross)} from ${done.length} sale${done.length === 1 ? '' : 's'}.${restock.length ? ` ${restock.length} product${restock.length === 1 ? '' : 's'} low or out.` : ''}`,
    heading: `${i.ev.name}: end of day`,
    paragraphs: [`Here’s how ${fmtIsoWeekday(day)} went at the booth${venue}. The end-of-day sheet (payments, registers, inventory) is attached as a PDF.`],
    highlight: { label: 'Sales today', value: peso(gross) },
    rows: [
      ['Transactions', String(done.length)],
      ['Items sold', String(items)],
      ['Average sale', peso(done.length ? Math.round(gross / done.length) : 0)],
      ...(discounts ? ([['Discounts given', peso(discounts)]] as [string, string][]) : []),
      ...(daySales.length > done.length ? ([['Voided', String(daySales.length - done.length)]] as [string, string][]) : []),
      ...(deposits.length ? ([['Order deposits taken', peso(sum(deposits.map((x) => x.total)))]] as [string, string][]) : []),
      ['Whole event so far', peso(i.metrics.gross)],
    ],
    sections: [
      { title: 'Payments', rows: [...methods.values()].map((m) => [m.name, `${peso(m.amount)} (${m.count})`] as [string, string]) },
      { title: 'Registers', rows: registers },
      { title: 'Restock before the next day', warn: true, rows: restock.map((r) => [r.name, left(r)] as [string, string]) },
      { title: 'Inventory', rows: stock.slice(0, 60).map((r) => [r.name, `sold ${r.soldToday} today · ${left(r)}`] as [string, string]) },
      { title: 'Materials to reorder', warn: true, rows: reorder.map((m) => [m.name, `${m.onHand} ${m.unit} left`] as [string, string]) },
    ],
    note: `${esc(o.reason)} Sales from other phones show up here after they're merged in.`,
  });
}

export function fmtSummaryReason(reason: 'closed' | 'scheduled' | 'catch-up' | 'manual', at = Date.now()): string {
  if (reason === 'closed') return `Sent automatically by JoshWorks POS when the register closed (${fmtDateTime(at)}).`;
  if (reason === 'scheduled') return `Sent automatically by JoshWorks POS at ${fmtTime(at)}.`;
  if (reason === 'catch-up') return 'Sent automatically by JoshWorks POS (this day hadn’t been summarized yet).';
  return `Sent from JoshWorks POS on ${fmtDateTime(at)}.`;
}

/** "Your order is ready": the queue number, what's in it, and the balance to bring. */
export function orderReadyEmail(b: BusinessSettings, o: { number: string; customerName: string; eventName: string; items: string[]; balance: number }): EmailContent {
  const name = o.customerName.split(/\s+/)[0];
  return build(b, `Your order ${o.number} is ready · ${b.name || 'JoshWorks'}`, {
    preheader: `Pick it up at the ${b.name || 'JoshWorks'} booth.`,
    heading: 'Your order is ready!',
    paragraphs: [`Hi ${esc(name || 'there')}, your order is ready for pickup at the ${esc(b.name || 'JoshWorks')} booth at <strong>${esc(o.eventName)}</strong>. Show this email or tell us your order number.`],
    highlight: { label: 'Order number', value: o.number },
    rows: [...o.items.map((x) => [x, ''] as [string, string]), ['Balance to pay', o.balance > 0 ? peso(o.balance) : 'Fully paid']],
  });
}

/** The same message as plain text, for Messenger, Viber or SMS. */
export function orderReadyText(b: BusinessSettings, o: { number: string; customerName: string; eventName: string; balance: number }): string {
  const name = o.customerName.split(/\s+/)[0];
  return `Hi ${name || 'there'}! Your ${b.name || 'JoshWorks'} order ${o.number} is ready for pickup at our booth at ${o.eventName}.${o.balance > 0 ? ` Balance: ${peso(o.balance)}.` : ' It is fully paid.'} See you!`;
}
