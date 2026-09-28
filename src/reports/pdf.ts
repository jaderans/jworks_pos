import type { Content, TDocumentDefinitions, TableCell } from 'pdfmake/interfaces';
import manropeRegular from '../assets/fonts/Manrope-Regular.ttf?url';
import manropeBold from '../assets/fonts/Manrope-Bold.ttf?url';
import manropeExtraBold from '../assets/fonts/Manrope-ExtraBold.ttf?url';
import soraBold from '../assets/fonts/Sora-Bold.ttf?url';
import logoUrl from '../assets/brand/logo-256.png?url';
import { downloadBlob, shareBlob } from '../lib/files';
import { fmtDateTime } from '../lib/time';

/**
 * PDFs are built on the device with pdfmake, using the app's own fonts
 * (Manrope has the ₱ sign), so reports work with no internet.
 */

type PdfMake = typeof import('pdfmake/build/pdfmake');

let loading: Promise<PdfMake> | null = null;
let logoData = '';

async function toBase64(url: string): Promise<string> {
  const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) bin += String.fromCharCode(...buf.subarray(i, i + chunk));
  return btoa(bin);
}

async function load(): Promise<PdfMake> {
  loading ??= (async () => {
    const mod = (await import('pdfmake/build/pdfmake')) as unknown as { default?: PdfMake } & PdfMake;
    const pdfMake = (mod.default ?? mod) as PdfMake;
    const [r, b, x, s, logo] = await Promise.all([toBase64(manropeRegular), toBase64(manropeBold), toBase64(manropeExtraBold), toBase64(soraBold), toBase64(logoUrl)]);
    pdfMake.addVirtualFileSystem({ 'Manrope-Regular.ttf': r, 'Manrope-Bold.ttf': b, 'Manrope-ExtraBold.ttf': x, 'Sora-Bold.ttf': s });
    pdfMake.addFonts({
      Manrope: { normal: 'Manrope-Regular.ttf', bold: 'Manrope-Bold.ttf', italics: 'Manrope-Regular.ttf', bolditalics: 'Manrope-Bold.ttf' },
      ManropeX: { normal: 'Manrope-ExtraBold.ttf', bold: 'Manrope-ExtraBold.ttf', italics: 'Manrope-ExtraBold.ttf', bolditalics: 'Manrope-ExtraBold.ttf' },
      Sora: { normal: 'Sora-Bold.ttf', bold: 'Sora-Bold.ttf', italics: 'Sora-Bold.ttf', bolditalics: 'Sora-Bold.ttf' },
    });
    pdfMake.setUrlAccessPolicy(() => false);
    logoData = `data:image/png;base64,${logo}`;
    return pdfMake;
  })();
  try {
    return await loading;
  } catch (e) {
    loading = null;
    throw e;
  }
}

export const INK = '#152122';
export const MUTED = '#5D6C6D';
export const TEAL = '#087A86';
export const LINE = '#DAE3E3';
export const SOFT = '#EEF4F4';
export const GOOD = '#1E7B45';
export const BAD = '#B3261E';

export interface DocOptions {
  title: string;
  subtitle?: string;
  business: string;
  landscape?: boolean;
}

/**
 * pdfmake rewrites the objects and arrays it is given while laying out a page.
 * Copy the content first so nothing the app is showing on screen gets changed.
 */
function copyContent<T>(v: T): T {
  if (Array.isArray(v)) return v.map((x) => copyContent(x)) as unknown as T;
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = copyContent(x);
    return out as T;
  }
  return v;
}

/** Shared page frame: logo header, page numbers, the house styles. */
export async function frame(opts: DocOptions, rawContent: Content[]): Promise<TDocumentDefinitions> {
  await load();
  const content = copyContent(rawContent);
  const generated = fmtDateTime(Date.now());
  return {
    pageSize: 'A4',
    pageOrientation: opts.landscape ? 'landscape' : 'portrait',
    pageMargins: [36, 64, 36, 44],
    info: { title: opts.title, author: opts.business, creator: 'JoshWorks POS' },
    defaultStyle: { font: 'Manrope', fontSize: 9, color: INK, lineHeight: 1.2 },
    header: () => ({
      margin: [36, 22, 36, 0],
      columns: [
        { image: logoData, width: 26, height: 26 },
        { stack: [{ text: opts.business, style: 'brand' }, { text: opts.title, style: 'muted' }], margin: [8, 1, 0, 0] },
        { text: opts.subtitle ?? '', style: 'muted', alignment: 'right', margin: [0, 8, 0, 0] },
      ],
    }),
    footer: (page: number, pages: number) => ({
      margin: [36, 12, 36, 0],
      columns: [
        { text: `Made with JoshWorks POS · ${generated}`, style: 'muted' },
        { text: `Page ${page} of ${pages}`, style: 'muted', alignment: 'right' },
      ],
    }),
    styles: {
      brand: { font: 'Sora', fontSize: 10, color: INK },
      h1: { font: 'Sora', fontSize: 20, color: INK, margin: [0, 0, 0, 4] },
      h2: { font: 'Sora', fontSize: 12.5, color: INK, margin: [0, 14, 0, 6] },
      h3: { bold: true, fontSize: 10, margin: [0, 8, 0, 4] },
      muted: { color: MUTED, fontSize: 8 },
      label: { color: MUTED, fontSize: 7.5, bold: true, characterSpacing: 0.6 },
      big: { font: 'ManropeX', fontSize: 16 },
      th: { bold: true, fontSize: 7.5, color: MUTED, fillColor: SOFT, characterSpacing: 0.4 },
      num: { alignment: 'right' },
      total: { bold: true },
      good: { color: GOOD, bold: true },
      bad: { color: BAD, bold: true },
      note: { color: MUTED, fontSize: 8, italics: false },
    },
    content,
  };
}

