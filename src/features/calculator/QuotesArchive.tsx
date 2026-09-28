import { useMemo, useState } from 'react';
import { FileText, Trash2 } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { useQuotes, useSettingRows } from '../../hooks/data';
import { settingValue } from '../../db/settings';
import { EmptyState, IconButton, Loading, Stat } from '../../components/ui';
import { SearchInput, Select } from '../../components/form';
import { formatPct, peso, sum } from '../../lib/money';
import { fmtIsoDate } from '../../lib/time';
import { deleteQuote, QUOTE_STATUS_LABEL, setQuoteStatus } from '../../services/quotes';
import type { Quote, QuoteStatus } from '../../db/types';

export function QuotesArchive() {
  const app = useApp();
  const quotes = useQuotes();
  const settingRows = useSettingRows();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'all' | QuoteStatus>('all');
  const shown = useMemo(
    () => (quotes ?? []).filter((x) => (status === 'all' || x.status === status) && (!q || `${x.client} ${x.project} ${x.quoteNo} ${x.category}`.toLowerCase().includes(q.toLowerCase()))),
    [quotes, q, status],
  );
  if (!quotes) return <Loading />;
  const decided = quotes.filter((x) => x.status !== 'quoted');
  const won = quotes.filter((x) => x.status === 'won' || x.status === 'delivered');
  const revenue = sum(won.map((x) => x.total));
  const profit = sum(won.map((x) => x.total - x.cost));

  const pdf = async (quote: Quote) => {
    const inputs = quote.inputs as { labor?: never[]; outsourced?: never[]; vat?: boolean; ewt?: boolean; result?: never } | null;
    if (!inputs?.result) {
      app.toast('Only service quotes saved from the calculator can be turned into a PDF.', { tone: 'bad' });
      return;
    }
    const { buildQuotePdf } = await import('../../reports/quotePdf');
    const { deliverPdf } = await import('../../reports/pdf');
    const business = settingValue<{ name: string; contact: string; address: string }>(settingRows, 'business');
    await deliverPdf(
      await buildQuotePdf({ business, quoteNo: quote.quoteNo, date: quote.date, client: quote.client, project: quote.project, category: quote.category, qty: quote.qty, result: inputs.result, labor: inputs.labor ?? [], outsourced: inputs.outsourced ?? [], vat: !!inputs.vat, ewt: !!inputs.ewt }),
      `${quote.quoteNo} - ${quote.client || 'client'}.pdf`,
    );
  };

  return (
    <div className="stack loose">
      <div className="stats">
        <Stat label="Quotes" value={String(quotes.length)} />
        <Stat label="Win rate" value={decided.length ? formatPct((won.length / decided.length) * 100) : '—'} hint="Won or delivered ÷ decided" />
        <Stat label="Revenue won" value={peso(revenue)} />
        <Stat label="Average margin won" value={revenue ? formatPct((profit / revenue) * 100) : '—'} />
      </div>
      <p className="muted small">Check here before quoting something similar, so you never undercut your own past work.</p>
      <div className="row wrap">
        <div className="grow" style={{ minWidth: 200 }}>
          <SearchInput value={q} onChange={setQ} placeholder="Search client, project or quote no." />
        </div>
        <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} style={{ width: 'auto' }}>
          <option value="all">All</option>
          {(Object.keys(QUOTE_STATUS_LABEL) as QuoteStatus[]).map((s) => (
            <option key={s} value={s}>
              {QUOTE_STATUS_LABEL[s]}
            </option>
          ))}
        </Select>
      </div>
      {shown.length === 0 ? (
        <EmptyState icon={<FileText size={44} />} title={quotes.length ? 'No quotes match' : 'No quotes yet'}>
          Save quotes from the Service quote or Sticker job calculators.
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Quote</th>
                <th>Client · project</th>
                <th className="r">Total</th>
                <th className="r hide-phone">Margin</th>
                <th>Status</th>
                <th className="r"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((x) => (
                <tr key={x.id}>
                  <td className="nowrap">
                    <b className="mono">{x.quoteNo}</b>
                    <div className="muted tiny">{fmtIsoDate(x.date)}</div>
                  </td>
                  <td>
                    <b>{x.client || 'No client'}</b>
                    <div className="muted tiny">
                      {x.project} · {x.category}
                    </div>
                  </td>
                  <td className="r strong">{peso(x.total)}</td>
                  <td className="r hide-phone">{x.total ? formatPct(((x.total - x.cost) / x.total) * 100) : '—'}</td>
                  <td>
                    <select className="select" style={{ minHeight: 36, width: 'auto' }} aria-label={`Status of ${x.quoteNo}`} value={x.status} onChange={(e) => setQuoteStatus(x.id, e.target.value as QuoteStatus)}>
                      {(Object.keys(QUOTE_STATUS_LABEL) as QuoteStatus[]).map((s) => (
                        <option key={s} value={s}>
                          {QUOTE_STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="r">
                    <div className="actions" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                      {x.kind === 'service' ? (
                        <IconButton label={`PDF of ${x.quoteNo}`} size="sm" onClick={() => pdf(x)}>
                          <FileText size={16} />
                        </IconButton>
                      ) : null}
                      <IconButton
                        label={`Delete ${x.quoteNo}`}
                        size="sm"
                        onClick={async () => {
                          if (await app.confirm({ title: `Delete ${x.quoteNo}?`, confirmLabel: 'Delete', tone: 'danger' })) await deleteQuote(x.id);
                        }}
                      >
                        <Trash2 size={16} />
                      </IconButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
