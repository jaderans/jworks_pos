import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { alive, db } from '../src/db/db';
import { ensureDevice } from '../src/db/local';
import { setWriterDevice } from '../src/db/write';
import { createProduct, mergeOrder, reorderProducts } from '../src/services/catalog';

beforeEach(async () => {
  await db.delete();
  await db.open();
  setWriterDevice((await ensureDevice()).deviceId);
});

describe('arranging products', () => {
  it('arranging one group keeps everyone else in place', () => {
    // a b c d e, where b and d are the pins: put d before b
    expect(mergeOrder(['a', 'b', 'c', 'd', 'e'], ['d', 'b'])).toEqual(['a', 'd', 'c', 'b', 'e']);
    expect(mergeOrder(['a', 'b', 'c'], ['c', 'b', 'a'])).toEqual(['c', 'b', 'a']);
  });

  it('saves the new order and only touches what moved', async () => {
    const [a, b, c] = [await createProduct({ name: 'A' }), await createProduct({ name: 'B' }), await createProduct({ name: 'C' })];
    await db.products.toCollection().modify({ _sync: 0 });
    expect(await reorderProducts([a.id, c.id, b.id])).toBe(2);
    const rows = alive(await db.products.toArray()).sort((x, y) => x.sort - y.sort);
    expect(rows.map((p) => p.name)).toEqual(['A', 'C', 'B']);
    // A didn't move, so it isn't sent to the other devices again
    expect(rows.filter((p) => p._sync === 1).map((p) => p.name).sort()).toEqual(['B', 'C']);
    expect(await reorderProducts([a.id, c.id, b.id])).toBe(0);
  });
});
