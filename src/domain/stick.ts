import type { Cents } from '../lib/money';

/**
 * Stick Together: Couple-of-Stickers made at the booth. The customer picks a
 * pack, pays at the register, and gets two stubs: a claim stub with their
 * number, and an information stub for whoever makes the stickers. The packs:
 *
 *   S  Solo Pack      2 illustrated 2×3 stickers + 3 mini stickers
 *   C  Couple Pack    2 illustrated stickers + 6 mini stickers
 *   B3 Barkada (3)    3 illustrated stickers + 6 mini stickers
 *   B4 Barkada (4)    4 illustrated stickers + 8 mini stickers
 *   B5 Barkada (5)    5 illustrated stickers + 8 mini stickers
 *
 * Singles are the illustrated stickers only, no mini stickers.
 */

export type PackCode = 'S' | 'C' | 'B3' | 'B4' | 'B5';
export const PACK_CODES: readonly PackCode[] = ['S', 'C', 'B3', 'B4', 'B5'];
export const PACK_NAME: Record<PackCode, string> = { S: 'Solo Pack', C: 'Couple Pack', B3: 'Barkada Pack (3)', B4: 'Barkada Pack (4)', B5: 'Barkada Pack (5)' };
/** The bonus mini stickers a pack comes with (singles have none). */
export const PACK_MINIS: Record<PackCode, number> = { S: 3, C: 6, B3: 6, B4: 8, B5: 8 };
/** The illustrated stickers in a pack. */
export const PACK_STICKERS: Record<PackCode, number> = { S: 2, C: 2, B3: 3, B4: 4, B5: 5 };

/** "2 illustrated stickers + 6 mini stickers": what a pack is, in the customer's words. */
export function packWhat(p: { pack: PackCode; singles: boolean }): string {
  const art = `${PACK_STICKERS[p.pack]} illustrated stickers`;
  return p.singles ? art : `${art} + ${PACK_MINIS[p.pack]} mini stickers`;
}

/** Past work shown while a customer checks their order: one person, two, or a group of 3 to 5. */
export type SampleKind = 'solo' | 'couple' | 'barkada';
export const SAMPLE_KINDS: readonly SampleKind[] = ['solo', 'couple', 'barkada'];
export const SAMPLE_KIND_NAME: Record<SampleKind, string> = { solo: 'Solo', couple: 'Couple', barkada: 'Barkada' };
export const sampleKindOf = (pack: PackCode): SampleKind => (pack === 'S' ? 'solo' : pack === 'C' ? 'couple' : 'barkada');
/** From a file name like "Couple - Eliza & Renz.png"; null when it doesn't say. */
export function sampleKindFromName(name: string): SampleKind | null {
  const n = name.toLowerCase();
  if (/\bsolo\b/.test(n)) return 'solo';
  if (/\bcouple\b/.test(n)) return 'couple';
  if (/\b(barkada|group)\b/.test(n)) return 'barkada';
  return null;
}

export type Making = 'printing' | 'illustrating';

/** One pack in an order: what it is, how it's made, and its own design file. */
export interface StickPack {
  /** The product it was sold as, e.g. "Couple Pack (live)". */
  name: string;
  pack: PackCode;
  singles: boolean;
  /** Printed from their photo or design, or drawn by our illustrator. */
  making: Making;
  /** The mini stickers they picked, by number ("07"). */
  minis: string[];
  /** Its design file in Drive → Custom stickers: CS12 → CS12-Leanna.png. */
  designNo: string;
  note: string;
  /** Add-ons for this pack, from the Add-on category: "Keychain", "Pin", "Extra reprint". */
  addOns?: string[];
}

