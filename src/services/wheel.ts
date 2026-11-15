import { alive, db } from '../db/db';
import { audit, patch } from '../db/write';
import type { DeviceInfo } from '../db/local';
import { peso } from '../lib/money';
import { isoDate } from '../lib/time';
import { priceCart } from '../domain/cart';
import { TRY_AGAIN, landingTurn, pickPrize, pickText, spinsFor, spinsLeft, spinsOf, wheelSlices, winsToday, type WheelPrize, type WheelResult, type WheelSlice } from '../domain/wheel';
import { completeSale } from './sales';
import { effectivePrice } from './catalog';
import { saveVoucher } from './customers';
import { blankDelivery, createPrintOrder } from './print';
import { customLine } from '../domain/print';
import { ORDER_LINE } from '../domain/orders';
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
  /** Spins this sale still has after this one. */
  left: number;
  /** Which spin of the sale this was: 1 for the first. */
  nth: number;
  /** Prizes won on this sale's spins so far, this one included (not "Try again" or free spins). */
  won: string[];
}

/**
 * Spin the wheel for a sale that has a spin left. A product prize is handed
 * over as a ₱0 sale (it comes out of stock); a service prize becomes a ₱0
 * service order to make, and a ₱0 Services sale so the Sales log shows it; a
 * discount is a one-time voucher code for this event; a free spin gives the
 * sale one more. Every result stays on the sale, so it spins only as many
 * times as it earned.
 */
export async function spinWheel(o: { ev: JWEvent; saleId: string; session: Session; device: DeviceInfo; by: string | null }): Promise<Spin> {
  const cfg = o.ev.wheel;
  const sale = await db.sales.get(o.saleId);
  if (!sale || !cfg?.on) throw new Error('The prize wheel is off for this event.');
  const done = spinsOf(sale);
  if (spinsLeft(sale, cfg) < 1) throw new Error(done.length ? `${sale.receiptNo} has used all its spins.` : `${sale.receiptNo} doesn’t qualify for the wheel.`);
  const earned = sale.wheelSpins?.earned ?? (done.length ? 1 : spinsFor(cfg, sale));
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
  if (prize?.kind === 'service' && prize.service?.label.trim()) {
    const svc = prize.service;
    const cust = sale.customerId ? await db.customers.get(sale.customerId) : undefined;
    const order = await createPrintOrder(
      {
        customerId: cust && cust.deleted !== 1 ? cust.id : null,
        customerName: cust?.name ?? `Wheel winner (${sale.receiptNo})`,
        contact: cust ? cust.phone || cust.email || '' : '',
        lines: [customLine(`${svc.label.trim()} · wheel prize${svc.value > 0 ? `, worth ${peso(svc.value)}` : ''}`, 1, 0)],
        delivery: blankDelivery(),
        printerId: null,
        files: '',
        notes: `Won on the prize wheel with ${sale.receiptNo} at ${o.ev.name}. Free: nothing to pay.`,
      },
      o.device,
    );
    const priced = priceCart(
      [{ key: 'prize', productId: `${ORDER_LINE}print:${order.id}`, name: `${svc.label.trim()} · service order ${order.number}`, categoryId: null, unitPrice: svc.value, qty: 1, free: true, freeReason: `Wheel prize for ${sale.receiptNo}`, designerId: null }],
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
      note: `Wheel prize: ${prize.label} (for ${sale.receiptNo}), service order ${order.number}`,
      customerId: sale.customerId ?? null,
      kind: 'service',
      printOrderId: order.id,
      prizeFor: sale.id,
    });
    detail = `A free ${svc.label.trim()}: service order ${order.number} on Services. Add their name and contact there.`;
  }
  if (prize?.kind === 'voucher' && prize.voucher) {
    const off = prize.voucher.kind === 'amount' ? `${peso(prize.voucher.value)} off` : `${prize.voucher.value}% off`;
    voucher = await saveVoucher({
      code: prizeCode(),
      label: `Wheel prize: ${prize.label}`,
      kind: prize.voucher.kind,
      value: prize.voucher.value,
      minSpend: Math.max(0, prize.voucher.minSpend ?? 0),
      validFrom: today,
      validTo: o.ev.endDate || today,
      eventId: o.ev.id,
      maxUses: 1,
      perCustomer: null,
      notes: `Won on ${sale.receiptNo}`,
    });
    detail = `${off} their next purchase at this event${prize.voucher.minSpend ? ` of ${peso(prize.voucher.minSpend)} or more` : ''}, with code ${voucher.code}.`;
  }

  if (prize?.kind === 'pick') detail = `Let them pick ${pickText(prize)} from the prize pile.`;
  const again = prize?.kind === 'spin';
  if (again) detail = 'Another spin! Spin the wheel again.';

  const label = prize?.label ?? TRY_AGAIN;
  const result: WheelResult = { prizeId: prize?.id ?? null, label, at: Date.now(), ...(voucher ? { code: voucher.code } : {}), ...(again ? { again: true } : {}) };
  const results = [...done, result];
  await patch(db.sales, sale.id, { wheel: results[0], wheelSpins: { earned, results } });
  const left = Math.max(0, earned + results.filter((r) => r.again).length - results.length);
  const nth = results.length;
  await audit('wheel', 'sale', sale.id, `${sale.receiptNo} spun the prize wheel${nth > 1 ? ` (spin ${nth})` : ''}: ${label}${voucher ? ` (${voucher.code})` : ''}${prizeSale ? ` (${prizeSale.receiptNo})` : ''}`);
  const won = results.filter((r) => r.prizeId && !r.again).map((r) => r.label);
  return { prize, label, detail, slices, turn: landingTurn(slices, prize?.id ?? null, draw()), voucher, prizeSale, left, nth, won };
}
