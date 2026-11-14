import type { BoothPhoto } from '../db/types';

/**
 * The photo booth: a customer's photo in a JoshWorks frame, previewed on the
 * customer screen as a sticker. It's kept only when they say yes, and only on
 * the laptop that took it. One that isn't used for an order is deleted after
 * 30 days (Data Privacy Act); one used for an order stays with that order.
 */

export const BOOTH_KEEP_DAYS = 30;
const DAY = 86_400_000;

export type BoothFrameKey = 'sticker' | 'polaroid' | 'plain';

export interface BoothFrame {
  key: BoothFrameKey;
  name: string;
  hint: string;
  /** The saved file's size in pixels. */
  w: number;
  h: number;
  /** PNG keeps the sticker's see-through edge; photos are JPEG. */
  type: 'image/png' | 'image/jpeg';
}

export const BOOTH_FRAMES: readonly BoothFrame[] = [
  { key: 'sticker', name: 'Die-cut sticker', hint: 'A white sticker edge with the JoshWorks mark, on a see-through background: ready to print and cut.', w: 1200, h: 1200, type: 'image/png' },
  { key: 'polaroid', name: 'Instant photo', hint: 'A white card with the JoshWorks logo, the event and the date.', w: 1200, h: 1400, type: 'image/jpeg' },
  { key: 'plain', name: 'Photo only', hint: 'Just the photo, with a small JoshWorks mark in the corner.', w: 1200, h: 1200, type: 'image/jpeg' },
];

export const boothFrame = (key: string | undefined): BoothFrame => BOOTH_FRAMES.find((f) => f.key === key) ?? BOOTH_FRAMES[0];

/** "BA-007": the laptop's letter and a running number, short enough to say at the counter. */
export const boothNumber = (letter: string, seq: number): string => `B${letter || 'A'}-${String(Math.max(1, seq)).padStart(3, '0')}`;

/** The middle square of a camera picture. */
export function centerSquare(w: number, h: number): { sx: number; sy: number; size: number } {
  const size = Math.max(0, Math.min(w, h));
  return { sx: Math.max(0, (w - size) / 2), sy: Math.max(0, (h - size) / 2), size };
}

/** When an unused photo is deleted. */
export const boothExpiresAt = (p: Pick<BoothPhoto, 'at'>): number => p.at + BOOTH_KEEP_DAYS * DAY;

/** Days until it's deleted, rounded up: 30 when just taken, 1 on its last day. */
export const boothDaysLeft = (p: Pick<BoothPhoto, 'at'>, now = Date.now()): number => Math.max(0, Math.ceil((boothExpiresAt(p) - now) / DAY));

/**
 * Due for deletion: past 30 days and not on an order that still exists. A
 * photo whose order was deleted goes too.
 */
export function boothExpired(p: Pick<BoothPhoto, 'at' | 'usedFor'>, orderExists: (id: string) => boolean, now = Date.now()): boolean {
  if (p.usedFor && orderExists(p.usedFor.id)) return false;
  return now >= boothExpiresAt(p);
}

/** File name for a booth photo: "BA-007 Leanna - JoshWorks photo.png". */
export function boothFileName(p: Pick<BoothPhoto, 'number' | 'name' | 'blob'>): string {
  const ext = p.blob.type === 'image/png' ? 'png' : 'jpg';
  const who = p.name.trim().split(/\s+/)[0]?.replace(/[^\p{L}\p{N}_-]/gu, '') ?? '';
  return `${p.number}${who ? ` ${who}` : ''} - JoshWorks photo.${ext}`;
}
