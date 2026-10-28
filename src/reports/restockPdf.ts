import type { Content, TableCell } from 'pdfmake/interfaces';
import { frame, kpis, table, td, th } from './pdf';
import { peso, sum } from '../lib/money';
import type { MaterialNeed, RestockRow } from '../domain/restock';

/** A printable production sheet for the studio: what to make and what to buy before the event. */
export async function buildRestockPdf(i: { business: string; eventName: string; hours: number; safety: number; basedOn: string[]; rows: RestockRow[]; needs: MaterialNeed[] }) {
  const make = i.rows.filter((r) => r.make > 0);
  const content: Content[] = [
    { text: `Restock plan: ${i.eventName}`, style: 'h1' },
    { text: `${i.hours} hours open, ${i.safety}% extra. Based on ${i.basedOn.join(', ') || 'no past events'}.`, style: 'muted', margin: [0, 0, 0, 8] },
    kpis([
      { label: 'Products', value: String(i.rows.length) },
      { label: 'Pieces to bring', value: String(sum(i.rows.map((r) => r.target))) },
      { label: 'Pieces to make', value: String(sum(make.map((r) => r.make))) },
      { label: 'Materials to buy', value: peso(sum(i.needs.map((n) => n.cost ?? 0))) },
    ]),
    { text: 'What to make', style: 'h2' },
    table(
      ['*', 'auto', 'auto', 'auto', 'auto'],
      [th('Product'), th('Sold / hour', true), th('Bring', true), th('In studio', true), th('Make', true)],
      i.rows.map((r) => [td(r.name), td(r.perHour, true), td(r.target, true), td(r.inStudio, true), td(r.make || '—', true, r.make ? { bold: true } : {})] as TableCell[]),
    ),
    ...(i.needs.length
      ? [
          { text: 'Materials to buy', style: 'h2' } as Content,
          table(
            ['*', 'auto', 'auto', 'auto', 'auto'],
            [th('Material'), th('Needed', true), th('On hand', true), th('Packs', true), th('Cost', true)],
            i.needs.map((n) => [td(n.name), td(`${n.need} ${n.unit}`, true), td(n.onHand, true), td(`${n.packs} × ${n.packQty}`, true), td(n.cost === null ? 'no cost' : peso(n.cost), true)] as TableCell[]),
          ),
        ]
      : []),
  ];
  return frame({ title: 'Restock plan', subtitle: i.eventName, business: i.business }, content);
}
