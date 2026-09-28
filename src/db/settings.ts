import { db } from './db';
import { save } from './write';
import { toCents } from '../lib/money';
import type { BusinessSettings, CalcSettings, SecuritySettings, SettingRow } from './types';

/** Settings shared by every device (they sync). */

export const DEFAULT_BUSINESS: BusinessSettings = {
  name: 'JoshWorks',
  tagline: 'Creative studio',
  address: 'Iloilo City',
  contact: '',
  receiptFooter: 'Thank you for supporting JoshWorks!',
};

export const DEFAULT_SECURITY: SecuritySettings = { pinHash: null, pinSalt: null };

/** The rates from the old Pricing Calculator's SETTINGS tab ("keep my current rates"). */
export const SHEET_CALC_SETTINGS: CalcSettings = {
  overheadPct: 25,
  markupPct: 60,
  targetMarginPct: 45,
  minMarginPct: 30,
  vatPct: 12,
  ewtPct: 2,
  vatRegistered: false,
  roundTo: 5,
  addons: { rush: 25, revision: 15, sourceFiles: 20, ipBuyout: 60 },
  roles: [
    { name: 'Creative Director / Owner', rate: toCents(500), covers: 'Concept, client pitching, final approval' },
    { name: 'Senior Designer', rate: toCents(380), covers: 'Branding, complex layout, art direction' },
    { name: 'Illustrator', rate: toCents(350), covers: 'Custom illustration, live drawing, lettering' },
    { name: 'Mid Designer', rate: toCents(280), covers: 'Social media sets, standard layout' },
    { name: 'Junior Designer', rate: toCents(180), covers: 'Resizing, cleanup, simple edits' },
    { name: 'Production / Finishing', rate: toCents(150), covers: 'Printing, cutting, laminating, weeding, assembly' },
    { name: 'Admin / Coordination', rate: toCents(120), covers: 'Quoting, client comms, delivery, filing' },
    { name: 'Trainee / OJT', rate: toCents(80), covers: 'Supervised support work' },
  ],
  categories: [
    'Stickers / Merch', 'Branding & Identity', 'Tarpaulin / Signage', 'Publication / Layout', 'Social Media Set',
    'Motion / Video', 'Illustration', 'Web Design', 'Training / Workshop', 'Other',
  ],
};

export const BLANK_CALC_SETTINGS: CalcSettings = {
  ...SHEET_CALC_SETTINGS,
  roles: SHEET_CALC_SETTINGS.roles.map((r) => ({ ...r, rate: 0 })),
};

const DEFAULTS: Record<string, unknown> = {
  business: DEFAULT_BUSINESS,
  security: DEFAULT_SECURITY,
  calc: SHEET_CALC_SETTINGS,
};

export async function getSetting<T>(key: 'business' | 'security' | 'calc'): Promise<T> {
  const row = await db.settings.get(key);
  const fallback = DEFAULTS[key] as T;
  if (!row || row.deleted === 1) return fallback;
  return { ...(fallback as object), ...(row.value as object) } as T;
}

export async function setSetting(key: 'business' | 'security' | 'calc', value: unknown): Promise<void> {
  const existing = await db.settings.get(key);
  const row: SettingRow = existing
    ? { ...existing, value }
    : { id: key, value, createdAt: Date.now(), updatedAt: Date.now() };
  await save(db.settings, row);
}

/** Read a settings row synchronously from a live query result. */
export function settingValue<T>(rows: readonly SettingRow[] | undefined, key: 'business' | 'security' | 'calc'): T {
  const row = rows?.find((r) => r.id === key && r.deleted !== 1);
  const fallback = DEFAULTS[key] as T;
  return row ? ({ ...(fallback as object), ...(row.value as object) } as T) : fallback;
}
