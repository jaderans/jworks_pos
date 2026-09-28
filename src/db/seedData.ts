/**
 * Names carried over from the old workbooks in /sheet files, with every
 * price and cost removed ("reset everything, remove the prices").
 */

export interface SeedProduct {
  sku: string;
  name: string;
  category: string;
  notes: string;
  active: boolean;
  trackStock: boolean;
}

export const SEED_CATEGORIES = ['Sticker', 'Bundle', 'Pins', 'Add-on'];

export const SEED_PRODUCTS: SeedProduct[] = [
  // AYS 2026 Cashier System → PRICES tab
  { sku: 'SOLO', name: 'Solo Pack (live)', category: 'Sticker', notes: '5 pcs, printed live', active: true, trackStock: false },
  { sku: 'COUPLE', name: 'Couple Pack (live)', category: 'Sticker', notes: '6 pcs, printed live', active: true, trackStock: false },
  { sku: 'BARK3', name: 'Barkada Pack (3)', category: 'Sticker', notes: 'Up to 8 pcs, printed live', active: true, trackStock: false },
  { sku: 'BARK45', name: 'Barkada Pack (4-5)', category: 'Sticker', notes: 'Printed live', active: true, trackStock: false },
  { sku: 'SOLO1', name: 'Solo Pack Singles', category: 'Sticker', notes: '', active: true, trackStock: false },
  { sku: 'COUP1', name: 'Couple Pack Singles', category: 'Sticker', notes: '', active: true, trackStock: false },
  { sku: 'BARK3S', name: 'Barkada Pack Singles (3)', category: 'Sticker', notes: '', active: true, trackStock: false },
  { sku: 'BARK45S', name: 'Barkada Pack Singles (4-5)', category: 'Sticker', notes: '', active: true, trackStock: false },
  { sku: 'CAT1', name: 'Cat Meme (Solo)', category: 'Sticker', notes: 'Each', active: true, trackStock: true },
  { sku: 'CAT4', name: 'Cat Meme Pack (4 pcs)', category: 'Sticker', notes: '', active: true, trackStock: false },
  { sku: 'CHAR1', name: 'Character Stickers (Solo)', category: 'Sticker', notes: '', active: true, trackStock: true },
  { sku: 'CHAR4', name: 'Character Stickers (4 pcs)', category: 'Sticker', notes: '', active: true, trackStock: false },
  { sku: 'PLB', name: 'Pawer Litters (Big)', category: 'Sticker', notes: '', active: true, trackStock: true },
  { sku: 'PLS', name: 'Pawer Litters (Small)', category: 'Sticker', notes: '', active: true, trackStock: true },
  { sku: 'SS1', name: 'Sticker Sets (Solo)', category: 'Bundle', notes: 'Any sticker', active: true, trackStock: false },
  { sku: 'SSS', name: 'Sticker Sets (small)', category: 'Bundle', notes: 'Any sticker', active: true, trackStock: false },
  { sku: 'SSS4', name: 'Sticker Sets (small, 4 pcs)', category: 'Bundle', notes: 'Any sticker', active: true, trackStock: false },
  { sku: 'SS4', name: 'Sticker Sets (4 pcs)', category: 'Bundle', notes: 'Any sticker', active: true, trackStock: false },
  { sku: 'BLOWOUT', name: 'Barkada Blowout', category: 'Bundle', notes: 'Copy for all', active: true, trackStock: false },
  { sku: 'EPIN', name: 'Enamel Pins', category: 'Pins', notes: '', active: true, trackStock: true },
  { sku: 'PIN58', name: '58mm Pins', category: 'Pins', notes: '', active: true, trackStock: true },
  { sku: 'PIN25', name: '25mm Pins', category: 'Pins', notes: '', active: true, trackStock: true },
  { sku: 'PIN25B', name: '25mm Pins (second listing)', category: 'Pins', notes: 'The old sheet listed 25mm Pins twice. Rename or delete this one.', active: false, trackStock: true },
  { sku: 'XTRA', name: 'Extra reprint', category: 'Add-on', notes: 'Same art', active: true, trackStock: false },
  { sku: 'HOLO', name: 'Holo / glitter upgrade', category: 'Add-on', notes: 'Per piece', active: false, trackStock: false },
  { sku: 'KEY', name: 'Keychain conversion', category: 'Add-on', notes: 'Ring', active: false, trackStock: false },
  // SPARKWorks · Westival tracker → co-branded designs
  { sku: 'SBL', name: 'Social Battery Low', category: 'Sticker', notes: 'Co-branded with SparkHub (Westival)', active: true, trackStock: true },
  { sku: 'PRL', name: 'Probably Running Late', category: 'Sticker', notes: 'Co-branded with SparkHub (Westival)', active: true, trackStock: true },
  { sku: 'YEARN', name: 'Yearning', category: 'Sticker', notes: 'Co-branded with SparkHub (Westival)', active: true, trackStock: true },
  { sku: 'WCH', name: 'Warning Currently Healing', category: 'Pins', notes: 'Co-branded with SparkHub (Westival)', active: true, trackStock: true },
  { sku: 'IDK', name: '50% IDK 50% IDC', category: 'Pins', notes: 'Co-branded with SparkHub (Westival)', active: true, trackStock: true },
  { sku: 'AINA', name: 'AI IS NOT ART', category: 'Pins', notes: 'Co-branded with SparkHub (Westival)', active: true, trackStock: true },
];

