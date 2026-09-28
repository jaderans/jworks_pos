import type { Content } from 'pdfmake/interfaces';
import { frame, signatureLine, table, td, th, waterfall } from './pdf';
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
}

/** A client-facing quotation: scope and price, not your costs. */
export async function buildQuotePdf(q: QuotePdfInput) {
  const r = q.result;
  const scope: Content[] = [
    ...q.labor.filter((l) => l.hours > 0).map((l) => ({ text: `${l.role}: ${l.hours} h` }) as Content),
    ...q.outsourced.filter((o) => o.desc).map((o) => ({ text: `${o.desc}${o.qty > 1 ? ` × ${o.qty}` : ''}` }) as Content),
  ];
  const content: Content[] = [
    { text: 'Quotation', style: 'h1' },
    {
      columns: [
        { stack: [{ text: 'FOR', style: 'label' }, { text: q.client || '—', bold: true }, { text: q.project, style: 'muted' }] },
        {
          stack: [
            { text: 'QUOTE', style: 'label', alignment: 'right' },
            { text: q.quoteNo, bold: true, alignment: 'right' },
            { text: `${fmtIsoDate(q.date)} · valid until ${fmtIsoDate(addDays(q.date, 30))}`, style: 'muted', alignment: 'right' },
          ],
        },
      ],
      margin: [0, 6, 0, 12],
    },
    table(
      ['*', 'auto', 'auto', 'auto'],
      [th('Description'), th('Qty', true), th('Price each', true), th('Amount', true)],
      [
        [td(`${q.project}${q.category ? ` (${q.category})` : ''}`), td(q.qty, true), td(peso(r.pricePerPc), true), td(peso(r.totalPrice), true)],
        ...r.addons.map((a) => [td(a.label), td(''), td(''), td(peso(a.amount), true)]),
      ],
    ),
    waterfall([
      { label: 'Subtotal', value: peso(r.subtotal) },
      ...(q.vat ? [{ label: 'VAT', value: peso(r.vat), kind: 'sub' as const }] : []),
      { label: 'Total', value: peso(r.invoice), kind: 'final' },
      ...(q.ewt ? [{ label: 'Less 2% expanded withholding tax (with BIR 2307)', value: `−${peso(r.ewt)}`, kind: 'sub' as const }, { label: 'Amount payable', value: peso(r.cashReceived), kind: 'total' as const }] : []),
    ]),
  ];
  if (scope.length) content.push({ text: 'Scope of work', style: 'h3' }, { ul: scope } as Content);
  content.push(
    { text: 'Terms', style: 'h3' },
    {
      ul: ['50% downpayment to start, balance on delivery.', 'Two revision rounds included; more are billed per round.', 'Prices in Philippine pesos. This quotation is valid for 30 days.'],
      style: 'muted',
    } as Content,
    { text: [q.business.name, q.business.address, q.business.contact].filter(Boolean).join(' · '), style: 'muted', margin: [0, 18, 0, 0] },
    { columns: [signatureLine(`For ${q.business.name}`), signatureLine('Accepted by the client')], margin: [0, 24, 0, 0] } as Content,
  );
  return frame({ title: 'Quotation', subtitle: q.quoteNo, business: q.business.name }, content);
}
