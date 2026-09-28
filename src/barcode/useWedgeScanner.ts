import { useEffect, useRef } from 'react';
import { isDialogOpen } from '../components/Dialog';

/**
 * USB and Bluetooth barcode scanners in "HID keyboard mode" type the code very
 * fast and press Enter. This listens for that burst anywhere on the page
 * (outside text fields) and hands over the code. People typing are too slow
 * to trigger it.
 */
export function useWedgeScanner(onScan: (code: string) => void, enabled = true) {
  const cb = useRef(onScan);
  cb.current = onScan;

  useEffect(() => {
    if (!enabled) return;
    let buf = '';
    let last = 0;
    let startedAt = 0;
    const onKey = (e: KeyboardEvent) => {
      if (isDialogOpen()) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const now = performance.now();
      if (now - last > 90) {
        buf = '';
        startedAt = now;
      }
      last = now;
      if (e.key === 'Enter') {
        const perChar = buf.length > 1 ? (now - startedAt) / buf.length : 999;
        if (buf.length >= 3 && perChar < 60) {
          e.preventDefault();
          cb.current(buf);
        }
        buf = '';
        return;
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) buf += e.key;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
