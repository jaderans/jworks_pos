import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, Info, XCircle } from 'lucide-react';
import { db } from '../db/db';
import { ensureDevice, setLocal, type DeviceInfo } from '../db/local';
import { setActor, setWriterDevice } from '../db/write';
import { useEvent, useLocal, useMembers, useOnline } from '../hooks/data';
import { hasOwnerPin, verifyOwnerPin } from '../services/team';
import { useSyncStatus } from '../sync/useSync';
import { Dialog } from '../components/Dialog';
import { Button } from '../components/ui';
import type { AppRole, JWEvent, Member } from '../db/types';

export type Permission =
  | 'dashboard'
  | 'sell'
  | 'viewSales'
  | 'voidSale'
  | 'viewEvent'
  | 'viewProfit'
  | 'editPrices'
  | 'editProducts'
  | 'viewCosts'
  | 'production'
  | 'spend'
  | 'manageEvents'
  | 'manageTeam'
  | 'calculator'
  | 'settings'
  | 'activity';

const ALL: Permission[] = [
  'dashboard', 'sell', 'viewSales', 'voidSale', 'viewEvent', 'viewProfit', 'editPrices', 'editProducts', 'viewCosts', 'production', 'spend',
  'manageEvents', 'manageTeam', 'calculator', 'settings', 'activity',
];

export const ROLE_PERMISSIONS: Record<AppRole, readonly Permission[]> = {
  owner: ALL,
  cashier: ['sell', 'viewSales', 'viewEvent'],
  designer: ['viewEvent'],
  partner: [],
};

interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  tone?: 'danger' | 'primary';
}

interface ToastOptions {
  tone?: 'good' | 'bad' | 'info';
  action?: { label: string; onClick: () => void };
  ms?: number;
}

interface AppState {
  device: DeviceInfo;
  refreshDevice: () => Promise<void>;
  activeEventId: string | null;
  activeEvent: JWEvent | null | undefined;
  setActiveEventId: (id: string | null) => void;
  member: Member | null;
  role: AppRole;
  switchMember: (memberId: string) => Promise<boolean>;
  can: (p: Permission) => boolean;
  locked: boolean;
  askOwner: (reason: string) => Promise<boolean>;
  confirm: (o: ConfirmOptions) => Promise<boolean>;
  toast: (message: string, o?: ToastOptions) => void;
  online: boolean;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}

interface ToastItem extends ToastOptions {
  id: number;
  message: string;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [deviceReady, setDeviceReady] = useState(false);
  const online = useOnline();
  const members = useMembers();
  // Device-only values are live, so setup, switching user or picking an event updates every screen at once.
  const device = useLocal<DeviceInfo | null>('device', null);
  const activeEventId = useLocal<string | null>('activeEventId', null) ?? null;
  const memberIdLive = useLocal<string | null>('currentMemberId', null);
  const sync = useSyncStatus();
  // Signed in to the team as a non-owner: the account decides who this is and what they can do.
  const cloudLock = sync.access && sync.access.role !== 'owner' ? sync.access : null;
  const memberId = cloudLock ? cloudLock.memberId : (memberIdLive ?? null);
  const activeEvent = useEvent(activeEventId);
  const ready = deviceReady && !!device && memberIdLive !== undefined;

  useEffect(() => {
    ensureDevice().then(() => setDeviceReady(true));
  }, []);
  useEffect(() => {
    if (device) setWriterDevice(device.deviceId);
  }, [device]);

  const member = useMemo(() => members?.find((m) => m.id === memberId && m.active === 1) ?? null, [members, memberId]);
  // With no member chosen yet (fresh device), the device behaves as the owner's.
  const role: AppRole = cloudLock ? cloudLock.role : (member?.appRole ?? 'owner');

  useEffect(() => setActor(member?.id ?? null), [member]);

  // An event deleted elsewhere stops being the active one.
  useEffect(() => {
    if (activeEventId && (activeEvent === null || activeEvent?.deleted === 1)) void setLocal('activeEventId', null);
  }, [activeEventId, activeEvent]);

