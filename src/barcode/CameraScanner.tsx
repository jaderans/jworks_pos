import { useEffect, useRef, useState } from 'react';
import { Dialog } from '../components/Dialog';
import { Button, Callout } from '../components/ui';

let audioCtx: AudioContext | null = null;
export function beep() {
  try {
    audioCtx ??= new AudioContext();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.value = 1320;
    g.gain.value = 0.08;
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + 0.09);
  } catch {
    /* no audio */
  }
  try {
    navigator.vibrate?.(40);
  } catch {
    /* no vibration */
  }
}

/**
 * Scan barcodes and QR codes with the phone or laptop camera. It keeps
 * scanning so several items can be added in a row; Done closes it.
 */
export function CameraScanner({ open, onClose, onCode, title = 'Scan with the camera' }: { open: boolean; onClose: () => void; onCode: (code: string) => void; title?: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  const [last, setLast] = useState('');
  const cb = useRef(onCode);
  cb.current = onCode;

  useEffect(() => {
    if (!open) return;
    let stopped = false;
    let controls: { stop: () => void } | null = null;
    let lastCode = '';
    let lastAt = 0;
    setError('');
    setLast('');
    (async () => {
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        if (stopped || !video.current) return;
        const reader = new BrowserMultiFormatReader();
        controls = await reader.decodeFromConstraints({ video: { facingMode: { ideal: 'environment' } }, audio: false }, video.current, (result) => {
          if (!result) return;
          const text = result.getText();
          const now = Date.now();
          if (text === lastCode && now - lastAt < 1800) return;
          lastCode = text;
          lastAt = now;
          beep();
          setLast(text);
          cb.current(text);
        });
        if (stopped) controls.stop();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(
          /Permission|NotAllowed/i.test(msg)
            ? 'The camera is blocked. Allow camera access for this app in your browser settings, then try again.'
            : /secure|https/i.test(msg)
              ? 'The camera only works when the app is opened over https (or on this computer).'
              : 'No camera was found, or it is being used by another app.',
        );
      }
    })();
    return () => {
      stopped = true;
      controls?.stop();
    };
  }, [open]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      {error ? <Callout tone="bad">{error}</Callout> : null}
      <div style={{ position: 'relative', borderRadius: 14, overflow: 'hidden', background: '#000', aspectRatio: '4 / 3' }}>
        <video ref={video} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        <div aria-hidden="true" style={{ position: 'absolute', inset: '22% 12%', border: '3px solid var(--yellow)', borderRadius: 14, boxShadow: '0 0 0 9999px rgba(0,0,0,.25)' }} />
      </div>
      <p className="muted small" role="status">
        {last ? (
          <>
            Scanned <span className="mono">{last}</span>. Point at the next item or tap Done.
          </>
        ) : (
          'Hold the barcode or QR code inside the yellow box.'
        )}
      </p>
    </Dialog>
  );
}
