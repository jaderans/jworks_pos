/**
 * Random v4 UUIDs from crypto.getRandomValues. Unlike crypto.randomUUID,
 * this also works when the app is opened over plain http on a LAN.
 */
export function uid(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0'));
  return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10).join('')}`;
}

/** Short random code for things people read out loud (not globally unique). */
export function shortCode(len = 6): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = new Uint8Array(len);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => alphabet[x % alphabet.length]).join('');
}

/** "A-0042": device letter + running number on that device. */
export const receiptNumber = (letter: string, seq: number): string => `${letter}-${String(seq).padStart(4, '0')}`;
