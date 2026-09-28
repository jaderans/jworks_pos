import type { Cents } from '../lib/money';

/**
 * Every record that syncs between devices carries these fields.
 * Records are never hard-deleted: `deleted: 1` is a tombstone so a delete
 * made on one phone also reaches the others.
 */
export interface Syncable {
  id: string;
  createdAt: number;
  updatedAt: number;
  deleted?: 0 | 1;
  /** 1 = changed on this device and not uploaded yet. */
  _sync?: 0 | 1;
  /** Device that last wrote the record. */
  _dev?: string;
}

export type AppRole = 'owner' | 'cashier' | 'designer' | 'partner';

export interface Category extends Syncable {
  name: string;
  sort: number;
}

export interface Royalty {
  /** percent: % of the design's sales; perPiece: fixed centavos per piece sold. */
  mode: 'percent' | 'perPiece';
  value: number;
}

export interface Product extends Syncable {
  name: string;
  categoryId: string | null;
  /** Short code the team says out loud, e.g. SOLO. */
  sku: string;
  /** Printed on labels and read by scanners, e.g. JW-0001. */
  barcode: string;
  /** Base price; events can override. null = no price set yet. */
  price: Cents | null;
  active: 0 | 1;
  trackStock: 0 | 1;
  /** Member who designed it (for design credit and royalties). */
  designerId: string | null;
  royalty: Royalty | null;
  notes: string;
  sort: number;
}

export interface RecipeItem {
  materialId: string;
  /** Material units used per piece (per batch for batches). */
  qty: number;
}

export interface Recipe {
  items: RecipeItem[];
  laborMinutes: number;
  laborRate: Cents;
  packaging: Cents;
  spoilagePct: number;
  overheadPct: number;
}

/** Owner-only cost data, kept apart from Product so it never reaches designers. id = productId. */
export interface ProductCost extends Syncable {
  mode: 'manual' | 'recipe' | 'batches';
  manual: Cents | null;
  recipe: Recipe | null;
  /** Current unit cost (cached from the mode above). */
  current: Cents | null;
}

/** A unit cost that applied from a moment on; reports use the one in force at the time of each sale. */
export interface CostPoint extends Syncable {
  productId: string;
  unitCost: Cents;
  effectiveFrom: number;
  source: 'manual' | 'recipe' | 'batch';
  note: string;
}

export interface BundleRule extends Syncable {
  name: string;
  productIds: string[];
  qty: number;
  price: Cents;
  active: 0 | 1;
  /** null = applies at every event. */
  eventId: string | null;
}

export type PayKind = 'cash' | 'ewallet' | 'bank' | 'card' | 'other';

export interface PaymentMethod extends Syncable {
  name: string;
  kind: PayKind;
  requireRef: 0 | 1;
  /** QR image shown to the customer (data URL). */
  qr: string | null;
  accountName: string;
  accountNumber: string;
  active: 0 | 1;
  sort: number;
}

export interface Member extends Syncable {
  name: string;
  email: string;
  appRole: AppRole;
  /** Default event role label, e.g. Production, Illustrator, Cashier, Floater. */
  roleLabel: string;
  weight: number;
  active: 0 | 1;
  phone: string;
  payoutInfo: string;
  notes: string;
}

export interface DiscountPreset {
  id: string;
  label: string;
  kind: 'amount' | 'percent';
  value: number;
  needsPin: boolean;
}

export type EventStatus = 'planning' | 'live' | 'closed' | 'reported';

export interface ShareSettings {
  joshworksPct: number;
  /** all: production cost and event costs come out before the split. cogs: production cost only. supplies: old sheet (materials used %). */
  poolMode: 'all' | 'cogs' | 'supplies';
  weightMode: 'weighthours' | 'weight' | 'equal';
  minGuarantee: Cents | null;
  topUp: boolean;
  /** Royalties and partner shares come out before the pool (true) or from the JoshWorks share (false). */
  royaltiesBeforePool: boolean;
}

export interface JWEvent extends Syncable {
  name: string;
  organizer: string;
  venue: string;
  boothNo: string;
  startDate: string;
  endDate: string;
  status: EventStatus;
  paymentMethodIds: string[];
  openingFloat: Cents;
  discounts: DiscountPreset[];
  /** Manual discounts above this % of the sale need the owner PIN. */
  cashierDiscountLimitPct: number;
  targets: { sales: Cents | null; items: number | null; leads: number | null };
  share: ShareSettings;
  counters: { leads: number; orgOfficers: number };
  notes: string;
}

export interface EventProduct extends Syncable {
  eventId: string;
  productId: string;
  /** Event-only price; null = use the base price. */
  price: Cents | null;
  active: 0 | 1;
  stockBrought: number | null;
}

export interface Shift {
  date: string;
  start: string;
  end: string;
}

export interface RosterEntry extends Syncable {
  eventId: string;
  memberId: string;
  roleLabel: string;
  weight: number;
  shifts: Shift[];
  hoursOverride: number | null;
  inPool: 0 | 1;
}

export interface Tier {
  /** Sell-through % at which this tier starts (0-100). */
  minPct: number;
  /** Partner's share in this tier (0-100). */
  partnerPct: number;
}

export interface PartnerDeal extends Syncable {
  eventId: string;
  /** Member with the partner role. */
  partnerId: string;
  name: string;
  productIds: string[];
  /** net = sales minus production cost (Westival), gross = sales. */
  basis: 'net' | 'gross';
  mode: 'fixed' | 'tiered';
  fixedPct: number;
  tiers: Tier[];
}

export interface CashMove {
  id: string;
  at: number;
  kind: 'in' | 'out';
  amount: Cents;
  reason: string;
  by: string | null;
}