/** The Couple-of-Stickers details of an order, filled in at the register after they pay. */
export interface StickOrder {
  /** The name on the stubs and the design file. */
  nickname: string;
  /** For a soft copy of their stickers. */
  email: string;
  softCopy: boolean;
  packs: StickPack[];
  /** Other things they bought with it: "1 × Chonky Cat Keychains" (each pack keeps its own add-ons). */
  addOns: string[];
  /** The sale it was paid with. */
  saleId: string;
  /** The receipt it was paid with: A-0012. */
  receiptNo?: string;
  paid: Cents;
  /** "GCash (ref 5012)" */
  paidWith: string;
  /** When it should be ready: a ten-minute window. */
  readyFrom: number;
  readyTo: number;
  /** How they'll give us the photo to work from. */
  photo: 'message' | 'booth' | 'none';
  /** Taken at our photo booth: the photo on this laptop, and its copy in Drive. */
  photoId?: string;
  photoUrl?: string;
}

export interface StickSettings {
  /** Product id → its pack; products not set here are recognised by name. A null pack: not a Couple-of-Stickers product. */
  packs: Record<string, { pack: PackCode | null; singles: boolean }>;
  /** Minutes to make one pack. */
  minutes: Record<Making, number>;
  /** Minutes each add-on (a keychain, a pin) adds to its pack. */
  addOnMinutes: number;
  /** How many people make stickers at once. */
  makers: number;
  /** The stubs' paper: an A4 or Letter sheet to cut, or an 80 mm or 58 mm receipt printer. */
  stubPaper: 'sheet' | 'r80' | 'r58';
  /** Design numbers start with this: CS01. */
  designPrefix: string;
  /** Stub numbers: 01, 02… or with the register letter, A-01, B-01… (several registers taking orders). */
  numbers: 'plain' | 'letter';
  /** Per event: the lowest number the next stub can have (to match pre-printed stubs, or to start again at 01). */
  startAt: Record<string, number>;
}

export const DEFAULT_STICK: StickSettings = { packs: {}, minutes: { printing: 20, illustrating: 30 }, addOnMinutes: 5, makers: 1, stubPaper: 'sheet', designPrefix: 'CS', numbers: 'plain', startAt: {} };

/** Add-on products: the ones in a category named Add-on (Add-ons, Add on…). */
export const isAddOnCategory = (name: string | undefined): boolean => !!name && /add[\s-]?ons?\b/i.test(name);

/** The number in a stub number: 7 from "07" or "A-07". */
export const stubSeq = (n: string): number => {
  const m = n.match(/(\d+)\s*$/);
  return m ? Number(m[1]) : 0;
};

/**
 * The next stub number at an event: after the highest one still on Orders
 * (so deleting test orders brings the numbers back down), and no lower than
 * where the owner set them to start.
 */
export function nextStubNumber(taken: readonly string[], o: { startAt?: number; letter?: string | null }): string {
  const used = new Set(taken.map(stubSeq));
  let n = Math.max(1, o.startAt ?? 1, ...[...used].map((x) => x + 1));
  while (used.has(n)) n++;
  const nn = String(n).padStart(2, '0');
  return o.letter ? `${o.letter}-${nn}` : nn;
}

/**
 * A pack from a product's name: "Couple Pack Singles" is C singles; "Barkada
 * Pack (4-5)" is B4 (the cashier can make it B5). It needs "Pack" in the
 * name, so "Cat Meme (Solo)" stays a sticker. Null when it isn't one.
 */
export function guessPack(name: string): { pack: PackCode; singles: boolean } | null {
  const n = name.toLowerCase();
  if (!/\bpacks?\b/.test(n)) return null;
  const singles = /\bsingles?\b/.test(n);
  if (/\bsolo\b/.test(n)) return { pack: 'S', singles };
  if (/\bcouple\b/.test(n)) return { pack: 'C', singles };
  if (/\bbarkada\b|\bgroup\b/.test(n)) {
    const m = n.match(/\b([345])\b/);
    const k = m ? Number(m[1]) : 3;
    return { pack: k >= 5 ? 'B5' : k === 4 ? 'B4' : 'B3', singles };
  }
  return null;
}

