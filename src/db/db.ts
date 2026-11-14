import Dexie, { type Table } from 'dexie';
import type { DisplayMedia, StickerArt,
  AuditEntry, Batch, BundleRule, Category, CostPoint, Customer, EventProduct, HeldSale, JWEvent, LocalRow, Material,
  Member, PartnerDeal, PaymentMethod, Payout, Photo, Product, ProductCost, Quote, RosterEntry, Sale, Session,
  Coupon, CouponBatch, CouponClaim, EventTask, Order, OutboxItem, PrintOrder, SettingRow, SpendItem, StockMove, StudioFeedRow, Voucher,
} from './types';

/**
 * The on-device database (IndexedDB). This is the source of truth: the app
 * reads and writes here first, so it keeps working with no internet.
 */
export class JWDB extends Dexie {
  settings!: Table<SettingRow, string>;
  categories!: Table<Category, string>;
  products!: Table<Product, string>;
  productCosts!: Table<ProductCost, string>;
  costPoints!: Table<CostPoint, string>;
  bundleRules!: Table<BundleRule, string>;
  paymentMethods!: Table<PaymentMethod, string>;
  members!: Table<Member, string>;
  events!: Table<JWEvent, string>;
  eventProducts!: Table<EventProduct, string>;
  roster!: Table<RosterEntry, string>;
  partnerDeals!: Table<PartnerDeal, string>;
  sessions!: Table<Session, string>;
  sales!: Table<Sale, string>;
  stockMoves!: Table<StockMove, string>;
  materials!: Table<Material, string>;
  batches!: Table<Batch, string>;
  spend!: Table<SpendItem, string>;
  payouts!: Table<Payout, string>;
  quotes!: Table<Quote, string>;
  audit!: Table<AuditEntry, string>;
  customers!: Table<Customer, string>;
  vouchers!: Table<Voucher, string>;
  orders!: Table<Order, string>;
  eventTasks!: Table<EventTask, string>;
  studioFeed!: Table<StudioFeedRow, string>;
  printOrders!: Table<PrintOrder, string>;
  couponBatches!: Table<CouponBatch, string>;
  coupons!: Table<Coupon, string>;
  couponClaims!: Table<CouponClaim, string>;
  // Device-only tables (never synced)
  local!: Table<LocalRow, string>;
  photos!: Table<Photo, string>;
  heldSales!: Table<HeldSale, string>;
  outbox!: Table<OutboxItem, string>;
  displayMedia!: Table<DisplayMedia, string>;
  stickerArt!: Table<StickerArt, string>;

  constructor(name = 'jworks-pos') {
    super(name);
    this.version(1).stores({
      settings: 'id, updatedAt, _sync',
      categories: 'id, sort, updatedAt, _sync',
      products: 'id, categoryId, sku, barcode, designerId, updatedAt, _sync',
      productCosts: 'id, updatedAt, _sync',
      costPoints: 'id, productId, [productId+effectiveFrom], updatedAt, _sync',
      bundleRules: 'id, eventId, updatedAt, _sync',
      paymentMethods: 'id, sort, updatedAt, _sync',
      members: 'id, appRole, email, updatedAt, _sync',
      events: 'id, status, startDate, updatedAt, _sync',
      eventProducts: 'id, eventId, productId, updatedAt, _sync',
      roster: 'id, eventId, memberId, updatedAt, _sync',
      partnerDeals: 'id, eventId, partnerId, updatedAt, _sync',
      sessions: 'id, eventId, deviceId, openedAt, updatedAt, _sync',
      sales: 'id, eventId, sessionId, at, receiptNo, deviceId, updatedAt, _sync',
      stockMoves: 'id, productId, eventId, refId, at, updatedAt, _sync',
      materials: 'id, updatedAt, _sync',
      batches: 'id, productId, at, updatedAt, _sync',
      spend: 'id, eventId, type, updatedAt, _sync',
      payouts: 'id, eventId, memberId, updatedAt, _sync',
      quotes: 'id, status, date, updatedAt, _sync',
      audit: 'id, at, entity, entityId, updatedAt, _sync',
      local: 'key',
      photos: 'id',
      heldSales: 'id, eventId, at',
    });
    // Customers, loyalty and vouchers. Version 1 data stays as it is.
    this.version(2).stores({
      sales: 'id, eventId, sessionId, at, receiptNo, deviceId, customerId, voucherCode, updatedAt, _sync',
      customers: 'id, name, phone, email, updatedAt, _sync',
      vouchers: 'id, code, eventId, updatedAt, _sync',
    });
    // Emails waiting to go out (device-only).
    this.version(3).stores({ outbox: 'id, status, saleId, at' });
    // Pre-orders and commissions; sales point to their order.
    this.version(4).stores({
      sales: 'id, eventId, sessionId, at, receiptNo, deviceId, customerId, voucherCode, orderId, updatedAt, _sync',
      orders: 'id, eventId, status, customerId, updatedAt, _sync',
    });
    // Each event's checklist and packing list.
    this.version(5).stores({ eventTasks: 'id, eventId, updatedAt, _sync' });
    // Event and order summaries for JoshWorks Studio.
    this.version(6).stores({ studioFeed: 'id, updatedAt, _sync' });
    // The sticker printing service.
    this.version(7).stores({ printOrders: 'id, status, customerId, updatedAt, _sync' });
    // Service coupons: each event's codes and who used them.
    this.version(8).stores({
      couponBatches: 'id, eventId, updatedAt, _sync',
      coupons: 'id, code, batchId, eventId, saleId, customerId, updatedAt, _sync',
      couponClaims: 'id, couponId, code, eventId, updatedAt, _sync',
    });
    // The customer screen's ad images and videos (device-only).
    this.version(9).stores({ displayMedia: 'id, sort' });
    // Custom sticker designs from Google Drive, for the customer screen (device-only).
    this.version(10).stores({ stickerArt: 'id, code, updated' });
  }
}

export const db = new JWDB();

/** Tables that sync between devices and to the cloud, in upload order. */
export const SYNCED_TABLES = [
  'settings', 'categories', 'members', 'paymentMethods', 'customers', 'vouchers', 'products', 'productCosts', 'costPoints', 'bundleRules',
  'materials', 'events', 'eventProducts', 'eventTasks', 'roster', 'partnerDeals', 'sessions', 'sales', 'stockMoves', 'batches',
  'spend', 'payouts', 'quotes', 'orders', 'printOrders', 'couponBatches', 'coupons', 'couponClaims', 'studioFeed', 'audit',
] as const;
export type SyncedTableName = (typeof SYNCED_TABLES)[number];

/** Tables only the owner may read (costs, spend, quotes); designers never receive them. */
export const OWNER_ONLY_TABLES: readonly SyncedTableName[] = [
  'productCosts', 'costPoints', 'materials', 'batches', 'spend', 'quotes', 'studioFeed',
];

export function syncedTable(name: SyncedTableName): Table<any, string> {
  return (db as unknown as Record<string, Table<any, string>>)[name];
}

/** Drop tombstones. */
export const alive = <T extends { deleted?: 0 | 1 }>(rows: readonly T[]): T[] => rows.filter((r) => r.deleted !== 1);