export interface SeedMaterial {
  code: string;
  name: string;
  category: string;
  unit: string;
  packQty: number;
  reorderAt: number;
  notes: string;
}

// Pricing Calculator → MATERIALS tab (pack costs and stock counts left blank)
export const SEED_MATERIALS: SeedMaterial[] = [
  { code: 'M01', name: 'Printable vinyl sticker, A4 matte', category: 'Sticker', unit: 'sheet', packQty: 20, reorderAt: 20, notes: 'Matte finish, inkjet' },
  { code: 'M02', name: 'Printable vinyl sticker, A4 gloss', category: 'Sticker', unit: 'sheet', packQty: 20, reorderAt: 20, notes: '' },
  { code: 'M03', name: 'Holographic vinyl, A4', category: 'Sticker', unit: 'sheet', packQty: 25, reorderAt: 5, notes: 'Premium upgrade stock' },
  { code: 'M04', name: 'Laminating film, A4 gloss', category: 'Sticker', unit: 'sheet', packQty: 20, reorderAt: 20, notes: 'Unlaminated stickers wear out fast' },
  { code: 'M05', name: 'Printer ink (per A4 print)', category: 'Printing', unit: 'print', packQty: 1, reorderAt: 0, notes: 'Estimated from cartridge yield' },
  { code: 'M08', name: 'Kraft paper sleeve, small', category: 'Packaging', unit: 'pc', packQty: 100, reorderAt: 30, notes: 'Branded sleeve' },
  { code: 'M09', name: 'Sticker backing / transfer tape', category: 'Sticker', unit: 'm', packQty: 10, reorderAt: 2, notes: '' },
  { code: 'M10', name: 'Tarpaulin print', category: 'Signage', unit: 'sq ft', packQty: 1, reorderAt: 0, notes: 'Outsourced; check the current Iloilo rate' },
  { code: 'M11', name: 'Sintra board 3mm, 4x8', category: 'Signage', unit: 'sheet', packQty: 1, reorderAt: 1, notes: 'For rigid signage' },
  { code: 'M14', name: 'Photo paper A4 glossy', category: 'Printing', unit: 'sheet', packQty: 50, reorderAt: 10, notes: '' },
  { code: 'M16', name: 'Business card stock (250gsm)', category: 'Printing', unit: 'pc', packQty: 100, reorderAt: 100, notes: 'Outsourced print' },
  { code: 'M23', name: 'Tote bag blank, canvas', category: 'Merch', unit: 'pc', packQty: 1, reorderAt: 0, notes: '' },
];

export interface SeedMember {
  name: string;
  roleLabel: string;
  weight: number;
}

// AYS 2026 Cashier System → PROFIT SHARE role weights
export const SEED_TEAM: SeedMember[] = [
  { name: 'Joshua', roleLabel: 'Production', weight: 3 },
  { name: 'Kaye', roleLabel: 'Illustrator', weight: 3 },
  { name: 'Wendy', roleLabel: 'Illustrator', weight: 3 },
  { name: 'Harvey', roleLabel: 'Cashier', weight: 2 },
  { name: 'CJ', roleLabel: 'Floater', weight: 2 },
  { name: 'Renz', roleLabel: 'Floater', weight: 2 },
];
