import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router';
import { CalendarPlus } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { Badge, Button, EmptyState, Loading, PageHeader, Tabs } from '../../components/ui';
import { EVENT_STATUS_LABEL } from '../../services/events';
import { fmtDateRange } from '../../lib/time';
import { SummaryTab } from './SummaryTab';

const PricesTab = lazy(() => import('./PricesTab'));
const StockTab = lazy(() => import('./StockTab'));
const SpendTab = lazy(() => import('./SpendTab'));
const TeamTab = lazy(() => import('./TeamTab'));
const ReportTab = lazy(() => import('./ReportTab'));
const EventSettingsTab = lazy(() => import('./EventSettingsTab'));

export default function EventPage() {
  const app = useApp();
  const navigate = useNavigate();
  const ev = app.activeEvent;
  if (ev === undefined) return <Loading />;
  if (!ev) {
    return (
      <div className="page narrow">
        <EmptyState
          icon={<CalendarPlus size={48} />}
          title="No event picked"
          action={
            app.can('manageEvents') ? (
              <Button variant="primary" onClick={() => navigate('/events')}>
                Go to events
              </Button>
            ) : undefined
          }
        >
          Pick an event from the top bar to see its summary.
        </EmptyState>
      </div>
    );
  }
  const owner = app.can('viewProfit');
  const tabs = [
    { to: '/event', label: 'Summary', end: true },
    ...(app.can('editPrices') ? [{ to: '/event/prices', label: 'Edit prices' }] : []),
    { to: '/event/stock', label: 'Stock' },
    ...(app.can('spend') ? [{ to: '/event/spend', label: 'Booth spend' }] : []),
    ...(owner ? [{ to: '/event/team', label: 'Team & payouts' }] : []),
    ...(owner ? [{ to: '/event/report', label: 'Report' }] : []),
    ...(app.can('manageEvents') ? [{ to: '/event/settings', label: 'Settings' }] : []),
  ];
  return (
    <div className="page">
      <PageHeader
        eyebrow={
          <span className="row" style={{ gap: 8 }}>
            <Badge tone={ev.status === 'live' ? 'good' : ev.status === 'planning' ? 'teal' : undefined}>{EVENT_STATUS_LABEL[ev.status]}</Badge>
            {fmtDateRange(ev.startDate, ev.endDate)}
            {ev.boothNo ? ` · Booth ${ev.boothNo}` : ''}
          </span>
        }
        title={ev.name}
        subtitle={[ev.venue, ev.organizer].filter(Boolean).join(' · ') || undefined}
      />
      <Tabs items={tabs} />
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route index element={<SummaryTab ev={ev} />} />
          <Route path="prices" element={app.can('editPrices') ? <PricesTab ev={ev} /> : <Navigate to="/event" replace />} />
          <Route path="stock" element={<StockTab ev={ev} />} />
          <Route path="spend" element={app.can('spend') ? <SpendTab ev={ev} /> : <Navigate to="/event" replace />} />
          <Route path="team" element={owner ? <TeamTab ev={ev} /> : <Navigate to="/event" replace />} />
          <Route path="report" element={owner ? <ReportTab ev={ev} /> : <Navigate to="/event" replace />} />
          <Route path="settings" element={app.can('manageEvents') ? <EventSettingsTab ev={ev} /> : <Navigate to="/event" replace />} />
          <Route path="*" element={<Navigate to="/event" replace />} />
        </Routes>
      </Suspense>
    </div>
  );
}