export async function renderPdf(doc: TDocumentDefinitions): Promise<Blob> {
  const pdfMake = await load();
  return pdfMake.createPdf(doc).getBlob();
}

/** Save a PDF; on phones, try the share sheet first when asked. */
export async function deliverPdf(doc: TDocumentDefinitions, filename: string, share = false): Promise<void> {
  const blob = await renderPdf(doc);
  if (share && (await shareBlob(blob, filename, filename))) return;
  downloadBlob(blob, filename);
}

// ----- building blocks -----

export const th = (text: string, right = false): TableCell => ({ text: text.toUpperCase(), style: 'th', alignment: right ? 'right' : 'left' });
export const td = (text: string | number, right = false, extra: Record<string, unknown> = {}): TableCell => ({ text: String(text), alignment: right ? 'right' : 'left', ...extra });

export const tableLayout = {
  hLineWidth: (i: number, node: { table: { body: unknown[] } }) => (i === 0 || i === node.table.body.length ? 0 : 0.6),
  vLineWidth: () => 0,
  hLineColor: () => LINE,
  paddingLeft: () => 6,
  paddingRight: () => 6,
  paddingTop: () => 4,
  paddingBottom: () => 4,
};

export function table(widths: (string | number)[], head: TableCell[], body: TableCell[][], footer?: TableCell[]): Content {
  const rows = [head, ...body, ...(footer ? [footer.map((c) => ({ ...(c as object), bold: true }) as TableCell)] : [])];
  return { table: { headerRows: 1, widths, body: rows, dontBreakRows: true }, layout: tableLayout, margin: [0, 0, 0, 6] } as Content;
}

/** Key numbers as a grid of labelled figures. */
export function kpis(items: { label: string; value: string; hint?: string }[], perRow = 4): Content {
  const rows: TableCell[][] = [];
  for (let i = 0; i < items.length; i += perRow) {
    const row = items.slice(i, i + perRow).map((it) => ({
      stack: [{ text: it.label.toUpperCase(), style: 'label' }, { text: it.value, style: 'big', margin: [0, 2, 0, 0] }, ...(it.hint ? [{ text: it.hint, style: 'muted' }] : [])],
      margin: [0, 2, 0, 6],
    })) as TableCell[];
    while (row.length < perRow) row.push({ text: '' });
    rows.push(row);
  }
  return { table: { widths: Array(perRow).fill('*'), body: rows }, layout: 'noBorders', margin: [0, 4, 0, 6] } as Content;
}

/** A waterfall like "gross − cost = profit", as two columns. */
export function waterfall(rows: { label: string; value: string; kind?: 'sub' | 'total' | 'final' }[]): Content {
  return {
    table: {
      widths: ['*', 'auto'],
      body: rows.map((r) => [
        { text: r.label, bold: r.kind === 'total' || r.kind === 'final', color: r.kind === 'sub' ? MUTED : r.kind === 'final' ? TEAL : INK, margin: [r.kind === 'sub' ? 8 : 0, 0, 0, 0] },
        { text: r.value, alignment: 'right', bold: r.kind === 'total' || r.kind === 'final', color: r.kind === 'final' ? TEAL : INK },
      ]),
    },
    layout: { ...tableLayout, hLineWidth: (i: number, node: { table: { body: unknown[] } }) => (i === 0 || i === node.table.body.length ? 0 : 0.5) },
    margin: [0, 0, 0, 6],
  } as Content;
}

/** Simple vertical bar chart as SVG (pdfmake draws SVG natively). */
export function barChartSvg(data: { label: string; value: number }[], width = 520, height = 150): string {
  if (!data.length) return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20"></svg>`;
  const max = Math.max(...data.map((d) => d.value), 1);
  const padB = 18;
  const slot = width / data.length;
  const bw = Math.min(28, slot * 0.6);
  const bars = data
    .map((d, i) => {
      const h = Math.max(d.value > 0 ? 1.5 : 0, ((height - padB - 4) * d.value) / max);
      const x = slot * i + (slot - bw) / 2;
      return `<rect x="${x.toFixed(1)}" y="${(height - padB - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${TEAL}"/><text x="${(slot * i + slot / 2).toFixed(1)}" y="${height - 5}" font-size="7" fill="${MUTED}" text-anchor="middle">${escapeXml(d.label)}</text>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><line x1="0" x2="${width}" y1="${height - padB}" y2="${height - padB}" stroke="${LINE}" stroke-width="0.8"/>${bars}</svg>`;
}

const escapeXml = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c] as string);

export function signatureLine(label: string): Content {
  return { columns: [{ stack: [{ text: ' ', margin: [0, 16, 0, 0] }, { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 170, y2: 0, lineWidth: 0.6, lineColor: MUTED }] }, { text: label, style: 'muted', margin: [0, 3, 0, 0] }] }] } as Content;
}

export async function logo(): Promise<string> {
  await load();
  return logoData;
}
