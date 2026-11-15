import { alive, db } from '../db/db';
import { audit, create, patch } from '../db/write';
import type { DeviceInfo } from '../db/local';
import { getSetting, setSetting } from '../db/settings';
import { DEFAULT_STICK, PACK_NAME, nextStubNumber, packFileName, type StickOrder, type StickSettings } from '../domain/stick';
import type { Order, OrderLine, Sale } from '../db/types';

/**
 * Couple-of-Stickers orders. The packs are paid at the register as a normal
 * sale (stock and money counted there); the order is the job to make them,
 * with its claim number, on Orders. Handing it over charges nothing more.
 */

const linesOf = (s: StickOrder): OrderLine[] =>
  s.packs.map((p) => ({
    productId: null,
    name: `${PACK_NAME[p.pack]}${p.singles ? ' singles' : ''} · ${p.making === 'illustrating' ? 'illustrating' : 'printing'} · ${packFileName(p, s.nickname)}`,
    categoryId: null,
    designerId: null,
    qty: 1,
    unitPrice: 0,
  }));

const pad = (n: number) => String(n).padStart(2, '0');
/** "2026-11-15T15:40", the form orders keep their due time in. */
const localIso = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export async function saveStickOrder(o: { sale: Sale; stick: StickOrder; existing?: Order | null; eventId: string; device: DeviceInfo }): Promise<Order> {
  const s = { ...o.stick, nickname: o.stick.nickname.trim(), email: o.stick.email.trim() };
  if (!s.nickname) throw new Error('Add their name or nickname: it goes on the stubs and the design file.');
  if (!s.packs.length) throw new Error('This sale has no Couple-of-Stickers packs.');
  const fields = {
    customerName: s.nickname,
    contact: s.email,
    lines: linesOf(s),
    dueAt: localIso(s.readyTo),
    designNo: s.packs[0].designNo,
    stick: s,
  };
  if (o.existing) {
    await patch(db.orders, o.existing.id, fields);
    await audit('update', 'order', o.existing.id, `Couple-of-Stickers ${o.existing.number} for ${s.nickname} changed`);
    return (await db.orders.get(o.existing.id))!;
  }
  const number = await nextStickNumber(o.eventId, o.device.letter);
  const order = await create<Order>(db.orders, {
    number,
    eventId: o.eventId,
    customerId: o.sale.customerId ?? null,
    designerId: null,
    status: 'new',
    statusAt: Date.now(),
    notes: '',
    pickupSaleId: o.sale.id,
    ...fields,
  });
  await audit('create', 'order', order.id, `Couple-of-Stickers ${number} for ${s.nickname}: ${s.packs.map((p) => p.pack + (p.singles ? ' singles' : '')).join(', ')} (paid with ${o.sale.receiptNo})`);
  return order;
}

/**
 * The next stub number at an event: 01, 02… after the highest Couple-of-Stickers
 * order still on Orders (delete test orders and it starts again), no lower than
 * Settings → Couple-of-Stickers → Start the next stub at.
 */
export async function nextStickNumber(eventId: string, letter: string): Promise<string> {
  const s: StickSettings = { ...DEFAULT_STICK, ...(await getSetting<Partial<StickSettings>>('stick')) };
  const taken = alive(await db.orders.where('eventId').equals(eventId).toArray())
    .filter((x) => x.stick)
    .map((x) => x.number);
  return nextStubNumber(taken, { startAt: s.startAt?.[eventId], letter: s.numbers === 'letter' ? letter : null });
}

/** Start the stubs at this number for an event (1 starts again at 01, once the test orders are deleted). */
export async function setStubStart(eventId: string, n: number): Promise<void> {
  const s: StickSettings = { ...DEFAULT_STICK, ...(await getSetting<Partial<StickSettings>>('stick')) };
  await setSetting('stick', { ...s, startAt: { ...s.startAt, [eventId]: Math.max(1, Math.round(n)) } });
}

/** The Couple-of-Stickers order made for a sale, if any. */
export async function stickOrderFor(saleId: string): Promise<Order | undefined> {
  return alive(await db.orders.toArray()).find((x) => x.stick?.saleId === saleId);
}

/** Handed over: it was paid at the register, so there's nothing more to charge. */
export async function handOverStick(o: Order): Promise<void> {
  await patch(db.orders, o.id, { status: 'picked-up', statusAt: Date.now() });
  await audit('status', 'order', o.id, `Couple-of-Stickers ${o.number} handed over`);
}
