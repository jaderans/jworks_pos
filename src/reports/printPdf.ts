import type { Content } from 'pdfmake/interfaces';
import { docTitle, frame, infoGrid, paymentDetails, sectionTitle, table, td, th, waterfall } from './pdf';
import { peso } from '../lib/money';
import { fmtIsoDate, isoDate } from '../lib/time';
import { lineTotal, printTotals } from '../domain/print';
import type { PrintOrder, PrintRates } from '../db/types';

/** The print quote and job order the customer gets: what's printed, the down payment, where to pay. */
export async function buildPrintPdf(o: PrintOrder, ctx: { business: string; rates: PrintRates; payMethods: { label: string; qr: string }[] }) {
  const t = printTotals(o, ctx.rates.downPct);
  const { leadDays } = ctx.rates;
  const when = o.dueDate ? `Ready by ${fmtIsoDate(o.dueDate)}` : `${leadDays.min}–${leadDays.max} working days after the proof is approved`;
  const content: Content[] = [
    docTitle('Sticker printing quote'),
    infoGrid([
      { label: 'Prepared for', value: { stack: [{ text: o.customerName || '—', bold: true }, ...(o.contact ? [{ text: o.contact, style: 'muted' }] : [])] } },
      { label: 'Order no.', value: o.number, width: 100 },
      { label: 'Date · ready', value: { text: `${fmtIsoDate(isoDate(o.createdAt))} · ${o.dueDate ? fmtIsoDate(o.dueDate) : `${leadDays.min}–${leadDays.max} working days`}` }, width: 150 },
    ]),
    sectionTitle('What we print'),
    table(
      ['*', 'auto', 'auto', 'auto'],
      [th('Item'), th('Qty', true), th('Price', true), th('Amount', true)],
      o.lines.map((l) => [td(l.label), td(l.qty, true), td(peso(l.unitPrice, { decimals: 2 }), true), td(peso(lineTotal(l)), true)]),
    ),
    waterfall([
      { label: 'Printing and packaging', value: peso(t.subtotal) },
      ...(t.discount ? [{ label: `Coupon ${o.coupon?.code ?? ''}`, value: `−${peso(t.discount)}`, kind: 'sub' as const }] : []),
      ...(t.delivery ? [{ label: `Delivery${o.delivery.courier ? ` (${o.delivery.courier})` : ''}`, value: peso(t.delivery), kind: 'sub' as const }] : []),
      { label: 'Total', value: peso(t.total), kind: 'final' },
      { label: `${ctx.rates.downPct}% down payment to start`, value: peso(t.down), kind: 'sub' },
      ...(t.paid ? [{ label: 'Paid so far', value: peso(t.paid), kind: 'sub' as const }, { label: 'Balance', value: peso(t.balance), kind: 'total' as const }] : []),
    ]),
    sectionTitle('How it works'),
    {
      ul: [
        `A ${ctx.rates.downPct}% down payment confirms the order; we print once the proof is approved and it's paid.`,
        `${when}. The balance is paid at pickup or before we ship.`,
        o.delivery.method === 'courier' ? `Delivered by courier${o.delivery.courier ? ` (${o.delivery.courier})` : ''} to: ${o.delivery.address}` : 'Pick up in Iloilo City.',
        `Minimum order: ${ctx.rates.minSheets} A4 sheets; packaging: ${ctx.rates.minPacks} packs per design.`,
        'Files: PNG with a transparent background, or PDF, at 300 DPI; leave 1/8 in (3 mm) around each design for die cuts.',
        'Prints can look slightly different from your screen, especially on holo, glitter and clear stock. Ask for a test print if exact color matters.',
      ],
      fontSize: 8.5,
    } as Content,
    ...(o.notes ? [sectionTitle('Notes'), { text: o.notes, fontSize: 8.5 } as Content] : []),
    ...paymentDetails(ctx.payMethods),
  ];
  return frame({ title: `Sticker printing ${o.number}`, subtitle: o.customerName, business: ctx.business, footerNote: o.number }, content);
}
