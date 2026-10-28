import type { Content } from 'pdfmake/interfaces';
import { docTitle, frame, infoGrid, paymentDetails, sectionTitle, signatureLine, table, td, th, waterfall } from './pdf';
import { peso } from '../lib/money';
import { addDays, fmtIsoDate } from '../lib/time';
import type { LaborLine, OutsourcedLine, ServiceQuoteResult } from '../domain/quote';

export interface QuotePdfInput {
  business: { name: string; contact: string; address: string };
  quoteNo: string;
  date: string;
  client: string;
  project: string;
  category: string;
  qty: number;
  result: ServiceQuoteResult;
  labor: LaborLine[];
  outsourced: OutsourcedLine[];
  vat: boolean;
  ewt: boolean;
  /** Payment methods with a QR image, shown at the end so the client can pay the down payment. */
  payMethods?: { label: string; qr: string }[];
}

const DOWN_PCT = 50;

/** A client-facing quotation on the JoshWorks letterhead, laid out like JoshWorks Studio's: scope and price, not your costs. */
export async function buildQuotePdf(q: QuotePdfInput) {
  const r = q.result;
  const validUntil = addDays(q.date, 30);
  const scope: string[] = [
    ...q.labor.filter((l) => l.hours > 0).map((l) => `${l.role}: ${l.hours} h`),
    ...q.outsourced.filter((o) => o.desc).map((o) => `${o.desc}${o.qty > 1 ? ` × ${o.qty}` : ''}`),
  ];
  const payable = q.ewt ? r.cashReceived : r.invoice;
  const content: Content[] = [
    docTitle('Quotation'),
    infoGrid([
      { label: 'Prepared for', value: { stack: [{ text: q.client || '—', bold: true }, ...(q.project ? [{ text: q.project, style: 'muted' }] : [])] } },
      { label: 'Quote no.', value: q.quoteNo, width: 110 },
      { label: 'Date · valid until', value: { text: `${fmtIsoDate(q.date)} · ${fmtIsoDate(validUntil)}` }, width: 110 },
    ]),
    sectionTitle('Items'),
    table(
      ['*', 'auto', 'auto', 'auto'],
      [th('Item'), th('Qty', true), th('Price', true), th('Amount', true)],
      [
        // Quotes saved before add-ons were folded into the price have no base fields; their price was the base.
        [td(`${q.project || 'Design work'}${q.category ? ` (${q.category})` : ''}`), td(q.qty, true), td(peso(r.basePricePerPc ?? r.pricePerPc), true), td(peso(r.baseTotal ?? r.totalPrice), true)],
        ...r.addons.map((a) => [td(a.label), td(''), td(''), td(peso(a.amount), true)]),
      ],
    ),
    waterfall([
      { label: 'Subtotal', value: peso(r.subtotal) },
      ...(q.vat ? [{ label: 'VAT', value: peso(r.vat), kind: 'sub' as const }] : []),
      { label: 'Total', value: peso(r.invoice), kind: 'final' },
      ...(q.ewt ? [{ label: 'Less 2% expanded withholding tax (with BIR 2307)', value: `−${peso(r.ewt)}`, kind: 'sub' as const }, { label: 'Amount payable', value: peso(r.cashReceived), kind: 'total' as const }] : []),
      { label: `${DOWN_PCT}% down payment to start`, value: peso(Math.round((payable * DOWN_PCT) / 100)), kind: 'sub' },
    ]),
  ];
  if (scope.length) content.push(sectionTitle('Scope of work'), { ul: scope, fontSize: 8.5 } as Content);
  content.push(
    sectionTitle('Terms'),
    {
      ul: [
        `A ${DOWN_PCT}% down payment before work starts; the balance on delivery.`,
        'Two revision rounds included; more are billed per round.',
        `Prices in Philippine pesos. This quotation is valid until ${fmtIsoDate(validUntil)}.`,
      ],
      fontSize: 8.5,
    } as Content,
    ...paymentDetails(q.payMethods ?? []),
    { columns: [signatureLine(`For ${q.business.name}`), signatureLine('Accepted by the client')], margin: [0, 28, 0, 0] } as Content,
  );
  return frame({ title: 'Quotation', subtitle: q.quoteNo, business: q.business.name, footerNote: q.quoteNo }, content);
}

/** Active payment methods that have a QR image (Settings → Payment methods), in their saved order. */
export async function quotePayMethods(): Promise<{ label: string; qr: string }[]> {
  const { alive, db } = await import('../db/db');
  const methods = alive(await db.paymentMethods.toArray()).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  return methods.filter((m) => m.active === 1 && m.qr).map((m) => ({ label: m.name, qr: m.qr as string }));
}
