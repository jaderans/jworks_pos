/** Dates are stored as epoch ms; calendar days as YYYY-MM-DD in the device's own time zone. */

const pad = (n: number) => String(n).padStart(2, '0');

export function isoDate(ms: number = Date.now()): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const todayISO = (): string => isoDate(Date.now());

/** Start of a local calendar day in ms. */
export function dayStart(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0).getTime();
}

export function addDays(iso: string, days: number): string {
  const t = new Date(dayStart(iso));
  t.setDate(t.getDate() + days);
  return isoDate(t.getTime());
}

/** Inclusive list of days between two ISO dates (max 60). */
export function daysBetween(startIso: string, endIso: string): string[] {
  if (!startIso) return [];
  const out: string[] = [];
  let cur = startIso;
  const end = endIso && endIso >= startIso ? endIso : startIso;
  for (let i = 0; i < 60 && cur <= end; i++) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

const dateFmt = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
const dateShortFmt = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit' });
const weekdayFmt = new Intl.DateTimeFormat('en-PH', { weekday: 'short', month: 'short', day: 'numeric' });

export const fmtDate = (ms: number): string => dateFmt.format(ms);
export const fmtDateShort = (ms: number): string => dateShortFmt.format(ms);
export const fmtTime = (ms: number): string => timeFmt.format(ms);
export const fmtDateTime = (ms: number): string => `${dateShortFmt.format(ms)}, ${timeFmt.format(ms)}`;
export const fmtIsoDate = (iso: string): string => (iso ? dateFmt.format(dayStart(iso)) : '—');
export const fmtIsoWeekday = (iso: string): string => (iso ? weekdayFmt.format(dayStart(iso)) : '—');

export function fmtDateRange(startIso: string, endIso: string): string {
  if (!startIso) return 'No date yet';
  if (!endIso || endIso === startIso) return fmtIsoDate(startIso);
  return `${dateShortFmt.format(dayStart(startIso))} – ${fmtIsoDate(endIso)}`;
}

/** Minutes since midnight from "HH:MM". */
export function hhmmToMinutes(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Hours between two "HH:MM" times; an end before the start means past midnight. */
export function shiftHours(start: string, end: string): number {
  const a = hhmmToMinutes(start);
  const b = hhmmToMinutes(end);
  if (a === null || b === null) return 0;
  const diff = b >= a ? b - a : b + 24 * 60 - a;
  return Math.round((diff / 60) * 100) / 100;
}

export const localHour = (ms: number): number => new Date(ms).getHours();

export function hourLabel(h: number): string {
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${suffix}`;
}

export function relativeTime(ms: number, now = Date.now()): string {
  const s = Math.round((now - ms) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return fmtDateShort(ms);
}
