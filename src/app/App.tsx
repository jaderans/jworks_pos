import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import { AppProvider, useApp, type Permission } from './AppContext';
import { Shell } from './Shell';
import { SetupWizard } from '../features/setup/SetupWizard';
import { RegisterPage } from '../features/register/RegisterPage';
import { isSetupDone } from '../services/setup';
import { EmptyState, Loading } from '../components/ui';
import { usePwaUpdates } from './usePwa';
import { clearLanding, peekLanding } from './landing';
import { startSync } from '../sync/engine';
import { JoinPage } from '../features/join/JoinPage';

const DashboardPage = lazy(() => import('../features/dashboard/DashboardPage'));
const SalesLogPage = lazy(() => import('../features/sales/SalesLogPage'));
const EventsPage = lazy(() => import('../features/events/EventsPage'));
const EventPage = lazy(() => import('../features/event/EventPage'));
const ProductsPage = lazy(() => import('../features/products/ProductsPage'));
const ProductionPage = lazy(() => import('../features/production/ProductionPage'));
const CalculatorPage = lazy(() => import('../features/calculator/CalculatorPage'));
const TeamPage = lazy(() => import('../features/team/TeamPage'));
const MyPage = lazy(() => import('../features/me/MyPage'));
const SettingsPage = lazy(() => import('../features/settings/SettingsPage'));
const ActivityPage = lazy(() => import('../features/activity/ActivityPage'));

export function App() {
  return (
    <HashRouter>
      <AppProvider>
        <Gate />
      </AppProvider>
    </HashRouter>
  );
}

function Gate() {
  const [done, setDone] = useState<boolean | null>(null);
  const location = useLocation();
  usePwaUpdates();
  useEffect(() => {
    isSetupDone().then(setDone);
  }, []);
  useEffect(() => {
    if (done) void startSync();
  }, [done]);
  if (done === null) return <Loading />;
  if (location.pathname === '/join')
    return (
      <JoinPage
        onJoined={() => {
          setDone(true);
          window.location.hash = '#/';
        }}
      />
    );
  if (!done) return <SetupWizard onDone={() => setDone(true)} />;
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Home />} />
        <Route path="sell" element={<Guard perm="sell"><RegisterPage /></Guard>} />
        <Route path="sales" element={<Guard perm="viewSales"><Lazy><SalesLogPage /></Lazy></Guard>} />
        <Route path="event/*" element={<Guard perm="viewEvent"><Lazy><EventPage /></Lazy></Guard>} />
        <Route path="events" element={<Guard perm="manageEvents"><Lazy><EventsPage /></Lazy></Guard>} />
        <Route path="products" element={<Guard perm="editProducts"><Lazy><ProductsPage /></Lazy></Guard>} />
        <Route path="production/*" element={<Guard perm="production"><Lazy><ProductionPage /></Lazy></Guard>} />
        <Route path="calculator/*" element={<Guard perm="calculator"><Lazy><CalculatorPage /></Lazy></Guard>} />
        <Route path="team" element={<Guard perm="manageTeam"><Lazy><TeamPage /></Lazy></Guard>} />
        <Route path="me" element={<Lazy><MyPage /></Lazy>} />
        <Route path="activity" element={<Guard perm="activity"><Lazy><ActivityPage /></Lazy></Guard>} />
        <Route path="settings" element={<Lazy><SettingsPage /></Lazy>} />
        <Route path="*" element={<div className="page"><EmptyState title="Page not found">That link doesn&rsquo;t go anywhere in the app.</EmptyState></div>} />
      </Route>
    </Routes>
  );
}

function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={<Loading />}>{children}</Suspense>;
}

function Home() {
  const app = useApp();
  // Decide once: later re-renders (sync status, live queries) must not change where we go.
  const [landing] = useState(() => peekLanding());
  useEffect(() => clearLanding(), []);
  if (landing && landing !== '/') return <Navigate to={landing} replace />;
  if (app.can('dashboard'))
    return (
      <Lazy>
        <DashboardPage />
      </Lazy>
    );
  if (app.can('sell')) return <Navigate to="/sell" replace />;
  return <Navigate to="/me" replace />;
}

function Guard({ perm, children }: { perm: Permission; children: ReactNode }) {
  const app = useApp();
  const loc = useLocation();
  if (!app.can(perm)) {
    return (
      <div className="page narrow">
        <EmptyState title="Not available for your role">
          {loc.pathname === '/sell' ? 'Only the owner and cashiers can sell.' : 'Ask the owner if you need this.'} Switch who&rsquo;s using this device from the top right.
        </EmptyState>
      </div>
    );
  }
  return <>{children}</>;
}
