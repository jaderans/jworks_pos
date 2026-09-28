import type { Content } from 'pdfmake/interfaces';
import { frame } from './pdf';
import { peso } from '../lib/money';
import type { Product } from '../db/types';

/** A Code 128 barcode as a PNG data URL (drawn on a canvas by JsBarcode). */
export async function barcodePng(value: string, opts: { height?: number; width?: number; fontSize?: number } = {}): Promise<string> {
  const { default: JsBarcode } = await import('jsbarcode');
  const canvas = document.createElement('canvas');
  JsBarcode(canvas, value, { format: 'CODE128', height: opts.height ?? 60, width: opts.width ?? 2, fontSize: opts.fontSize ?? 16, margin: 6, displayValue: true, font: 'monospace' });
  return canvas.toDataURL('image/png');
}

export interface LabelOptions {
  columns: number;
  showPrice: boolean;
  business: string;
}

/**
 * A sheet of product labels for A4 sticker paper: name, price and barcode.
 * `items` repeats each product as many times as copies were asked for.
 */
export async function buildLabelSheet(items: { product: Product; price: number | null }[], opts: LabelOptions) {
  const cache = new Map<string, string>();
  const cells: Content[] = [];
  for (const it of items) {
    const code = it.product.barcode || it.product.sku;
    if (!code) continue;
    if (!cache.has(code)) cache.set(code, await barcodePng(code));
    cells.push({
      stack: [
        { text: it.product.name, bold: true, fontSize: opts.columns >= 4 ? 7 : 8.5, maxHeight: 22 },
        ...(opts.showPrice && it.price !== null ? [{ text: peso(it.price), font: 'ManropeX', fontSize: opts.columns >= 4 ? 9 : 11 }] : []),
        { image: cache.get(code)!, width: opts.columns >= 4 ? 100 : 130, margin: [0, 2, 0, 0] },
      ],
      margin: [4, 6, 4, 6],
    } as Content);
  }
  const rows: Content[][] = [];
  for (let i = 0; i < cells.length; i += opts.columns) {
    const row = cells.slice(i, i + opts.columns);
    while (row.length < opts.columns) row.push({ text: '' });
    rows.push(row);
  }
  const content: Content[] = rows.length
    ? [
        {
          table: { widths: Array(opts.columns).fill('*'), body: rows, dontBreakRows: true },
          layout: {
            hLineWidth: () => 0.4,
            vLineWidth: () => 0.4,
            hLineColor: () => '#DAE3E3',
            vLineColor: () => '#DAE3E3',
            hLineStyle: () => ({ dash: { length: 2, space: 2 } }),
            vLineStyle: () => ({ dash: { length: 2, space: 2 } }),
          },
        } as Content,
      ]
    : [{ text: 'None of the chosen products has a barcode or code yet.' }];
  return frame({ title: 'Barcode labels', business: opts.business }, content);
}
