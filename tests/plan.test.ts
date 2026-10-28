import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { alive, db } from '../src/db/db';
import { ensureDevice } from '../src/db/local';
import { setWriterDevice } from '../src/db/write';
import { toCents } from '../src/lib/money';
import { STARTER_TASKS, compareEvent, openHours, readiness } from '../src/domain/plan';
import { createEvent, duplicateEvent } from '../src/services/events';
import { setTaskDone } from '../src/services/plan';
import type { EventTask } from '../src/db/types';
import type { ReportInput } from '../src/reports/eventReport';

const P = toCents;
const H = 3_600_000;

beforeEach(async () => {
  await db.delete();
  await db.open();
  const d = await ensureDevice();
  setWriterDevice(d.deviceId);
});

describe('event plan', () => {
  it('counts what is done, per section', () => {
    const t = (section: EventTask['section'], done: 0 | 1, deleted?: 1) => ({ id: Math.random().toString(), createdAt: 0, updatedAt: 0, eventId: 'e', section, text: 'x', qty: null, done, doneBy: null, sort: 0, deleted }) as EventTask;
    const r = readiness([t('before', 1), t('before', 0), t('pack', 1), t('pack', 1, 1)]);
    expect(r).toMatchObject({ done: 2, total: 3, pct: 67 });
    expect(r.bySection.before).toEqual({ done: 1, total: 2 });
    expect(r.bySection.pack).toEqual({ done: 1, total: 1 });
  });

  it('new events get the starter list; copies bring the checklist back unticked', async () => {
    const ev = await createEvent({ name: 'Komiket' });
    const tasks = alive(await db.eventTasks.where('eventId').equals(ev.id).toArray());
    expect(tasks).toHaveLength(STARTER_TASKS.length);
    await setTaskDone(tasks[0].id, true, null);
    const copy = await duplicateEvent(ev.id, { name: 'Komiket 2', startDate: '2026-12-01', endDate: '2026-12-01', copyPrices: false, copyStock: false, copyRoster: false, copyDeals: false, copyBundles: false });
    const copied = alive(await db.eventTasks.where('eventId').equals(copy.id).toArray());
    expect(copied).toHaveLength(STARTER_TASKS.length);
    expect(copied.every((t) => t.done === 0)).toBe(true);
  });
});

describe('comparing events', () => {
  it('counts open hours once when two phones are open together', () => {
    expect(openHours([[0, 2 * H], [1 * H, 3 * H], [5 * H, 6 * H]])).toBe(4);
    expect(openHours([])).toBe(0);
  });

  it('works out sales per hour, per peso of booth fee and sell-through', () => {
    const sale = (id: string, sessionId: string, at: number, total: number) => ({ id, sessionId, at, total: P(total), status: 'completed', lines: [], payments: [], discounts: [] });
    const input = {
      ev: { id: 'e1', name: 'Komiket', startDate: '2026-10-28' },
      sales: [sale('a', 's1', 2 * H, 600), sale('b', 's2', 3 * H, 400)],
      sessions: [
        { id: 's1', openedAt: 0, closedAt: 4 * H },
        { id: 's2', openedAt: 1 * H, closedAt: null },
      ],
      metrics: {
        gross: P(1000), avgSale: P(500), itemsSold: 20, discounts: P(50),
        byMethod: [{ methodId: 'cash', name: 'Cash', kind: 'cash', amount: P(750), count: 1 }, { methodId: 'g', name: 'GCash', kind: 'ewallet', amount: P(250), count: 1 }],
        byProduct: [{ productId: 'p1', name: 'Pin', categoryId: null, qty: 15, revenue: P(750) }],
      },
      share: { costs: { boothFee: P(500) }, tradingProfit: P(700), pool: P(200) },
      eventProducts: [{ productId: 'p1', stockBrought: 20 }],
    } as unknown as ReportInput;
    const c = compareEvent(input);
    expect(c).toMatchObject({ gross: P(1000), transactions: 2, hours: 4, perHour: P(250), boothFee: P(500), perBoothPeso: 2, tradingProfit: P(700), eventResult: P(200), cashPct: 75, sellThrough: 75 });
    expect(c.top[0]).toMatchObject({ name: 'Pin', qty: 15 });
  });
});
