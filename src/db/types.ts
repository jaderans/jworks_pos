import type { Cents } from '../lib/money';
import type { WheelConfig, WheelResult } from '../domain/wheel';

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
  /** The prize wheel at this event. Older events have none. */
  wheel?: WheelConfig | null;
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
  /** Where the money moved: the drawer's cash, or GCash and the like. Moves recorded before this was asked are cash. */
  method?: { id: string; name: string; kind: PayKind };
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
  kind: 'amount' | 'percent' | 'bundle' | 'manual' | 'voucher' | 'loyalty' | 'coupon';
  amount: Cents;
}

export interface SalePayment {
  methodId: string;
  name: string;
  /** 'deposit': the part already paid as an order deposit (not new money). */
  kind: PayKind | 'deposit';
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
  /** The customer this sale is for (loyalty stamps, receipts). Older sales have none. */
  customerId?: string | null;
  /** The voucher code used on this sale, uppercase. */
  voucherCode?: string;
  /**
   * 'deposit': money taken toward an order. It counts in the drawer, not in sales, until pickup.
   * 'service': a payment for a JoshWorks service (sticker printing) taken at the register. It's money in
   * and a sale of its own, kept out of the booth's merch figures and the team's booth share.
   */
  kind?: 'deposit' | 'service';
  /** The order this deposit or pickup belongs to. */
  orderId?: string;
  /** The print order a service payment is for. */
  printOrderId?: string;
  /** What this sale won on the prize wheel (it spins once). */
  wheel?: WheelResult;
  /** A ₱0 sale of a wheel prize: the sale that won it. */
  prizeFor?: string;
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
  /** A service coupon; total is already after it. */
  coupon?: AppliedCoupon | null;
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

/** The studio Gmail mailer (Google Apps Script) on this device. Device-only: the key never goes into backups. */
export interface MailerSettings {
  url: string;
  key: string;
  fromName: string;
  replyTo: string;
  /** Email the end-of-day summary (sales, registers, inventory) when a register closes, or at summaryTime. */
  summaryOn: boolean;
  /** Who gets it: one or more addresses, separated by commas. */
  summaryTo: string;
  /** "21:00": if no register was closed by then, it goes out anyway (while the app is open). */
  summaryTime: string;
}

/** An email waiting to go out, sent or failed. Device-only: it holds the customer's address. */
export interface OutboxItem {
  id: string;
  at: number;
  kind: 'receipt' | 'test' | 'summary' | 'coupon';
  saleId: string | null;
  to: string;
  toName: string;
  subject: string;
  html: string;
  text: string;
  /** Files sent with it, e.g. the end-of-day PDF (base64). */
  attachments?: { name: string; type: string; data: string }[];
  status: 'queued' | 'sent' | 'failed';
  tries: number;
  error: string;
  sentAt: number | null;
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

/** An ad image or video for the customer screen, kept on the device that shows it (not synced, not in backups). */
export interface DisplayMedia {
  id: string;
  name: string;
  kind: 'image' | 'video';
  mime: string;
  blob: Blob;
  /** How long an image shows; a video plays to its end. */
  seconds: number;
  on: 0 | 1;
  sort: number;
  addedAt: number;
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

/** Stamp card: a stamp for every pesoPerStamp spent; enough stamps earn a reward. */
export interface LoyaltySettings {
  enabled: boolean;
  pesoPerStamp: Cents;
  stampsForReward: number;
  rewardKind: 'amount' | 'percent';
  /** Centavos for amount, a percentage for percent. */
  rewardValue: number;
}

/** A customer, kept on the devices (and in backups) for receipts, loyalty and orders. */
export interface Customer extends Syncable {
  name: string;
  phone: string;
  email: string;
  /** Instagram, Facebook or TikTok handle. */
  handle: string;
  /** Agreed to hear about new drops and events (Data Privacy Act consent), and when. */
  marketingOk: 0 | 1;
  consentAt: number | null;
  notes: string;
  /** The event where they were added. */
  firstEventId: string | null;
}

export type TaskSection = 'before' | 'pack' | 'day' | 'after';

/** One line of an event's checklist or packing list. */
export interface EventTask extends Syncable {
  eventId: string;
  section: TaskSection;
  text: string;
  /** For packing: how many to bring. */
  qty: number | null;
  done: 0 | 1;
  doneBy: string | null;
  sort: number;
}

export type OrderStatus = 'new' | 'in-progress' | 'ready' | 'picked-up' | 'cancelled';

export interface OrderLine {
  /** A catalog product, or null for a custom piece (a commission, a name sticker). */
  productId: string | null;
  name: string;
  categoryId: string | null;
  designerId: string | null;
  qty: number;
  unitPrice: Cents;
}

/** A pre-order or commission taken at the booth: a deposit now, the rest at pickup. */
export interface Order extends Syncable {
  /** Queue number with the device letter, e.g. QA-07, so two phones never clash. */
  number: string;
  eventId: string;
  customerId: string | null;
  /** As typed when there's no customer record. */
  customerName: string;
  contact: string;
  lines: OrderLine[];
  /** Who makes it (commissions). */
  designerId: string | null;
  /** Local date and time, "2026-10-29T15:00", or ''. */
  dueAt: string;
  status: OrderStatus;
  statusAt: number;
  notes: string;
  pickupSaleId: string | null;
  /** A service coupon; it comes off the commission (custom) lines. */
  coupon?: AppliedCoupon | null;
}

/** A discount code, e.g. KOMIKET50. */
export interface Voucher extends Syncable {
  /** Uppercase, no spaces. */
  code: string;
  label: string;
  kind: 'amount' | 'percent';
  /** Centavos for amount, a percentage for percent. */
  value: number;
  /** Spend at least this (after bundles) to use it. */
  minSpend: Cents;
  /** ISO dates; '' means no limit. */
  validFrom: string;
  validTo: string;
  /** Only at this event; null means any event. */
  eventId: string | null;
  maxUses: number | null;
  perCustomer: number | null;
  active: 0 | 1;
  notes: string;
}

// ----- Service coupons -----
// Coupons belong to one event and come off JoshWorks services (print orders,
// commissions, service quotes, Studio jobs), never booth sales; register
// discounts are vouchers.

/** A set of coupons made together for one event: the terms its codes share. */
export interface CouponBatch extends Syncable {
  eventId: string;
  /** "Booth handout", "Spend ₱500 at the booth". */
  name: string;
  kind: 'amount' | 'percent';
  /** Centavos for amount, a percentage for percent. */
  value: number;
  /** Percent coupons: the most one takes off, in centavos; 0 means no cap. */
  maxOff: Cents;
  /** The service must cost at least this (₱2,500 at the least). */
  minSpend: Cents;
  /** ISO dates: from the event's first day to the expiry. */
  validFrom: string;
  validTo: string;
  /** unique: every code is used once. shared: one code for many people, up to maxUses. */
  mode: 'unique' | 'shared';
  /** Shared codes: how many claims in all; null means no limit. */
  maxUses: number | null;
  /** Earned at the booth: a sale of at least this gives the customer a new code. 0: handed out instead. */
  earnMin: Cents;
  /** Codes start with this, e.g. KI26. */
  prefix: string;
  active: 0 | 1;
  notes: string;
}

/** One coupon code; its terms are its batch's. */
export interface Coupon extends Syncable {
  /** Uppercase, e.g. KI26-7F3QX. */
  code: string;
  batchId: string;
  eventId: string;
  /** Who it was given to, for the expiry reminder. */
  customerId: string | null;
  /** The booth sale that earned it. */
  saleId: string | null;
  givenAt: number | null;
  remindedAt: number | null;
  /** Turned off by hand, or the sale that earned it was voided. */
  void: 0 | 1;
}

export type CouponSource = 'print' | 'order' | 'quote' | 'studio' | 'manual';

/** A coupon used on a service. Its id is `<source>:<sourceId>`, so a service never claims twice. */
export interface CouponClaim extends Syncable {
  couponId: string;
  code: string;
  batchId: string;
  eventId: string;
  source: CouponSource;
  sourceId: string;
  /** "Print order PA-004", "Studio job COM-012: Logo". */
  service: string;
  customerId: string | null;
  customerName: string;
  /** The service's price before the coupon; the minimum is checked against it. */
  price: Cents;
  discount: Cents;
  at: number;
  by: string | null;
}

/** The coupon on a print order, order or quote. */
export interface AppliedCoupon {
  couponId: string;
  code: string;
  discount: Cents;
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

// ----- JoshWorks Studio link -----
// What the POS hands to JoshWorks Studio. Studio reads these rows straight from
// this device's database (both apps share jaderans.github.io) or from a
// downloaded file, so the shape is versioned and only ever grows.

/** Money in by payment method; for an event the amounts add up to its sales. */
export interface StudioFeedMethod {
  methodId: string;
  name: string;
  kind: PayKind | 'other';
  amount: Cents;
}

/** One person's money from an event, as the event report works it out. */
export interface StudioFeedPerson {
  /** The person's id in the POS. */
  memberId: string;
  name: string;
  email: string;
  kind: 'staff' | 'royalty' | 'partner';
  /** Role at the booth, or the deal name for a partner. */
  role: string;
  amount: Cents;
  /** Already paid out in the POS. */
  paid: Cents;
  paidAt: number | null;
  method: string;
}

export interface StudioEventFeed {
  type: 'event';
  v: 1;
  eventId: string;
  name: string;
  venue: string;
  startDate: string;
  endDate: string;
  status: EventStatus;
  business: string;
  gross: Cents;
  transactions: number;
  itemsSold: number;
  discounts: Cents;
  methods: StudioFeedMethod[];
  /** Production cost of what sold. */
  cogs: Cents;
  /** Products sold with no production cost yet. */
  cogsMissing: number;
  boothFee: Cents;
  /** Used-up supplies plus this event's share of reusable assets. */
  supplies: Cents;
  /** The booth fee, supplies and asset shares above, one line per item (newer POS versions). */
  spend?: StudioFeedSpend[];
  people: StudioFeedPerson[];
  tradingProfit: Cents;
  joshworksNet: Cents;
  /** Deposits for orders not yet picked up: money in, not sales yet. */
  depositsHeld: Cents;
}

/** One cost counted against the event. Materials aren't here: they reach it through the production cost of what sold. */
export interface StudioFeedSpend {
  /** The spend item's id. */
  id: string;
  type: 'booth_fee' | 'consumable' | 'asset';
  name: string;
  qty: number;
  unitCost: Cents;
  /** Counted against this event (for a reusable asset, this event's share). */
  amount: Cents;
  /** Reusable assets: what it cost, how many events share it, this event's place, paid off so far, and the event it was bought for. */
  total?: Cents;
  of?: number;
  index?: number;
  paidOff?: Cents;
  boughtFor?: string;
}

export interface StudioOrderPayment {
  saleId: string;
  /** Local date, YYYY-MM-DD. */
  date: string;
  name: string;
  kind: PayKind | 'other';
  amount: Cents;
  /** A deposit, or the balance paid at pickup. */
  stage: 'deposit' | 'pickup';
}

export interface StudioOrderFeed {
  type: 'order';
  v: 1;
  orderId: string;
  number: string;
  eventId: string;
  eventName: string;
  customer: { name: string; email: string; phone: string; handle: string };
  designer: { memberId: string; name: string; email: string } | null;
  lines: { name: string; qty: number; unitPrice: Cents }[];
  /** After the coupon. */
  total: Cents;
  /** A service coupon's discount (lines are at full price); added later, so older feeds have none. */
  discount?: Cents;
  couponCode?: string;
  /** Local date and time, or ''. */
  dueAt: string;
  status: OrderStatus;
  createdAt: number;
  payments: StudioOrderPayment[];
  notes: string;
}

/** A sticker printing job for Studio (a 'Sticker Printing' job): the printer's share is their earnings. */
export interface StudioPrintFeed {
  type: 'print';
  v: 1;
  orderId: string;
  number: string;
  status: PrintStatus;
  customer: { name: string; email: string; phone: string; handle: string };
  printer: { memberId: string; name: string; email: string } | null;
  printerPct: number;
  /** The printer's share of the print work, worked out in the POS. */
  printerShare: Cents;
  /** Who drew the sticker art and their share of the illustration lines, when the order has them. */
  illustrator?: { memberId: string; name: string; email: string } | null;
  illustratorPct?: number;
  illustratorShare?: Cents;
  lines: { label: string; qty: number; unitPrice: Cents; amount: Cents }[];
  subtotal: Cents;
  /** A service coupon's discount off the print work; total is after it. */
  discount?: Cents;
  couponCode?: string;
  delivery: { method: 'pickup' | 'courier'; courier: string; fee: Cents; tracking: string };
  total: Cents;
  /** Materials at the rate card's cost per sheet; 0 when costs aren't set. */
  materialCost: Cents;
  a4: number;
  payments: { id: string; date: string; name: string; kind: PayKind | 'other'; amount: Cents; stage: 'down' | 'balance'; ref: string }[];
  createdAt: number;
  approvedAt: number | null;
  dueDate: string;
  doneAt: number | null;
  notes: string;
}

export type StudioFeed = StudioEventFeed | StudioOrderFeed | StudioPrintFeed;

/** Id: `event:<eventId>`, `order:<orderId>` or `print:<printOrderId>`. Events and orders: "Send to Studio"; print orders: kept up to date by themselves. */
export interface StudioFeedRow extends Syncable {
  feed: StudioFeed;
  sentBy: string;
}

// ----- Sticker printing service -----

/** The printing rate card (Settings key 'printRates'), from the JoshWorks Sticker Printing rate sheet. */
export interface PrintMaterial {
  key: string;
  group: 'Standard' | 'Premium' | 'Paper';
  name: string;
  /** Per A4 sheet, kiss cut included. */
  price: Cents;
  /** What one sheet costs the studio (paper, laminate, ink), for Studio's expenses. null = not set. */
  cost: Cents | null;
}
export interface PrintCut {
  key: string;
  name: string;
  /** Added to the sheet price. */
  price: Cents;
}
export type PackSize = 'small' | 'medium' | 'large';
/** A peel-off sheet size and how many are cut from one A4. */
export interface PeelSize {
  key: string;
  name: string;
  perA4: number;
  /** The packaging size it fits, if any. */
  pack: PackSize | null;
}
export interface PackOption {
  key: string;
  name: string;
  small: Cents;
  medium: Cents;
  large: Cents;
}
export interface PrintRates {
  materials: PrintMaterial[];
  cuts: PrintCut[];
  peelSizes: PeelSize[];
  packs: PackOption[];
  /** The size guide: how many fit on one A4 sheet. */
  stickerSizes: { name: string; perA4: number }[];
  minSheets: number;
  minPacks: number;
  leadDays: { min: number; max: number };
  /** Down payment to start, % of the total. */
  downPct: number;
  /** The printer's share of the print work (before the courier fee), % — their earnings in Studio. */
  printerPct: number;
  /** Drawing the sticker art: a price per design in each tier, cheaper in sets, and the illustrator's share (%). */
  illustration: { tiers: IllustrationTier[]; artistPct: number };
}

export interface IllustrationTier {
  key: string;
  name: string;
  /** What it covers, for the customer. */
  note: string;
  /** One design. */
  price: Cents;
  /** Several designs ordered at once cost less. */
  sets: { designs: number; price: Cents }[];
}

export type PrintStatus = 'quote' | 'printing' | 'ready' | 'done' | 'cancelled';

export interface PrintLine {
  kind: 'sheets' | 'peel' | 'pack' | 'custom' | 'illustration';
  label: string;
  /** A4 sheets, peel-off sheets, packs or pieces. */
  qty: number;
  unitPrice: Cents;
  /** Studio's cost per unit when known (materials), for Studio's expenses. */
  unitCost: Cents | null;
  /** A4 sheets this line prints. */
  a4: number;
  /** Rate-card picks, to edit the line again. */
  material?: string;
  cut?: string;
  size?: string;
  pack?: string;
  packSize?: PackSize;
  /** Illustration: the tier and how many designs. */
  tier?: string;
  designs?: number;
}

export interface PrintPayment {
  id: string;
  at: number;
  methodId: string;
  name: string;
  kind: PayKind;
  amount: Cents;
  ref: string;
  stage: 'down' | 'balance';
  by: string | null;
  /** The register sale it was taken as, when a register was open on the phone. */
  saleId?: string;
}

export interface PrintDelivery {
  method: 'pickup' | 'courier';
  courier: string;
  address: string;
  /** Charged to the customer; the studio pays the courier. */
  fee: Cents;
  tracking: string;
}

/** A sticker printing job: quote and proof, 50% down, print, then pickup or courier with the balance. */
export interface PrintOrder extends Syncable {
  /** PA-001: the device letter keeps two phones from giving the same number. */
  number: string;
  customerId: string | null;
  customerName: string;
  contact: string;
  lines: PrintLine[];
  delivery: PrintDelivery;
  status: PrintStatus;
  statusAt: number;
  proofAt: number | null;
  approvedAt: number | null;
  /** Ready by, from the approval date and the lead time (working days). */
  dueDate: string;
  printerId: string | null;
  printerPct: number;
  /** Who draws the sticker art, and their share of the illustration lines (%). */
  illustratorId?: string | null;
  illustratorPct?: number;
  payments: PrintPayment[];
  /** Where the customer's files are (Drive or Messenger link). */
  files: string;
  notes: string;
  doneAt: number | null;
  /** A service coupon; it comes off the print work, not the delivery fee. */
  coupon?: AppliedCoupon | null;
}
