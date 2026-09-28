import type { Content, TableCell } from 'pdfmake/interfaces';
import { barChartSvg, frame, kpis, signatureLine, table, td, th, waterfall, MUTED, TEAL } from './pdf';
import { formatPct, peso, sum } from '../lib/money';
import { fmtDateRange, fmtDateTime, fmtIsoWeekday, fmtTime, hourLabel, isoDate } from '../lib/time';
import { drawerState, type EventMetrics } from '../domain/summary';
import { rosterHours, type ShareResult } from '../domain/share';
import { lineRevenue } from '../domain/cart';
import { toCSV } from '../lib/files';
import { SPEND_TYPE_LABEL, SPEND_STATUS_LABEL } from '../services/spend';
import type { EventProduct, JWEvent, Member, Payout, Product, RosterEntry, Sale, Session, SpendItem } from '../db/types';
import type { CostLookup } from '../domain/cost';

export interface ReportInput {
  business: string;
  ev: JWEvent;
  sales: Sale[];
  sessions: Session[];
  metrics: EventMetrics;
  share: ShareResult;
  products: Map<string, Product>;
  eventProducts: EventProduct[];
  roster: RosterEntry[];
  members: Map<string, Member>;
  spend: SpendItem[];
  payouts: Payout[];
  costOf: (productId: string, at: number) => CostLookup;
}

const nameOf = (i: ReportInput, id: string | null) => (id ? (i.members.get(id)?.name ?? 'Unknown') : '—');

function productRows(i: ReportInput) {
  const brought = new Map(i.eventProducts.map((e) => [e.productId, e.stockBrought]));
  const rows = new Map<string, { name: string; sold: number; revenue: number; cost: number; missing: boolean }>();
  for (const s of i.sales) {
    if (s.status !== 'completed') continue;
    const rev = lineRevenue(s);
    s.lines.forEach((l, k) => {
      const r = rows.get(l.productId) ?? { name: l.name, sold: 0, revenue: 0, cost: 0, missing: false };
      r.sold += l.qty;
      r.revenue += rev[k];
      const c = i.costOf(l.productId, s.at).cost;
      if (c === null) r.missing = true;
      else r.cost += c * l.qty;
      rows.set(l.productId, r);
    });
  }
  return [...rows.entries()]
    .map(([id, r]) => ({ id, ...r, brought: brought.get(id) ?? null }))
    .sort((a, b) => b.revenue - a.revenue);
}

function header(i: ReportInput): Content[] {
  const { ev } = i;
  const onDuty = i.roster.map((r) => `${nameOf(i, r.memberId)} (${r.roleLabel})`).join(', ');
  return [
    { text: ev.name, style: 'h1' },
    {
      text: [fmtDateRange(ev.startDate, ev.endDate), ev.venue, ev.organizer && `Organizer: ${ev.organizer}`, ev.boothNo && `Booth ${ev.boothNo}`].filter(Boolean).join('  ·  '),
      style: 'muted',
      margin: [0, 0, 0, 2],
    },
    ...(onDuty ? [{ text: `On duty: ${onDuty}`, style: 'muted', margin: [0, 0, 0, 8] } as Content] : []),
  ];
}

function headline(i: ReportInput): Content {
  const m = i.metrics;
  const s = i.share;
  return kpis([
    { label: 'Gross sales', value: peso(m.gross) },
    { label: 'Profit pool', value: peso(s.pool), hint: 'After production and event costs' },
    { label: 'Transactions', value: String(m.transactions), hint: m.voided ? `${m.voided} voided` : undefined },
    { label: 'Items sold', value: String(m.itemsSold), hint: m.freeItems ? `${m.freeItems} free` : undefined },
    { label: 'Average sale', value: peso(m.avgSale) },
    { label: 'Biggest sale', value: peso(m.biggestSale) },
    { label: 'Discounts given', value: peso(m.discounts) },
    { label: 'Booth covered?', value: s.tradingProfit >= s.costs.total ? 'Yes' : 'Not yet', hint: `Costs ${peso(s.costs.total)}` },
  ]);
}

