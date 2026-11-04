import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useApp } from './AppContext';

/**
 * Registers the offline service worker and keeps every device on the newest
 * version. New versions are looked for every half hour and whenever the app
 * comes back to the screen. A new version goes on by itself only when that's
 * safe (just opened, or in the background with no sale in the cart); otherwise
 * a banner stays up until someone taps Update. Never mid-sale.
 */

let ready = false;
let apply: ((reload?: boolean) => Promise<void>) | null = null;
const subscribers = new Set<() => void>();

function setReady(v: boolean) {
  ready = v;
  subscribers.forEach((f) => f());
}

export const useUpdateReady = () =>
  useSyncExternalStore(
    (cb) => {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
    () => ready,
  );

export function applyUpdate() {
  void apply?.(true);
}

const OPENED_AT = Date.now();

/** A sale is being rung up somewhere on this device (carts are kept per event). */
function cartInUse(): boolean {
  try {
    return Object.keys(localStorage).some((k) => k.startsWith('jwpos-cart-'));
  } catch {
    return false;
  }
}

const safeToUpdate = () => !cartInUse() && (document.visibilityState === 'hidden' || Date.now() - OPENED_AT < 20_000);

export function usePwaUpdates() {
  const app = useApp();
  const toast = useRef(app.toast);
  toast.current = app.toast;

  useEffect(() => {
    if (import.meta.env.DEV) return;
    let cancelled = false;
    const cleanups: (() => void)[] = [];
    import('virtual:pwa-register')
      .then(({ registerSW }) => {
        if (cancelled) return;
        apply = registerSW({
          onNeedRefresh() {
            setReady(true);
            if (safeToUpdate()) applyUpdate();
          },
          onOfflineReady() {
            toast.current('Ready to work offline on this device.', { tone: 'good' });
          },
          onRegisteredSW(_url, reg) {
            if (!reg) return;
            const check = () => {
              if (navigator.onLine) void reg.update().catch(() => undefined);
            };
            const timer = window.setInterval(check, 30 * 60_000);
            const onVisibility = () => {
              if (document.visibilityState === 'visible') check();
              else if (ready && safeToUpdate()) applyUpdate();
            };
            document.addEventListener('visibilitychange', onVisibility);
            cleanups.push(() => {
              window.clearInterval(timer);
              document.removeEventListener('visibilitychange', onVisibility);
            });
          },
        });
      })
      .catch(() => {
        /* service workers unavailable (http or private mode): the app still runs online */
      });
    return () => {
      cancelled = true;
      cleanups.forEach((f) => f());
    };
  }, []);
}
