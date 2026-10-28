import type { Content, TableCell } from 'pdfmake/interfaces';
import { docTitle, frame, infoGrid, kpis, sectionTitle, table, td, th } from './pdf';
import { peso, sum } from '../lib/money';
import type { MaterialNeed, RestockRow } from '../domain/restock';

/** A printable production sheet for the studio: what to make and what to buy before the event. */
export async function buildRestockPdf(i: { business: string; eventName: string; hours: number; safety: number; basedOn: string[]; rows: RestockRow[]; needs: MaterialNeed[] }) {
  const make = i.rows.filter((r) => r.make > 0);
  const content: Content[] = [
    docTitle('Restock plan'),
    infoGrid([
      { label: 'For the event', value: i.eventName },
      { label: 'Hours open', value: { text: `${i.hours} h, ${i.safety}% extra` }, width: 120 },
      { label: 'Based on', value: { text: i.basedOn.join(', ') || 'No past events' }, width: 170 },
    ]),
    kpis([
      { label: 'Products', value: String(i.rows.length) },
      { label: 'Pieces to bring', value: String(sum(i.rows.map((r) => r.target))) },
      { label: 'Pieces to make', value: String(sum(make.map((r) => r.make))) },
      { label: 'Materials to buy', value: peso(sum(i.needs.map((n) => n.cost ?? 0))) },
    ]),
    sectionTitle('What to make'),
    table(
      ['*', 'auto', 'auto', 'auto', 'auto'],
      [th('Product'), th('Sold / hour', true), th('Bring', true), th('In studio', true), th('Make', true)],
      i.rows.map((r) => [td(r.name), td(r.perHour, true), td(r.target, true), td(r.inStudio, true), td(r.make || '—', true, r.make ? { bold: true } : {})] as TableCell[]),
    ),
    ...(i.needs.length
      ? [
          sectionTitle('Materials to buy'),
          table(
            ['*', 'auto', 'auto', 'auto', 'auto'],
            [th('Material'), th('Needed', true), th('On hand', true), th('Packs', true), th('Cost', true)],
            i.needs.map((n) => [td(n.name), td(`${n.need} ${n.unit}`, true), td(n.onHand, true), td(`${n.packs} × ${n.packQty}`, true), td(n.cost === null ? 'no cost' : peso(n.cost), true)] as TableCell[]),
          ),
        ]
      : []),
  ];
  return frame({ title: 'Restock plan', subtitle: i.eventName, business: i.business, footerNote: i.eventName }, content);
}
