import Dexie, { type Table } from 'dexie';
import type {
  AuditEntry, Batch, BundleRule, Category, CostPoint, EventProduct, HeldSale, JWEvent, LocalRow, Material,
  Member, PartnerDeal, PaymentMethod, Payout, Photo, Product, ProductCost, Quote, RosterEntry, Sale, Session,
  SettingRow, SpendItem, StockMove,
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
  // Device-only tables (never synced)
  local!: Table<LocalRow, string>;
  photos!: Table<Photo, string>;
  heldSales!: Table<HeldSale, string>;

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
  }
}

export const db = new JWDB();

/** Tables that sync between devices and to the cloud, in upload order. */
export const SYNCED_TABLES = [
  'settings', 'categories', 'members', 'paymentMethods', 'products', 'productCosts', 'costPoints', 'bundleRules',
  'materials', 'events', 'eventProducts', 'roster', 'partnerDeals', 'sessions', 'sales', 'stockMoves', 'batches',
  'spend', 'payouts', 'quotes', 'audit',
] as const;
export type SyncedTableName = (typeof SYNCED_TABLES)[number];

/** Tables only the owner may read (costs, spend, quotes); designers never receive them. */
export const OWNER_ONLY_TABLES: readonly SyncedTableName[] = [
  'productCosts', 'costPoints', 'materials', 'batches', 'spend', 'quotes',
];

export function syncedTable(name: SyncedTableName): Table<any, string> {
  return (db as unknown as Record<string, Table<any, string>>)[name];
}

/** Drop tombstones. */
export const alive = <T extends { deleted?: 0 | 1 }>(rows: readonly T[]): T[] => rows.filter((r) => r.deleted !== 1);
