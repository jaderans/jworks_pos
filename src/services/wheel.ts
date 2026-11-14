import { alive, db } from '../db/db';
import { audit, patch } from '../db/write';
import type { DeviceInfo } from '../db/local';
import { peso } from '../lib/money';
import { isoDate } from '../lib/time';
import { priceCart } from '../domain/cart';
import { TRY_AGAIN, landingTurn, pickPrize, wheelQualifies, wheelSlices, winsToday, type WheelPrize, type WheelSlice } from '../domain/wheel';
import { completeSale } from './sales';
import { effectivePrice } from './catalog';
import { saveVoucher } from './customers';
import type { JWEvent, Sale, Session, Voucher } from '../db/types';

/** A fair draw in [0, 1) from the browser's random source. */
function draw(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] / 2 ** 32;
}

const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function prizeCode(): string {
  const a = new Uint32Array(5);
  crypto.getRandomValues(a);
  return `WIN-${[...a].map((n) => CODE_LETTERS[n % CODE_LETTERS.length]).join('')}`;
}

export interface Spin {
  prize: WheelPrize | null;
  label: string;
  /** What to tell the customer and the cashier. */
  detail: string;
  slices: WheelSlice[];
  turn: number;
  voucher?: Voucher;
  prizeSale?: Sale;
}

/**
 * Spin the wheel for a sale that qualifies. A product prize is handed over as
 * a ₱0 sale (it comes out of stock); a discount is a one-time voucher code for
 * this event. The result stays on the sale, so it spins only once.
 */
export async function spinWheel(o: { ev: JWEvent; saleId: string; session: Session; device: DeviceInfo; by: string | null }): Promise<Spin> {
  const cfg = o.ev.wheel;
  const sale = await db.sales.get(o.saleId);
  if (!sale || !cfg?.on) throw new Error('The prize wheel is off for this event.');
  if (sale.wheel) throw new Error(`${sale.receiptNo} already spun the wheel.`);
  if (!wheelQualifies(sale, cfg)) throw new Error(`${sale.receiptNo} doesn’t qualify for the wheel.`);
  const today = isoDate();
  const sales = alive(await db.sales.where('eventId').equals(o.ev.id).toArray());
  const prize = pickPrize(cfg, winsToday(sales, today), draw());
  const slices = wheelSlices(cfg);
  let voucher: Voucher | undefined;
  let prizeSale: Sale | undefined;
  let detail = 'No prize this time. Thank you for shopping!';

  if (prize?.kind === 'item' && prize.productId) {
    const p = await db.products.get(prize.productId);
    if (p && p.deleted !== 1) {
      const ep = (await db.eventProducts.where('eventId').equals(o.ev.id).toArray()).find((x) => x.productId === p.id && x.deleted !== 1);
      const priced = priceCart(
        [{ key: 'prize', productId: p.id, name: p.name, categoryId: p.categoryId, unitPrice: effectivePrice(p, ep) ?? 0, qty: 1, free: true, freeReason: `Wheel prize for ${sale.receiptNo}`, designerId: p.designerId }],
        [],
        [],
      );
      prizeSale = await completeSale({
        eventId: o.ev.id,
        session: o.session,
        device: o.device,
        cashierId: o.by,
        priced,
        payments: [],
        note: `Wheel prize: ${prize.label} (for ${sale.receiptNo})`,
        customerId: sale.customerId ?? null,
        prizeFor: sale.id,
      });
      detail = `Free ${p.name}. Hand it over with their order.`;
    }
  }
  if (prize?.kind === 'voucher' && prize.voucher) {
    const off = prize.voucher.kind === 'amount' ? `${peso(prize.voucher.value)} off` : `${prize.voucher.value}% off`;
    voucher = await saveVoucher({
      code: prizeCode(),
      label: `Wheel prize: ${prize.label}`,
      kind: prize.voucher.kind,
      value: prize.voucher.value,
      minSpend: 0,
      validFrom: today,
      validTo: o.ev.endDate || today,
      eventId: o.ev.id,
      maxUses: 1,
      perCustomer: null,
      notes: `Won on ${sale.receiptNo}`,
    });
    detail = `${off} their next purchase at this event with code ${voucher.code}.`;
  }

  const label = prize?.label ?? TRY_AGAIN;
  await patch(db.sales, sale.id, { wheel: { prizeId: prize?.id ?? null, label, at: Date.now(), ...(voucher ? { code: voucher.code } : {}) } });
  await audit('wheel', 'sale', sale.id, `${sale.receiptNo} spun the prize wheel: ${label}${voucher ? ` (${voucher.code})` : ''}${prizeSale ? ` (${prizeSale.receiptNo})` : ''}`);
  return { prize, label, detail, slices, turn: landingTurn(slices, prize?.id ?? null, draw()), voucher, prizeSale };
}
