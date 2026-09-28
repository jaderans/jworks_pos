import { db, alive } from '../db/db';
import { audit, create, patch, remove } from '../db/write';
import { peso } from '../lib/money';
import type { Quote, QuoteStatus } from '../db/types';

export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = {
  quoted: 'Quoted',
  won: 'Won',
  lost: 'Lost',
  delivered: 'Delivered',
};

export async function nextQuoteNo(): Promise<string> {
  const all = alive(await db.quotes.toArray());
  let max = 0;
  for (const q of all) {
    const m = /^Q-(\d+)$/.exec(q.quoteNo);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `Q-${String(max + 1).padStart(3, '0')}`;
}

export async function saveQuote(fields: Omit<Quote, 'id' | 'createdAt' | 'updatedAt' | 'quoteNo'> & { quoteNo?: string }): Promise<Quote> {
  const quoteNo = fields.quoteNo || (await nextQuoteNo());
  const q = await create<Quote>(db.quotes, { ...fields, quoteNo });
  await audit('create', 'quote', q.id, `Saved quote ${q.quoteNo} for ${q.client || 'a client'}: ${peso(q.total)}`);
  return q;
}

export async function setQuoteStatus(id: string, status: QuoteStatus) {
  const q = await db.quotes.get(id);
  await patch(db.quotes, id, { status });
  if (q) await audit('status', 'quote', id, `${q.quoteNo} marked ${QUOTE_STATUS_LABEL[status]}`);
}

export async function updateQuote(id: string, changes: Partial<Quote>) {
  await patch(db.quotes, id, changes);
}

export async function deleteQuote(id: string) {
  await remove(db.quotes, id);
}