export interface Session extends Syncable {
  eventId: string;
  deviceId: string;
  letter: string;
  openedAt: number;
  openedBy: string | null;
  openingFloat: Cents;
  cashMoves: CashMove[];
  closedAt: number | null;
  closedBy: string | null;
  counted: Record<string, number> | null;
  countedTotal: Cents | null;
  expected: Cents | null;
  notes: string;
}

export interface SaleLine {
  productId: string;
  name: string;
  categoryId: string | null;
  qty: number;
  unitPrice: Cents;
  /** qty × unitPrice (0 for free items). */
  gross: Cents;
  /** Share of bundle savings given to this line. */
  bundleOff: Cents;
  free: 0 | 1;
  freeReason: string;
  designerId: string | null;
}

export interface AppliedDiscount {
  id: string;
  label: string;
  kind: 'amount' | 'percent' | 'bundle' | 'manual';
  amount: Cents;
}

export interface SalePayment {
  methodId: string;
  name: string;
  kind: PayKind;
  /** Amount applied to the sale. */
  amount: Cents;
  /** Cash handed over (cash only). */
  tendered: Cents | null;
  ref: string;
}

export interface Sale extends Syncable {
  eventId: string;
  sessionId: string;
  deviceId: string;
  receiptNo: string;
  at: number;
  cashierId: string | null;
  lines: SaleLine[];
  subtotal: Cents;
  discountTotal: Cents;
  discounts: AppliedDiscount[];
  total: Cents;
  payments: SalePayment[];
  change: Cents;
  note: string;
  status: 'completed' | 'voided';
  voidedAt: number | null;
  voidedBy: string | null;
  voidReason: string;
}

export interface StockMove extends Syncable {
  productId: string;
  /** Signed: + adds stock, − removes it. */
  qty: number;
  kind: 'batch' | 'sale' | 'void' | 'adjust' | 'opening';
  refId: string | null;
  eventId: string | null;
  at: number;
  note: string;
}

export interface Material extends Syncable {
  code: string;
  name: string;
  category: string;
  unit: string;
  packQty: number;
  packCost: Cents | null;
  onHand: number;
  reorderAt: number;
  /** 1 once someone has counted or restocked it; reorder warnings wait until then. */
  counted?: 0 | 1;
  supplier: string;
  notes: string;
}

export interface Batch extends Syncable {
  productId: string;
  at: number;
  qtyMade: number;
  qtySpoiled: number;
  materials: RecipeItem[];
  laborMinutes: number;
  laborRate: Cents;
  /** One-time costs such as design time, spread over this batch. */
  oneTime: Cents;
  other: Cents;
  overheadPct: number;
  totalCost: Cents;
  unitCost: Cents;
  deductMaterials: 0 | 1;
  note: string;
}

export type SpendType = 'booth_fee' | 'consumable' | 'asset' | 'material';
export type SpendStatus = 'to_buy' | 'bought' | 'not_needed';

export interface SpendItem extends Syncable {
  eventId: string;
  type: SpendType;
  name: string;
  qty: number;
  unitCost: Cents;
  status: SpendStatus;
  /** Reusable assets: how many events share the cost. */
  amortizeEvents: number;
  /** Materials: the library material this purchase restocks. */
  materialId: string | null;
  /** 1 once a bought material purchase has been added to the material's stock. */
  stocked: 0 | 1;
  /** Old-sheet mode: % of this purchase used at this event. */
  pctUsed: number;
  /** Member who paid out of pocket (to reimburse); null = JoshWorks funds. */
  paidBy: string | null;
  reimbursed: 0 | 1;
  photoId: string | null;
  notes: string;
}

export interface Payout extends Syncable {
  eventId: string;
  memberId: string;
  kind: 'staff' | 'partner' | 'royalty';
  amount: Cents;
  detail: string;
  status: 'pending' | 'paid';
  paidAt: number | null;
  method: string;
  ref: string;
}

export type QuoteStatus = 'quoted' | 'won' | 'lost' | 'delivered';

export interface Quote extends Syncable {
  quoteNo: string;
  date: string;
  client: string;
  project: string;
  category: string;
  kind: 'service' | 'sticker' | 'other';
  qty: number;
  unitPrice: Cents;
  total: Cents;
  cost: Cents;
  status: QuoteStatus;
  notes: string;
  inputs: unknown;
}

export interface AuditEntry extends Syncable {
  at: number;
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  summary: string;
}

/** Synced settings rows; id is the setting key. */
export interface SettingRow extends Syncable {
  value: unknown;
}

/** Device-only values (never synced). */
export interface LocalRow {
  key: string;
  value: unknown;
}

export interface Photo {
  id: string;
  blob: Blob;
  mime: string;
  at: number;
}

export interface HeldSale {
  id: string;
  eventId: string;
  at: number;
  label: string;
  cart: unknown;
}

// ----- settings shapes -----

export interface BusinessSettings {
  name: string;
  tagline: string;
  address: string;
  contact: string;
  receiptFooter: string;
}

export interface SecuritySettings {
  pinHash: string | null;
  pinSalt: string | null;
}

export interface LaborRole {
  name: string;
  rate: Cents;
  covers: string;
}

export interface CalcSettings {
  overheadPct: number;
  markupPct: number;
  targetMarginPct: number;
  minMarginPct: number;
  vatPct: number;
  ewtPct: number;
  vatRegistered: boolean;
  roundTo: number;
  addons: { rush: number; revision: number; sourceFiles: number; ipBuyout: number };
  roles: LaborRole[];
  categories: string[];
}