function layers(i: ReportInput): Content {
  const s = i.share;
  const cfg = i.ev.share;
  const boughtAssets = sum(i.spend.filter((x) => x.type === 'asset' && x.status === 'bought').map((x) => Math.round(x.qty * x.unitCost)));
  const outlay = s.costs.boothFee + s.costs.consumables + boughtAssets + s.costs.materialsBought;
  const paid = s.staffPool + s.partnerTotal + s.royaltyTotal + s.topUpTotal;
  return {
    columns: [
      {
        width: '*',
        stack: [
          { text: '1 · Trading', style: 'h3' },
          waterfall([
            { label: 'Gross sales', value: peso(s.gross) },
            { label: '− Production cost', value: peso(cfg.poolMode === 'supplies' ? s.costs.materialsUsed : s.cogs), kind: 'sub' },
            ...(cfg.royaltiesBeforePool ? [{ label: '− Partner shares', value: peso(s.partnerTotal), kind: 'sub' as const }, { label: '− Royalties', value: peso(s.royaltyTotal), kind: 'sub' as const }] : []),
            { label: 'Trading profit', value: peso(s.tradingProfit), kind: 'total' },
          ]),
        ],
      },
      {
        width: '*',
        stack: [
          { text: '2 · Event result', style: 'h3' },
          waterfall([
            { label: 'Trading profit', value: peso(s.tradingProfit) },
            ...(cfg.poolMode === 'all' ? [{ label: '− Event costs', value: peso(s.costs.total), kind: 'sub' as const }] : []),
            { label: 'Profit pool', value: peso(s.pool), kind: 'total' },
            { label: `JoshWorks ${cfg.joshworksPct}%`, value: peso(s.joshworks), kind: 'sub' },
            { label: `Staff ${100 - cfg.joshworksPct}%`, value: peso(s.staffPool), kind: 'sub' },
            { label: 'JoshWorks keeps', value: peso(s.joshworksNet), kind: 'final' },
          ]),
        ],
      },
      {
        width: '*',
        stack: [
          { text: '3 · Cash', style: 'h3' },
          waterfall([
            { label: 'Money in', value: peso(s.gross) },
            { label: '− Bought for the event', value: peso(outlay), kind: 'sub' },
            { label: '− Payouts', value: peso(paid), kind: 'sub' },
            { label: 'Net cash', value: peso(s.gross - outlay - paid), kind: 'total' },
          ]),
        ],
      },
    ],
    columnGap: 14,
  } as Content;
}

