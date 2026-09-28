import { db } from '../db/db';
import { build, audit, setActor } from '../db/write';
import { getLocal, setLocal, updateDevice } from '../db/local';
import { BLANK_CALC_SETTINGS, SHEET_CALC_SETTINGS, setSetting, DEFAULT_BUSINESS } from '../db/settings';
import { SEED_CATEGORIES, SEED_MATERIALS, SEED_PRODUCTS, SEED_TEAM } from '../db/seedData';
import { hashPin, newSalt } from '../lib/hash';
import type { Category, Material, Member, PaymentMethod, Product } from '../db/types';

export interface SetupInput {
  businessName: string;
  ownerName: string;
  pin: string;
  deviceLetter: string;
  deviceName: string;
  importProducts: boolean;
  importMaterials: boolean;
  importTeam: boolean;
  calcRates: 'keep' | 'blank';
}

export const isSetupDone = () => getLocal<boolean>('setupDone', false);

export function defaultPaymentMethods(): PaymentMethod[] {
  const pm = (name: string, kind: PaymentMethod['kind'], requireRef: 0 | 1, active: 0 | 1, sort: number) =>
    build<PaymentMethod>({ name, kind, requireRef, qr: null, accountName: '', accountNumber: '', active, sort });
  return [
    pm('Cash', 'cash', 0, 1, 0),
    pm('GCash', 'ewallet', 1, 1, 1),
    pm('Maribank', 'bank', 1, 1, 2),
    pm('Bank transfer', 'bank', 1, 1, 3),
    pm('Maya', 'ewallet', 1, 0, 4),
    pm('PayPal', 'other', 1, 0, 5),
  ];
}

/** First launch on the owner's device: business, owner, PIN, and the optional import from the old sheets. */
export async function runSetup(input: SetupInput): Promise<string> {
  const salt = newSalt();
  const ownerName = input.ownerName.trim() || 'Owner';
  let ownerId = '';

  await db.transaction('rw', [db.settings, db.members, db.categories, db.products, db.materials, db.paymentMethods, db.audit, db.local], async () => {
    await setSetting('business', { ...DEFAULT_BUSINESS, name: input.businessName.trim() || 'JoshWorks' });
    await setSetting('calc', input.calcRates === 'keep' ? SHEET_CALC_SETTINGS : BLANK_CALC_SETTINGS);
    await setSetting('security', input.pin ? { pinHash: hashPin(input.pin, salt), pinSalt: salt } : { pinHash: null, pinSalt: null });

    // Owner, plus the team from the old sheets (the owner is matched by name so there is no duplicate).
    const members: Member[] = [];
    const team = input.importTeam ? SEED_TEAM : [];
    const ownerFromTeam = team.find((t) => t.name.toLowerCase() === ownerName.toLowerCase());
    const owner = build<Member>({
      name: ownerFromTeam?.name ?? ownerName,
      email: '',
      appRole: 'owner',
      roleLabel: ownerFromTeam?.roleLabel ?? 'Creative Director',
      weight: ownerFromTeam?.weight ?? 3,
      active: 1,
      phone: '',
      payoutInfo: '',
      notes: '',
    });
    ownerId = owner.id;
    members.push(owner);
    for (const t of team) {
      if (t === ownerFromTeam) continue;
      members.push(build<Member>({ name: t.name, email: '', appRole: 'designer', roleLabel: t.roleLabel, weight: t.weight, active: 1, phone: '', payoutInfo: '', notes: '' }));
    }
    await db.members.bulkPut(members);

    if ((await db.paymentMethods.count()) === 0) await db.paymentMethods.bulkPut(defaultPaymentMethods());

    if (input.importProducts) {
      const cats = new Map<string, Category>();
      SEED_CATEGORIES.forEach((name, i) => cats.set(name, build<Category>({ name, sort: i })));
      await db.categories.bulkPut([...cats.values()]);
      const products = SEED_PRODUCTS.map((p, i) =>
        build<Product>({
          name: p.name,
          categoryId: cats.get(p.category)?.id ?? null,
          sku: p.sku,
          barcode: `JW-${String(i + 1).padStart(4, '0')}`,
          price: null,
          active: p.active ? 1 : 0,
          trackStock: p.trackStock ? 1 : 0,
          designerId: null,
          royalty: null,
          notes: p.notes,
          sort: i,
        }),
      );
      await db.products.bulkPut(products);
    }

    if (input.importMaterials) {
      await db.materials.bulkPut(
        SEED_MATERIALS.map((m) =>
          build<Material>({ code: m.code, name: m.name, category: m.category, unit: m.unit, packQty: m.packQty, packCost: null, onHand: 0, reorderAt: m.reorderAt, supplier: '', notes: m.notes }),
        ),
      );
    }

    await updateDevice({ letter: input.deviceLetter || 'A', name: input.deviceName || 'Main device' });
    await setLocal('currentMemberId', ownerId);
    await setLocal('setupDone', true);
    setActor(ownerId);
    const parts = [input.importProducts && 'product names', input.importMaterials && 'materials', input.importTeam && 'team'].filter(Boolean);
    await audit('setup', 'app', null, `Set up JoshWorks POS${parts.length ? `; imported ${parts.join(', ')} from the old sheets (no prices)` : ''}`);
  });
  return ownerId;
}

/** A second device joining without cloud sync: it gets its data from a merge file. */
export async function runJoinSetup(letter: string, deviceName: string): Promise<void> {
  await updateDevice({ letter: letter || 'B', name: deviceName || 'Second device' });
  await setLocal('setupDone', true);
}
