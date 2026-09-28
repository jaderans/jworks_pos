import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import {
  CalendarDays, Calculator, ChevronDown, ChevronsLeft, ChevronsRight, CloudUpload, History, Layers, LayoutGrid, Menu,
  Monitor, Moon, Package, ReceiptText, Settings, ShoppingCart, Store, Sun, UserRound, Users, WifiOff, type LucideIcon,
} from 'lucide-react';
import logo from '../assets/brand/logo-128.png';
import { useApp, type Permission } from './AppContext';
import { useAudit, useEvents, useMembers, usePendingCount } from '../hooks/data';
import { Dialog } from '../components/Dialog';
import { Popover } from '../components/Popover';
import { Badge, Button, Initials } from '../components/ui';
import { EVENT_STATUS_LABEL } from '../services/events';
import { ROLE_LABEL } from '../services/team';
import { fmtDateRange, relativeTime } from '../lib/time';
import { applyTheme, getTheme, setTheme, type ThemeMode } from '../lib/theme';
import { useSyncStatus } from '../sync/useSync';
import { ACTIVITY_LABELS, activityTone } from '../features/activity/labels';
import { ErrorBoundary } from './ErrorBoundary';
import type { AppRole } from '../db/types';

interface NavItem {
  to: string;
  /** Full sidebar label; `short` is used in the narrow rail and the phone bar. */
  label: string;
  short?: string;
  icon: LucideIcon;
  perm?: Permission;
  roles?: AppRole[];
  end?: boolean;
}

interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

const GROUPS: NavGroup[] = [
  { id: 'home', label: 'Home', items: [{ to: '/', label: 'Dashboard', icon: LayoutGrid, perm: 'dashboard', end: true }] },
  {
    id: 'selling',
    label: 'Selling',
    items: [
      { to: '/sell', label: 'Sell', icon: ShoppingCart, perm: 'sell' },
      { to: '/sales', label: 'Sales log', short: 'Sales', icon: ReceiptText, perm: 'viewSales' },
    ],
  },
  {
    id: 'events',
    label: 'Events',
    items: [
      { to: '/event', label: 'This event', short: 'Event', icon: Store, perm: 'viewEvent' },
      { to: '/events', label: 'All events', short: 'Events', icon: CalendarDays, perm: 'manageEvents' },
    ],
  },
  {
    id: 'studio',
    label: 'Studio',
    items: [
      { to: '/products', label: 'Products', icon: Package, perm: 'editProducts' },
      { to: '/production', label: 'Production', icon: Layers, perm: 'production' },
      { to: '/calculator', label: 'Pricing', icon: Calculator, perm: 'calculator' },
    ],
  },
  {
    id: 'people',
    label: 'People',
    items: [
      { to: '/team', label: 'Team', icon: Users, perm: 'manageTeam' },
      { to: '/me', label: 'My page', icon: UserRound, roles: ['designer', 'partner', 'cashier'] },
    ],
  },
];

const NAV_KEY = 'jwpos-nav';
const SEEN_KEY = 'jwpos-activity-seen';

function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: it just won't be remembered */
  }
}