/** The full event report: cover, money, sales, stock, spend, profit share, summary. */
export async function buildEventReport(i: ReportInput) {
  const { ev, metrics: m, share: s } = i;
  const content: Content[] = [...header(i), headline(i)];

  // Money
  content.push({ text: 'Money in', style: 'h2' });
  content.push(table(['*', 'auto', 'auto'], [th('Method'), th('Payments', true), th('Amount', true)], m.byMethod.map((x) => [td(x.name), td(x.count, true), td(peso(x.amount), true)]), [td('Total'), td(sum(m.byMethod.map((x) => x.count)), true), td(peso(sum(m.byMethod.map((x) => x.amount))), true)]));
  if (i.sessions.length) {
    content.push({ text: 'Cash drawer', style: 'h3' });
    content.push(
      table(
        ['auto', '*', 'auto', 'auto', 'auto', 'auto', 'auto'],
        [th('Register'), th('Opened – closed'), th('Float', true), th('Cash sales', true), th('In − out', true), th('Expected', true), th('Counted', true)],
        i.sessions
          .slice()
          .sort((a, b) => a.openedAt - b.openedAt)
          .map((sess) => {
            const d = drawerState(sess, i.sales);
            const diff = d.overShort;
            return [
              td(sess.letter),
              td(`${fmtDateTime(sess.openedAt)}${sess.closedAt ? ` – ${fmtTime(sess.closedAt)}` : ' (still open)'}`),
              td(peso(d.opening), true),
              td(peso(d.cashSales), true),
              td(peso(d.cashIn - d.cashOut), true),
              td(peso(d.expected), true),
              td(d.counted === null ? '—' : `${peso(d.counted)}${diff ? ` (${diff > 0 ? '+' : '−'}${peso(Math.abs(diff))})` : ''}`, true, diff ? { color: diff > 0 ? TEAL : '#B3261E', bold: true } : {}),
            ];
          }),
      ),
    );
  }
  const refs = i.sales.filter((x) => x.status === 'completed').flatMap((x) => x.payments.filter((p) => p.kind !== 'cash').map((p) => ({ sale: x, p })));
  if (refs.length) {
    content.push({ text: 'E-wallet and bank references', style: 'h3' });
    content.push(table(['auto', 'auto', '*', 'auto'], [th('Receipt'), th('Time'), th('Method · reference'), th('Amount', true)], refs.map(({ sale, p }) => [td(sale.receiptNo), td(fmtTime(sale.at)), td(`${p.name}${p.ref ? ` · ${p.ref}` : ' · no reference'}`), td(peso(p.amount), true)])));
  }

  // Sales
  content.push({ text: 'Sales', style: 'h2' });
  if (m.byHour.length) {
    const hours: { label: string; value: number }[] = [];
    const minH = Math.min(...m.byHour.map((h) => h.hour));
    const maxH = Math.max(...m.byHour.map((h) => h.hour));
    for (let h = minH; h <= maxH; h++) hours.push({ label: hourLabel(h), value: m.byHour.find((x) => x.hour === h)?.amount ?? 0 });
    content.push({ text: 'By hour', style: 'h3' });
    content.push({ svg: barChartSvg(hours), width: 523 } as Content);
  }
  if (m.byDay.length > 1) {
    content.push({ text: 'By day', style: 'h3' });
    content.push(table(['*', 'auto', 'auto'], [th('Day'), th('Sales', true), th('Amount', true)], m.byDay.map((x) => [td(fmtIsoWeekday(x.date)), td(x.count, true), td(peso(x.amount), true)])));
  }
  content.push({
    columns: [
      {
        width: '*',
        stack: [
          { text: 'Top products', style: 'h3' },
          table(['*', 'auto', 'auto'], [th('Product'), th('Sold', true), th('Revenue', true)], m.byProduct.slice(0, 10).map((p) => [td(p.name), td(p.qty, true), td(peso(p.revenue), true)])),
        ],
      },
      {
        width: '*',
        stack: [
          { text: 'Category mix', style: 'h3' },
          table(['*', 'auto', 'auto'], [th('Category'), th('Items', true), th('Revenue', true)], m.byCategory.map((c) => [td(c.name), td(c.qty, true), td(peso(c.revenue), true)])),
        ],
      },
    ],
    columnGap: 14,
  } as Content);
  const voided = i.sales.filter((x) => x.status === 'voided');
  if (voided.length) {
    content.push({ text: 'Voided sales', style: 'h3' });
    content.push(table(['auto', 'auto', 'auto', '*'], [th('Receipt'), th('Time'), th('Amount', true), th('Reason')], voided.map((x) => [td(x.receiptNo), td(fmtTime(x.at)), td(peso(x.total), true), td(x.voidReason || '—')])));
  }

  // Products & stock
  const prows = productRows(i);
  content.push({ text: 'Products and stock', style: 'h2' });
  content.push(
    table(
      ['*', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto'],
      [th('Product'), th('Brought', true), th('Sold', true), th('Left', true), th('Sell-thru', true), th('Revenue', true), th('Cost', true), th('Profit', true)],
      prows.map((r) => [
        td(r.name),
        td(r.brought ?? '—', true),
        td(r.sold, true),
        td(r.brought === null ? '—' : r.brought - r.sold, true),
        td(r.brought ? formatPct((r.sold / r.brought) * 100) : '—', true),
        td(peso(r.revenue), true),
        td(r.missing ? 'no cost' : peso(r.cost), true, r.missing ? { color: '#A35E00' } : {}),
        td(r.missing ? '—' : peso(r.revenue - r.cost), true),
      ]),
      [td('Total'), td(''), td(sum(prows.map((r) => r.sold)), true), td(''), td(''), td(peso(sum(prows.map((r) => r.revenue))), true), td(peso(sum(prows.map((r) => r.cost))), true), td(peso(sum(prows.map((r) => r.revenue - r.cost))), true)],
    ),
  );
  if (s.cogsMissing.length) content.push({ text: `No production cost set for: ${s.cogsMissing.map((x) => x.name).join(', ')}. Profit is overstated by their cost.`, style: 'note' });

  // Booth spend
  content.push({ text: 'Booth spend', style: 'h2' });
  const spendRows = i.spend.slice().sort((a, b) => a.type.localeCompare(b.type));
  content.push(
    table(
      ['auto', '*', 'auto', 'auto', 'auto', 'auto'],
      [th('Type'), th('Item'), th('Qty × cost', true), th('Total', true), th('Status'), th('Paid by')],
      spendRows.map((x) => [
        td(SPEND_TYPE_LABEL[x.type]),
        td(x.type === 'asset' ? `${x.name} (1/${x.amortizeEvents} this event)` : x.name),
        td(`${x.qty} × ${peso(x.unitCost)}`, true),
        td(peso(Math.round(x.qty * x.unitCost)), true),
        td(SPEND_STATUS_LABEL[x.status]),
        td(x.paidBy ? `${nameOf(i, x.paidBy)}${x.reimbursed ? ' (paid back)' : ' (to reimburse)'}` : 'JoshWorks'),
      ]),
    ),
  );
  content.push(
    waterfall([
      { label: 'Booth fee', value: peso(s.costs.boothFee) },
      { label: 'Used up at the event', value: peso(s.costs.consumables) },
      { label: 'Reusable assets (this event’s share)', value: peso(s.costs.assets) },
      ...(i.ev.share.poolMode === 'supplies' ? [{ label: 'Materials used', value: peso(s.costs.materialsUsed) }] : []),
      { label: 'Counted against the event', value: peso(s.costs.total), kind: 'total' as const },
      { label: 'Materials bought (to stock)', value: peso(s.costs.materialsBought), kind: 'sub' as const },
      { label: 'Still marked To buy (not counted)', value: peso(s.costs.planned), kind: 'sub' as const },
    ]),
  );

  // Profit share
  content.push({ text: 'Profit share', style: 'h2' });
  content.push(
    waterfall([
      { label: 'Gross sales', value: peso(s.gross) },
      { label: '− Production cost', value: peso(ev.share.poolMode === 'supplies' ? s.costs.materialsUsed : s.cogs), kind: 'sub' },
      ...(ev.share.royaltiesBeforePool ? [{ label: '− Partner shares', value: peso(s.partnerTotal), kind: 'sub' as const }, { label: '− Design royalties', value: peso(s.royaltyTotal), kind: 'sub' as const }] : []),
      ...(ev.share.poolMode === 'all' ? [{ label: '− Booth fee and event costs', value: peso(s.costs.total), kind: 'sub' as const }] : []),
      { label: 'Profit pool', value: peso(s.pool), kind: 'total' },
      { label: `JoshWorks ${ev.share.joshworksPct}%`, value: peso(s.joshworks) },
      { label: `Staff pool ${100 - ev.share.joshworksPct}%`, value: peso(s.staffPool) },
    ]),
  );
  if (s.staff.length) {
    content.push(
      table(
        ['*', 'auto', 'auto', 'auto', 'auto', 'auto'],
        [th('Person'), th('Role'), th('Weight', true), th('Hours', true), th('Points', true), th('Payout', true)],
        s.staff.map((x) => [td(x.name), td(x.roleLabel), td(x.weight, true), td(x.hours, true), td(x.points, true), td(`${peso(x.amount)}${x.topUp ? ' *' : ''}`, true)]),
        [td('Total'), td(''), td(''), td(sum(s.staff.map((x) => x.hours)), true), td(Math.round(sum(s.staff.map((x) => x.points)) * 100) / 100, true), td(peso(sum(s.staff.map((x) => x.amount))), true)],
      ),
    );
    if (s.topUpTotal) content.push({ text: `* Topped up to the ${peso(ev.share.minGuarantee)} minimum from the JoshWorks share (${peso(s.topUpTotal)} in total).`, style: 'note' });
  }
  if (s.partners.length) {
    content.push({ text: 'Partner shares', style: 'h3' });
    content.push(table(['*', 'auto', 'auto', 'auto', 'auto', 'auto'], [th('Deal'), th('Sold', true), th('Sell-thru', true), th('Base', true), th('Share', true), th('Amount', true)], s.partners.map((p) => [td(`${p.dealName} (${p.partnerName})`), td(p.units, true), td(p.sellThroughPct === null ? '—' : formatPct(p.sellThroughPct), true), td(peso(p.base), true), td(`${p.pct}%`, true), td(peso(p.amount), true)])));
  }
  if (s.royalties.length) {
    content.push({ text: 'Design royalties', style: 'h3' });
    content.push(table(['*', 'auto', 'auto', 'auto'], [th('Designer'), th('Pieces', true), th('Sales', true), th('Royalty', true)], s.royalties.map((r) => [td(r.name), td(r.units, true), td(peso(r.revenue), true), td(peso(r.amount), true)])));
  }
  if (i.payouts.length) {
    content.push({ text: 'Payouts', style: 'h3' });
    content.push(table(['*', 'auto', 'auto', 'auto'], [th('Person'), th('For'), th('Amount', true), th('Status')], i.payouts.map((p) => [td(nameOf(i, p.memberId)), td(p.kind), td(peso(p.amount), true), td(p.status === 'paid' ? `Paid${p.method ? ` · ${p.method}` : ''}` : 'To pay')])));
  }

  // Summary
  content.push({ text: 'Summary', style: 'h2' });
  content.push(layers(i));
  const leads = ev.counters?.leads ?? 0;
  content.push({ text: 'Beyond sales', style: 'h3' });
  content.push({
    ul: [
      `Contacts captured: ${leads}${leads ? ` · cost per contact ${peso(Math.round(s.costs.total / leads))}` : ''}`,
      `Org officers spoken to: ${ev.counters?.orgOfficers ?? 0}`,
      ...(ev.targets.sales ? [`Sales target ${peso(ev.targets.sales)}: ${formatPct((m.gross / ev.targets.sales) * 100)} reached`] : []),
    ],
    margin: [0, 0, 0, 6],
  } as Content);
  if (s.warnings.length) {
    content.push({ text: 'Check these', style: 'h3' });
    content.push({ ul: [...s.warnings], color: MUTED } as Content);
  }
  if (ev.notes) {
    content.push({ text: 'Notes', style: 'h3' });
    content.push({ text: ev.notes });
  }
  content.push({ columns: [signatureLine('Prepared by'), signatureLine('Checked by (owner)')], margin: [0, 24, 0, 0] } as Content);

  return frame({ title: 'Event report', subtitle: ev.name, business: i.business }, content);
}

/** One page to send the team: headline, payments, top items, the split. */
export async function buildSummaryPage(i: ReportInput) {
  const { metrics: m, share: s } = i;
  const content: Content[] = [...header(i), headline(i)];
  content.push({
    columns: [
      {
        width: '*',
        stack: [
          { text: 'Payments', style: 'h3' },
          table(['*', 'auto'], [th('Method'), th('Amount', true)], m.byMethod.map((x) => [td(`${x.name} (${x.count})`), td(peso(x.amount), true)])),
        ],
      },
      {
        width: '*',
        stack: [
          { text: 'Top 5 products', style: 'h3' },
          table(['*', 'auto', 'auto'], [th('Product'), th('Sold', true), th('Revenue', true)], m.byProduct.slice(0, 5).map((p) => [td(p.name), td(p.qty, true), td(peso(p.revenue), true)])),
        ],
      },
    ],
    columnGap: 14,
  } as Content);
  content.push(layers(i));
  if (s.staff.length) {
    content.push({ text: 'Staff payouts', style: 'h3' });
    content.push(table(['*', 'auto', 'auto', 'auto'], [th('Person'), th('Role'), th('Hours', true), th('Payout', true)], s.staff.map((x) => [td(x.name), td(x.roleLabel), td(x.hours, true), td(peso(x.amount), true)])));
  }
  return frame({ title: 'Event summary', subtitle: i.ev.name, business: i.business }, content);
}

/** Two payout slips per page, each with a signature line. */
export async function buildPayoutSlips(i: ReportInput) {
  const slips = i.payouts.length
    ? i.payouts.map((p) => ({ name: nameOf(i, p.memberId), amount: p.amount, detail: p.detail, kind: p.kind, status: p.status, method: p.method }))
    : i.share.staff.map((x) => ({ name: x.name, amount: x.amount, detail: `${x.roleLabel} · weight ${x.weight} × ${x.hours} h`, kind: 'staff' as const, status: 'pending' as const, method: '' }));
  const content: Content[] = [];
  slips.forEach((sl, k) => {
    content.push({
      stack: [
        { text: 'PAYOUT SLIP', style: 'label' },
        { text: sl.name, style: 'h1' },
        { text: `${i.ev.name} · ${fmtDateRange(i.ev.startDate, i.ev.endDate)}`, style: 'muted' },
        { text: sl.kind === 'staff' ? 'Staff share of the profit pool' : sl.kind === 'partner' ? 'Partner share' : 'Design royalty', margin: [0, 10, 0, 2] },
        { text: sl.detail, style: 'muted' },
        { text: peso(sl.amount), style: 'big', fontSize: 26, margin: [0, 10, 0, 4] },
        { text: sl.status === 'paid' ? `Paid${sl.method ? ` via ${sl.method}` : ''}` : 'Amount due', style: sl.status === 'paid' ? 'good' : 'muted' },
        { columns: [signatureLine('Received by'), signatureLine('Date')], margin: [0, 18, 0, 0] },
      ],
      margin: [0, 0, 0, 24],
      ...(k % 2 === 1 && k < slips.length - 1 ? { pageBreak: 'after' } : {}),
    } as Content);
    if (k % 2 === 0 && k < slips.length - 1) content.push({ canvas: [{ type: 'line', x1: 0, y1: 0, x2: 523, y2: 0, lineWidth: 0.6, dash: { length: 4 }, lineColor: '#BCCBCB' }], margin: [0, 0, 0, 24] } as Content);
  });
  if (!slips.length) content.push({ text: 'No payouts yet. Add the team and save payouts first.' });
  return frame({ title: 'Payout slips', subtitle: i.ev.name, business: i.business }, content);
}

/** End-of-day report for one calendar day. */
export async function buildEndOfDay(i: ReportInput, date: string) {
  const sales = i.sales.filter((s) => isoDate(s.at) === date);
  const done = sales.filter((s) => s.status === 'completed');
  const byMethod = new Map<string, { name: string; amount: number; count: number }>();
  for (const s of done) for (const p of s.payments) {
    const v = byMethod.get(p.methodId) ?? { name: p.name, amount: 0, count: 0 };
    v.amount += p.amount;
    v.count += 1;
    byMethod.set(p.methodId, v);
  }
  const sessions = i.sessions.filter((s) => isoDate(s.openedAt) === date);
  const content: Content[] = [
    { text: `${i.ev.name}`, style: 'h1' },
    { text: `End of day · ${fmtIsoWeekday(date)}`, style: 'muted', margin: [0, 0, 0, 8] },
    kpis([
      { label: 'Sales', value: peso(sum(done.map((s) => s.total))) },
      { label: 'Transactions', value: String(done.length) },
      { label: 'Items', value: String(sum(done.flatMap((s) => s.lines.map((l) => l.qty)))) },
      { label: 'Voided', value: String(sales.length - done.length) },
    ]),
    { text: 'Payments', style: 'h3' },
    table(['*', 'auto', 'auto'], [th('Method'), th('Count', true), th('Amount', true)], [...byMethod.values()].map((v) => [td(v.name), td(v.count, true), td(peso(v.amount), true)])),
    { text: 'Registers', style: 'h3' },
    table(
      ['auto', '*', 'auto', 'auto', 'auto'],
      [th('Register'), th('Opened – closed'), th('Expected', true), th('Counted', true), th('Over/short', true)],
      sessions.map((sess) => {
        const d = drawerState(sess, i.sales);
        return [td(sess.letter), td(`${fmtTime(sess.openedAt)} – ${sess.closedAt ? fmtTime(sess.closedAt) : 'open'}`), td(peso(d.expected), true), td(d.counted === null ? '—' : peso(d.counted), true), td(d.overShort === null ? '—' : peso(d.overShort), true)] as TableCell[];
      }),
    ),
    { columns: [signatureLine('Cashier'), signatureLine('Owner')], margin: [0, 24, 0, 0] } as Content,
  ];
  return frame({ title: 'End of day', subtitle: i.ev.name, business: i.business }, content);
}

export function salesCsv(i: ReportInput): string {
  const rows: (string | number)[][] = [['Receipt', 'Date', 'Time', 'Status', 'Product', 'Qty', 'Unit price', 'Line total', 'Bundle savings', 'Net revenue', 'Sale total', 'Payment', 'References', 'Cashier', 'Note']];
  for (const s of i.sales.slice().sort((a, b) => a.at - b.at)) {
    const rev = lineRevenue(s);
    s.lines.forEach((l, k) => {
      rows.push([
        s.receiptNo,
        isoDate(s.at),
        fmtTime(s.at),
        s.status,
        l.name,
        l.qty,
        (l.unitPrice / 100).toFixed(2),
        (l.gross / 100).toFixed(2),
        (l.bundleOff / 100).toFixed(2),
        s.status === 'completed' ? (rev[k] / 100).toFixed(2) : '0.00',
        k === 0 ? (s.total / 100).toFixed(2) : '',
        k === 0 ? s.payments.map((p) => `${p.name} ${(p.amount / 100).toFixed(2)}`).join(' + ') : '',
        k === 0 ? s.payments.map((p) => p.ref).filter(Boolean).join(' ') : '',
        k === 0 ? nameOf(i, s.cashierId) : '',
        k === 0 ? s.note : '',
      ]);
    });
  }
  return toCSV(rows);
}

export function productsCsv(i: ReportInput): string {
  const rows: (string | number)[][] = [['Product', 'Brought', 'Sold', 'Left', 'Revenue', 'Production cost', 'Profit']];
  for (const r of productRows(i)) {
    rows.push([r.name, r.brought ?? '', r.sold, r.brought === null ? '' : r.brought - r.sold, (r.revenue / 100).toFixed(2), r.missing ? '' : (r.cost / 100).toFixed(2), r.missing ? '' : ((r.revenue - r.cost) / 100).toFixed(2)]);
  }
  return toCSV(rows);
}

export function staffCsv(i: ReportInput): string {
  const rows: (string | number)[][] = [['Person', 'Role', 'Weight', 'Hours', 'Points', 'Payout']];
  for (const x of i.share.staff) rows.push([x.name, x.roleLabel, x.weight, x.hours, x.points, (x.amount / 100).toFixed(2)]);
  for (const r of i.roster) if (!i.share.staff.some((x) => x.rosterId === r.id)) rows.push([nameOf(i, r.memberId), r.roleLabel, r.weight, rosterHours(r), 0, '0.00']);
  return toCSV(rows);
}