/** The pack a product is: as set in Settings, else from its name. */
export function packOf(product: { id: string; name: string }, s: Pick<StickSettings, 'packs'>): { pack: PackCode; singles: boolean } | null {
  const set = s.packs[product.id];
  if (set) return set.pack ? { pack: set.pack, singles: set.singles } : null;
  return guessPack(product.name);
}

/** How many mini stickers come with it. */
export const minisFor = (p: Pick<StickPack, 'pack' | 'singles'>): number => (p.singles ? 0 : PACK_MINIS[p.pack]);

/** "C", or "C singles", as on the stub. */
export const packLabel = (p: Pick<StickPack, 'pack' | 'singles'>): string => `${p.pack}${p.singles ? ' singles' : ''}`;

const DESIGN_RE = (prefix: string) => new RegExp(`^${prefix.replace(/[^A-Za-z]/g, '')}(\\d{1,4})$`, 'i');

/** The next free design numbers after the highest one used (in Drive or on an order): CS12, CS13… */
export function nextDesignNos(count: number, used: Iterable<string>, prefix = 'CS'): string[] {
  const re = DESIGN_RE(prefix);
  let top = 0;
  for (const u of used) {
    const m = String(u).replace(/[\s_-]+/g, '').match(re);
    if (m) top = Math.max(top, Number(m[1]));
  }
  const p = prefix.replace(/[^A-Za-z]/g, '').toUpperCase() || 'CS';
  return Array.from({ length: Math.max(0, count) }, (_, i) => `${p}${String(top + 1 + i).padStart(2, '0')}`);
}

/** Their photo from our booth, named after the order and the name: "07-Leanna" (add .jpg). */
export const orderPhotoName = (number: string, nickname: string): string => designFileName(claimNo(number), nickname);

/** The design file's name in Drive: "CS12-Leanna" (add .png). */
export function designFileName(designNo: string, nickname: string): string {
  const who = nickname
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('');
  return who ? `${designNo}-${who}` : designNo;
}

/** The number on the claim stub: "07" from QA-07. */
export const claimNo = (orderNumber: string): string => orderNumber.split('-').pop() ?? orderNumber;

const MIN = 60_000;

/**
 * When it should be ready: the packs already waiting (split among the people
 * making them), then this order's own packs, as a ten-minute window. With
 * nothing ahead, a printed pack is "20 to 30 minutes".
 */
export function estimateReady(
  packs: readonly Pick<StickPack, 'making' | 'addOns'>[],
  ahead: readonly { packs: readonly Pick<StickPack, 'making' | 'addOns'>[]; started: boolean }[],
  s: Pick<StickSettings, 'minutes' | 'makers'> & { addOnMinutes?: number },
  now: number,
): { from: number; to: number; ahead: number; minutes: number } {
  const per = (p: Pick<StickPack, 'making' | 'addOns'>) => Math.max(1, s.minutes[p.making] ?? 20) + (p.addOns?.length ?? 0) * (s.addOnMinutes ?? 5);
  // An order already being made is about half done.
  const queue = ahead.reduce((a, o) => a + o.packs.reduce((b, p) => b + per(p), 0) * (o.started ? 0.5 : 1), 0);
  const mine = packs.length ? Math.max(...packs.map(per)) + (packs.length - 1) * (per(packs[0]) / 2) : 0;
  const minutes = Math.round(queue / Math.max(1, s.makers) + mine);
  return { from: now + minutes * MIN, to: now + (minutes + 10) * MIN, ahead: ahead.length, minutes };
}

/** "20–30 minutes", counting down a whole minute at a time. */
export function readyText(o: Pick<StickOrder, 'readyFrom' | 'readyTo'>, now: number): string {
  const a = Math.max(0, Math.ceil((o.readyFrom - now) / MIN - 0.01));
  const b = Math.max(a, Math.ceil((o.readyTo - now) / MIN - 0.01));
  if (b <= 0) return 'any minute now';
  return a === b ? `about ${a} minutes` : `${a}–${b} minutes`;
}

export const ENJOY = 'Enjoy the rest of the event while we make your stickers!';
