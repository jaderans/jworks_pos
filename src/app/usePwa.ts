import { useEffect, useRef } from 'react';
import { useApp } from './AppContext';

/**
 * Registers the offline service worker. When a new version is published the
 * app offers a reload instead of reloading by itself (never mid-sale).
 */
export function usePwaUpdates() {
  const app = useApp();
  const toast = useRef(app.toast);
  toast.current = app.toast;

  useEffect(() => {
    if (import.meta.env.DEV) return;
    let cancelled = false;
    import('virtual:pwa-register')
      .then(({ registerSW }) => {
        if (cancelled) return;
        const update = registerSW({
          onNeedRefresh() {
            toast.current('A new version of the app is ready.', { action: { label: 'Reload', onClick: () => void update(true) }, ms: 60_000 });
          },
          onOfflineReady() {
            toast.current('Ready to work offline on this device.', { tone: 'good' });
          },
        });
      })
      .catch(() => {
        /* service workers unavailable (http or private mode): the app still runs online */
      });
    return () => {
      cancelled = true;
    };
  }, []);
}
