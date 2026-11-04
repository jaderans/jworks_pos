import { db, alive } from '../db/db';
import { audit, create, patch, remove } from '../db/write';
import { peso, type Cents } from '../lib/money';
import { uid } from '../lib/ids';
import { claimId } from '../domain/coupons';
import { resolveCoupon, syncClaim } from './coupons';
import type { ServiceQuoteResult } from '../domain/quote';
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

/** The price before the coupon (and VAT): what the coupon's minimum is checked against. */
const quotePrice = (q: Pick<Quote, 'total' | 'inputs'>): Cents => (q.inputs as { result?: ServiceQuoteResult } | null)?.result?.totalPrice ?? q.total;

const claimFor = (q: Quote, price = quotePrice(q)) => ({ source: 'quote' as const, sourceId: q.id, service: `Quote ${q.quoteNo}${q.project ? `: ${q.project}` : ''}`, customerId: null, customerName: q.client, price });

export async function saveQuote({
  couponCode,
  servicePrice,
  ...fields
}: Omit<Quote, 'id' | 'createdAt' | 'updatedAt' | 'quoteNo'> & { quoteNo?: string; couponCode?: string; servicePrice?: Cents }): Promise<Quote> {
  const id = uid();
  const coupon = await resolveCoupon(couponCode, servicePrice ?? fields.total, claimId('quote', id));
  const quoteNo = fields.quoteNo || (await nextQuoteNo());
  const q = await create<Quote>(db.quotes, { ...fields, id, quoteNo, coupon });
  await syncClaim(claimFor(q, servicePrice), coupon);
  await audit('create', 'quote', q.id, `Saved quote ${q.quoteNo} for ${q.client || 'a client'}: ${peso(q.total)}${coupon ? ` with coupon ${coupon.code}` : ''}`);
  return q;
}

/** A lost quote lets its coupon go; winning it back claims the coupon again. */
export async function setQuoteStatus(id: string, status: QuoteStatus) {
  const q = await db.quotes.get(id);
  await patch(db.quotes, id, { status });
  if (!q) return;
  // The claim keeps the price it was made with (a released one is a tombstone that still has it).
  if (q.coupon) await syncClaim(claimFor(q, (await db.couponClaims.get(claimId('quote', id)))?.price), status === 'lost' ? null : q.coupon);
  await audit('status', 'quote', id, `${q.quoteNo} marked ${QUOTE_STATUS_LABEL[status]}`);
}

export async function updateQuote(id: string, changes: Partial<Quote>) {
  await patch(db.quotes, id, changes);
}

export async function deleteQuote(id: string) {
  const q = await db.quotes.get(id);
  if (q?.coupon) await syncClaim(claimFor(q), null);
  await remove(db.quotes, id);
}