export function Shell() {
  const app = useApp();
  const [eventPicker, setEventPicker] = useState(false);
  const [userPicker, setUserPicker] = useState(false);
  const [more, setMore] = useState(false);
  const [theme, setThemeState] = useState<ThemeMode>(getTheme());
  const [navMode, setNavMode] = useState<'full' | 'rail'>(() => (readPref(NAV_KEY) === 'rail' ? 'rail' : 'full'));
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'auto') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => applyTheme('auto');
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [theme]);

  const allowed = (n: NavItem) => (n.perm ? app.can(n.perm) : true) && (n.roles ? n.roles.includes(app.role) : true);
  const groups = GROUPS.map((g) => ({ ...g, items: g.items.filter(allowed) })).filter((g) => g.items.length > 0);
  const flat = groups.flatMap((g) => g.items);
  // Phones: four tabs, the rest under More.
  const primary = flat.length <= 5 ? flat : flat.slice(0, 4);
  const primarySet = new Set(primary.map((n) => n.to));
  const moreGroups = groups.map((g) => ({ ...g, items: g.items.filter((n) => !primarySet.has(n.to)) })).filter((g) => g.items.length > 0);

  const pickTheme = (m: ThemeMode) => {
    setTheme(m);
    setThemeState(m);
  };
  const toggleNav = () => {
    const next = navMode === 'full' ? 'rail' : 'full';
    setNavMode(next);
    writePref(NAV_KEY, next);
  };

  return (
    <div className="shell" data-nav={navMode}>
      <aside className="sidebar">
        <Link to="/" className="side-brand" aria-label="JoshWorks POS home">
          <img src={logo} alt="" width={36} height={36} />
          <span className="brand-text">
            <b>JoshWorks</b>
            <span>POS</span>
          </span>
        </Link>
        <nav className="side-nav" aria-label="Main">
          {groups.map((g) => (
            <div key={g.id} className="nav-group" role="group" aria-label={g.label}>
              {g.id !== 'home' ? (
                <span className="nav-group-label" aria-hidden="true">
                  {g.label}
                </span>
              ) : null}
              {g.items.map((n) => (
                <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`} title={n.label}>
                  <n.icon size={20} aria-hidden="true" />
                  <span className="nav-label full">{n.label}</span>
                  <span className="nav-label short" aria-hidden="true">
                    {n.short ?? n.label}
                  </span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <button type="button" className="nav-collapse" onClick={toggleNav} aria-label={navMode === 'full' ? 'Collapse the menu' : 'Expand the menu'} title={navMode === 'full' ? 'Collapse the menu' : 'Expand the menu'}>
          {navMode === 'full' ? <ChevronsLeft size={18} /> : <ChevronsRight size={18} />}
          <span className="nav-label full">Collapse</span>
        </button>
      </aside>

      <header className="topbar">
        <Link to="/" className="topbar-brand" aria-label="JoshWorks POS home">
          <img src={logo} alt="" width={34} height={34} />
        </Link>
        {app.can('viewEvent') || app.can('sell') ? (
          <button type="button" className="event-switch" onClick={() => setEventPicker(true)} aria-label="Change event">
            <CalendarDays size={18} aria-hidden="true" />
            <span className="label">{app.activeEvent?.name ?? 'Pick an event'}</span>
            {app.activeEvent ? (
              <span className="hide-phone">
                <Badge tone={app.activeEvent.status === 'live' ? 'good' : undefined}>{EVENT_STATUS_LABEL[app.activeEvent.status]}</Badge>
              </span>
            ) : null}
            <ChevronDown size={16} aria-hidden="true" />
          </button>
        ) : null}
        <div className="spacer" />
        <ConnectionPill />
        {app.can('activity') ? <ActivityMenu /> : null}
        <Popover
          label="Account and settings"
          buttonClass="user-chip"
          button={
            <>
              <Initials name={app.member?.name ?? 'Owner'} />
              <span className="who hide-phone">
                <b>{app.member?.name ?? 'Owner'}</b>
                <span>{ROLE_LABEL[app.role]}</span>
              </span>
              <ChevronDown size={16} aria-hidden="true" className="hide-phone" />
            </>
          }
        >
          {(close) => (
            <div className="menu">
              <div className="menu-head">
                <Initials name={app.member?.name ?? 'Owner'} size="lg" />
                <div className="grow">
                  <b>{app.member?.name ?? 'Owner'}</b>
                  <div className="muted small">{app.member?.roleLabel || ROLE_LABEL[app.role]}</div>
                </div>
                <Badge tone={app.role === 'owner' ? 'yellow' : app.role === 'cashier' ? 'teal' : undefined}>{ROLE_LABEL[app.role]}</Badge>
              </div>
              <div className="menu-section">
                <span className="menu-label" id="theme-label">
                  Appearance
                </span>
                <div className="seg full" role="group" aria-labelledby="theme-label">
                  {(['light', 'dark', 'auto'] as ThemeMode[]).map((m) => (
                    <button key={m} type="button" aria-pressed={theme === m} onClick={() => pickTheme(m)}>
                      {m === 'light' ? <Sun size={15} aria-hidden="true" /> : m === 'dark' ? <Moon size={15} aria-hidden="true" /> : <Monitor size={15} aria-hidden="true" />}
                      {m === 'light' ? 'Light' : m === 'dark' ? 'Dark' : 'Auto'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="menu-list">
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    close();
                    setUserPicker(true);
                  }}
                >
                  <Users size={18} aria-hidden="true" /> {app.locked ? 'Who’s signed in' : 'Switch person'}
                </button>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    close();
                    navigate('/me');
                  }}
                >
                  <UserRound size={18} aria-hidden="true" /> My page
                </button>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    close();
                    navigate('/settings');
                  }}
                >
                  <Settings size={18} aria-hidden="true" /> Settings
                </button>
              </div>
            </div>
          )}
        </Popover>
      </header>

      <main className={location.pathname === '/sell' ? 'main flush' : 'main'} id="main">
        <ErrorBoundary key={location.pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>

      <nav className="bottomnav" aria-label="Main" style={{ gridTemplateColumns: `repeat(${primary.length + (moreGroups.length ? 1 : 0)}, minmax(0, 1fr))` }}>
        {primary.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'active' : '')}>
            <n.icon size={22} aria-hidden="true" />
            <span>{n.short ?? n.label}</span>
          </NavLink>
        ))}
        {moreGroups.length ? (
          <button type="button" onClick={() => setMore(true)} className={moreGroups.some((g) => g.items.some((n) => location.pathname.startsWith(n.to))) ? 'active' : ''}>
            <Menu size={22} aria-hidden="true" />
            <span>More</span>
          </button>
        ) : null}
      </nav>

      <Dialog open={more} onClose={() => setMore(false)} title="More" size="sm">
        {moreGroups.map((g) => (
          <div key={g.id} className="stack tight">
            <span className="eyebrow">{g.label}</span>
            <div className="card flush">
              <div className="list">
                {g.items.map((n) => (
                  <button
                    key={n.to}
                    type="button"
                    className="list-item click"
                    style={{ border: 0, background: 'none', textAlign: 'left', width: '100%', borderBottom: '1px solid var(--line)' }}
                    onClick={() => {
                      setMore(false);
                      navigate(n.to);
                    }}
                  >
                    <n.icon size={20} aria-hidden="true" />
                    <span className="main-text">
                      <b>{n.label}</b>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ))}
      </Dialog>

      <EventPicker open={eventPicker} onClose={() => setEventPicker(false)} />
      <UserPicker open={userPicker} onClose={() => setUserPicker(false)} />
    </div>
  );
}

function ActivityMenu() {
  const app = useApp();
  const audit = useAudit(8);
  const members = useMembers();
  const [seen, setSeen] = useState(() => Number(readPref(SEEN_KEY) ?? 0));
  const names = new Map((members ?? []).map((m) => [m.id, m.name]));
  // A dot means someone else changed something (a synced phone, another person) since you last looked.
  const fresh = (audit ?? []).some((a) => a.at > seen && a.actorId !== (app.member?.id ?? null));
  return (
    <Popover
      label="Recent activity"
      buttonClass="icon-btn activity-btn"
      onOpenChange={(open) => {
        if (!open) return;
        const now = Date.now();
        setSeen(now);
        writePref(SEEN_KEY, String(now));
      }}
      button={
        <>
          <History size={18} aria-hidden="true" />
          {fresh ? <span className="ping" aria-hidden="true" /> : null}
        </>
      }
    >
      {(close) => (
        <div className="menu activity-menu">
          <div className="menu-head between">
            <b>Recent activity</b>
            <Link to="/activity" className="small strong" onClick={close}>
              See all
            </Link>
          </div>
          {audit && audit.length === 0 ? <p className="muted small" style={{ padding: '4px 14px 14px' }}>Nothing yet. Price changes, voids and payouts show up here.</p> : null}
          <div className="menu-list">
            {(audit ?? []).map((a) => (
              <div key={a.id} className="act-row">
                <Badge tone={activityTone(a.action)}>{ACTIVITY_LABELS[a.action] ?? a.action}</Badge>
                <div className="grow">
                  <div className="act-text">{a.summary}</div>
                  <div className="muted tiny">
                    {relativeTime(a.at)}
                    {a.actorId ? ` · ${names.get(a.actorId) ?? 'someone'}` : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Popover>
  );
}

function ConnectionPill() {
  const app = useApp();
  const pending = usePendingCount() ?? 0;
  const sync = useSyncStatus();
  if (!app.online) {
    return (
      <span className="status-pill offline" title="Selling still works. Sales are saved on this device.">
        <span className="dot" />
        <WifiOff size={14} aria-hidden="true" />
        <span className="hide-phone">Offline{sync.enabled && pending ? ` · ${pending} waiting` : ''}</span>
      </span>
    );
  }
  if (sync.enabled) {
    const busy = sync.state === 'syncing';
    return (
      <span className={`status-pill ${sync.state === 'error' ? 'error' : busy ? 'busy' : 'online'}`} title={sync.message}>
        <span className="dot" />
        <CloudUpload size={14} aria-hidden="true" />
        <span className="hide-phone">{sync.state === 'error' ? 'Sync problem' : pending ? `${pending} to sync` : 'Synced'}</span>
      </span>
    );
  }
  return (
    <span className="status-pill online hide-tablet" title="Online. Cloud sync is not set up, so data stays on this device.">
      <span className="dot" />
      On this device
    </span>
  );
}

function EventPicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const app = useApp();
  const events = useEvents();
  const navigate = useNavigate();
  const shown = (events ?? []).filter((e) => e.status !== 'reported' || e.id === app.activeEventId);
  const archived = (events ?? []).filter((e) => e.status === 'reported' && e.id !== app.activeEventId);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Choose the event"
      footer={
        app.can('manageEvents') ? (
          <Button
            variant="primary"
            onClick={() => {
              onClose();
              navigate('/events?new=1');
            }}
          >
            New event
          </Button>
        ) : undefined
      }
    >
      {events && events.length === 0 ? <p className="muted">No events yet. Create one to start selling.</p> : null}
      <div className="card flush">
        <div className="list">
          {[...shown, ...archived].map((e) => (
            <button
              key={e.id}
              type="button"
              className="list-item click"
              style={{ border: 0, borderBottom: '1px solid var(--line)', background: e.id === app.activeEventId ? 'var(--teal-soft)' : 'none', textAlign: 'left', width: '100%' }}
              onClick={() => {
                app.setActiveEventId(e.id);
                onClose();
              }}
            >
              <CalendarDays size={20} aria-hidden="true" />
              <span className="main-text">
                <b>{e.name}</b>
                <span>
                  {fmtDateRange(e.startDate, e.endDate)}
                  {e.venue ? ` · ${e.venue}` : ''}
                </span>
              </span>
              <Badge tone={e.status === 'live' ? 'good' : e.status === 'planning' ? 'teal' : undefined}>{EVENT_STATUS_LABEL[e.status]}</Badge>
            </button>
          ))}
        </div>
      </div>
    </Dialog>
  );
}

function UserPicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const app = useApp();
  const members = useMembers();
  const active = (members ?? []).filter((m) => m.active === 1 && (!app.locked || m.id === app.member?.id));
  return (
    <Dialog open={open} onClose={onClose} title="Who's using this device?">
      {app.locked ? (
        <p className="muted small">This device is signed in to the team as {app.member?.name ?? 'you'}. To use another account, sign out in Settings → Cloud sync.</p>
      ) : (
        <p className="muted small">Switching to a cashier hides costs and payouts on this device. Switching back to the owner needs the owner PIN.</p>
      )}
      <div className="card flush">
        <div className="list">
          {active.map((m) => (
            <button
              key={m.id}
              type="button"
              className="list-item click"
              style={{ border: 0, borderBottom: '1px solid var(--line)', background: m.id === app.member?.id ? 'var(--teal-soft)' : 'none', textAlign: 'left', width: '100%' }}
              onClick={async () => {
                const ok = await app.switchMember(m.id);
                if (ok) {
                  app.toast(`${m.name} is using this device`, { tone: 'good' });
                  onClose();
                }
              }}
            >
              <Initials name={m.name} />
              <span className="main-text">
                <b>{m.name}</b>
                <span>{m.roleLabel || ROLE_LABEL[m.appRole]}</span>
              </span>
              <Badge tone={m.appRole === 'owner' ? 'yellow' : m.appRole === 'cashier' ? 'teal' : undefined}>{ROLE_LABEL[m.appRole]}</Badge>
            </button>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