  // ----- toasts -----
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const toast = useCallback((message: string, o: ToastOptions = {}) => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-2), { id, message, ...o }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), o.ms ?? (o.tone === 'bad' ? 6000 : o.action ? 7000 : 3200));
  }, []);

  // ----- confirm -----
  const [confirmState, setConfirmState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const confirm = useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => setConfirmState({ ...o, resolve })), []);
  const closeConfirm = (v: boolean) => {
    confirmState?.resolve(v);
    setConfirmState(null);
  };

  // ----- owner PIN -----
  const unlockedUntil = useRef(0);
  const [pinState, setPinState] = useState<{ reason: string; resolve: (v: boolean) => void } | null>(null);
  const askOwner = useCallback(
    async (reason: string) => {
      if (role === 'owner') return true;
      if (Date.now() < unlockedUntil.current) return true;
      if (!(await hasOwnerPin())) return true;
      return new Promise<boolean>((resolve) => setPinState({ reason, resolve }));
    },
    [role],
  );
  const finishPin = (ok: boolean) => {
    if (ok) unlockedUntil.current = Date.now() + 2 * 60 * 1000;
    pinState?.resolve(ok);
    setPinState(null);
  };

  const switchMember = useCallback(
    async (id: string) => {
      const target = await db.members.get(id);
      if (!target) return false;
      if (cloudLock) return false;
      if (target.appRole === 'owner' && role !== 'owner' && (await hasOwnerPin())) {
        const ok = await new Promise<boolean>((resolve) => setPinState({ reason: `Switch to ${target.name} (owner)`, resolve }));
        if (!ok) return false;
      }
      await setLocal('currentMemberId', id);
      return true;
    },
    [role, cloudLock],
  );

  const setActiveEventId = useCallback((id: string | null) => {
    void setLocal('activeEventId', id);
  }, []);

  const refreshDevice = useCallback(async () => {
    const d = await ensureDevice();
    setWriterDevice(d.deviceId);
  }, []);

  const can = useCallback((p: Permission) => ROLE_PERMISSIONS[role].includes(p), [role]);

  if (!ready || !device) return <div className="loading">Opening JoshWorks POS…</div>;

  const value: AppState = {
    device,
    refreshDevice,
    activeEventId,
    activeEvent,
    setActiveEventId,
    member,
    role,
    switchMember,
    can,
    locked: !!cloudLock,
    askOwner,
    confirm,
    toast,
    online,
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone ?? ''}`} role={t.tone === 'bad' ? 'alert' : 'status'}>
            {t.tone === 'good' ? <CheckCircle2 size={18} className="ic" /> : t.tone === 'bad' ? <XCircle size={18} /> : <Info size={18} />}
            <span>{t.message}</span>
            {t.action ? (
              <button type="button" onClick={t.action.onClick}>
                {t.action.label}
              </button>
            ) : null}
          </div>
        ))}
      </div>
      <Dialog
        open={!!confirmState}
        onClose={() => closeConfirm(false)}
        title={confirmState?.title ?? ''}
        size="sm"
        footer={
          <>
            <Button onClick={() => closeConfirm(false)}>Cancel</Button>
            <Button variant={confirmState?.tone === 'danger' ? 'danger' : 'primary'} onClick={() => closeConfirm(true)}>
              {confirmState?.confirmLabel ?? 'Continue'}
            </Button>
          </>
        }
      >
        {typeof confirmState?.message === 'string' ? <p>{confirmState.message}</p> : confirmState?.message}
      </Dialog>
      <PinDialog state={pinState} onDone={finishPin} />
    </Ctx.Provider>
  );
}

function PinDialog({ state, onDone }: { state: { reason: string } | null; onDone: (ok: boolean) => void }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setPin('');
    setError('');
  }, [state]);

  const submit = async (value = pin) => {
    if (!value) return;
    setBusy(true);
    const ok = await verifyOwnerPin(value);
    setBusy(false);
    if (ok) onDone(true);
    else {
      setError('That PIN is not right. Try again.');
      setPin('');
    }
  };

  const press = (d: string) => {
    setError('');
    setPin((p) => (p.length >= 8 ? p : p + d));
  };

  return (
    <Dialog
      open={!!state}
      onClose={() => onDone(false)}
      title="Owner PIN"
      size="sm"
      footer={
        <>
          <Button onClick={() => onDone(false)}>Cancel</Button>
          <Button variant="primary" disabled={!pin || busy} onClick={() => submit()}>
            Confirm
          </Button>
        </>
      }
    >
      <p className="muted">{state?.reason}. Ask the owner to enter their PIN.</p>
      <input
        className="input center"
        style={{ fontSize: '1.6rem', letterSpacing: '0.5em', fontWeight: 800 }}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        aria-label="Owner PIN"
        value={pin}
        autoFocus
        onChange={(e) => {
          setError('');
          setPin(e.target.value.replace(/\D/g, '').slice(0, 8));
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit();
        }}
      />
      {error ? <p className="bad strong small" role="alert">{error}</p> : null}
      <div className="grid-3" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <Button key={d} size="lg" onClick={() => press(d)}>
            {d}
          </Button>
        ))}
        <Button size="lg" variant="ghost" onClick={() => setPin((p) => p.slice(0, -1))}>
          ⌫
        </Button>
        <Button size="lg" onClick={() => press('0')}>
          0
        </Button>
        <Button size="lg" variant="teal" disabled={!pin || busy} onClick={() => submit()}>
          OK
        </Button>
      </div>
    </Dialog>
  );
}
