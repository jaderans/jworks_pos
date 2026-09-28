import { useMemo, useState } from 'react';
import { FileDown, FileSpreadsheet, FileText, Share2 } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { useEventData } from './useEventData';
import { usePayouts, useSettingRows } from '../../hooks/data';
import { settingValue } from '../../db/settings';
import { Badge, Button, Callout, Loading } from '../../components/ui';
import { Select } from '../../components/form';
import { canShareFiles, downloadBlob, safeFileName } from '../../lib/files';
import { daysBetween, fmtIsoWeekday, isoDate } from '../../lib/time';
import { updateEvent } from '../../services/events';
import type { BusinessSettings, JWEvent } from '../../db/types';

type Kind = 'report' | 'summary' | 'slips' | 'eod';

export default function ReportTab({ ev }: { ev: JWEvent }) {
  const app = useApp();
  const d = useEventData(ev);
  const payouts = usePayouts(ev.id);
  const settingRows = useSettingRows();
  const business = settingValue<BusinessSettings>(settingRows, 'business');
  const [busy, setBusy] = useState<Kind | null>(null);
  const days = useMemo(() => {
    const set = new Set(daysBetween(ev.startDate, ev.endDate));
    d.sales.forEach((s) => set.add(isoDate(s.at)));
    return [...set].sort();
  }, [ev.startDate, ev.endDate, d.sales]);
  const [day, setDay] = useState<string>('');

  if (d.loading || !payouts) return <Loading />;

  const input = () => ({
    business: business.name,
    ev,
    sales: d.sales,
    sessions: d.sessions,
    metrics: d.metrics,
    share: d.share,
    products: d.productMap,
    eventProducts: d.eventProducts,
    roster: d.roster,
    members: d.memberMap,
    spend: d.spend,
    payouts,
    costOf: d.costOf,
  });

  const base = safeFileName(ev.name);
  const make = async (kind: Kind, share: boolean) => {
    setBusy(kind);
    try {
      const mod = await import('../../reports/eventReport');
      const { deliverPdf } = await import('../../reports/pdf');
      const i = input();
      if (kind === 'report') await deliverPdf(await mod.buildEventReport(i), `${base} - event report.pdf`, share);
      if (kind === 'summary') await deliverPdf(await mod.buildSummaryPage(i), `${base} - summary.pdf`, share);
      if (kind === 'slips') await deliverPdf(await mod.buildPayoutSlips(i), `${base} - payout slips.pdf`, share);
      if (kind === 'eod') {
        const dd = day || days[days.length - 1] || isoDate(Date.now());
        await deliverPdf(await mod.buildEndOfDay(i, dd), `${base} - end of day ${dd}.pdf`, share);
      }
      if (!share) app.toast('PDF saved to Downloads', { tone: 'good' });
    } catch (e) {
      app.toast(e instanceof Error ? `Couldn’t make the PDF: ${e.message}` : 'Couldn’t make the PDF', { tone: 'bad' });
    } finally {
      setBusy(null);
    }
  };

  const csv = async (which: 'sales' | 'products' | 'staff') => {
    const mod = await import('../../reports/eventReport');
    const i = input();
    const text = which === 'sales' ? mod.salesCsv(i) : which === 'products' ? mod.productsCsv(i) : mod.staffCsv(i);
    downloadBlob(new Blob([text], { type: 'text/csv;charset=utf-8' }), `${base} - ${which}.csv`);
  };

  const shareable = canShareFiles();
  const card = (kind: Kind, title: string, text: string) => (
    <div className="card">
      <div className="card-head">
        <h2>
          <FileText size={20} className="teal" /> {title}
        </h2>
      </div>
      <p className="sub">{text}</p>
      {kind === 'eod' ? (
        <Select aria-label="Day" value={day || days[days.length - 1] || ''} onChange={(e) => setDay(e.target.value)}>
          {days.map((x) => (
            <option key={x} value={x}>
              {fmtIsoWeekday(x)}
            </option>
          ))}
        </Select>
      ) : null}
      <div className="actions">
        <Button variant="primary" disabled={!!busy} onClick={() => make(kind, false)}>
          <FileDown size={18} /> {busy === kind ? 'Making PDF…' : 'Download PDF'}
        </Button>
        {shareable ? (
          <Button disabled={!!busy} onClick={() => make(kind, true)}>
            <Share2 size={18} /> Share
          </Button>
        ) : null}
      </div>
    </div>
  );

  return (
    <div className="stack loose">
      {d.share.warnings.length ? (
        <Callout tone="warn" title="Before you send the report">
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {d.share.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Callout>
      ) : null}
      <div className="grid-2">
        {card('report', 'Full event report', 'Cover, money in, cash drawer, e-wallet references, sales by hour, products and stock, booth spend, profit share, payouts and the three-layer summary.')}
        {card('summary', 'One-page summary', 'The headline numbers, payments, top products and the split. Good for the team chat.')}
        {card('slips', 'Payout slips', 'One slip per person with the amount and a signature line. Two per page.')}
        {card('eod', 'End of day', 'Sales, payments and the drawer count for one day.')}
      </div>
      <div className="card">
        <div className="card-head">
          <h2>
            <FileSpreadsheet size={20} className="teal" /> Spreadsheets
          </h2>
        </div>
        <p className="sub">CSV files open in Google Sheets or Excel.</p>
        <div className="actions">
          <Button onClick={() => csv('sales')}>Every sale line</Button>
          <Button onClick={() => csv('products')}>Products and stock</Button>
          <Button onClick={() => csv('staff')}>Staff split</Button>
        </div>
      </div>
      <div className="card">
        <div className="card-head">
          <h2>Finish the event</h2>
          <Badge>{ev.status}</Badge>
        </div>
        <p className="sub">Closed events stop taking sales. Reported events move to Past events.</p>
        <div className="actions">
          {ev.status !== 'closed' ? <Button onClick={() => updateEvent(ev.id, { status: 'closed' })}>Close the event</Button> : null}
          {ev.status !== 'reported' ? (
            <Button variant="teal" onClick={() => updateEvent(ev.id, { status: 'reported' })}>
              Mark as reported
            </Button>
          ) : null}
          {ev.status !== 'live' ? <Button variant="ghost" onClick={() => updateEvent(ev.id, { status: 'live' })}>Reopen</Button> : null}
        </div>
      </div>
    </div>
  );
}
