import { useEffect, useState } from 'react';

/**
 * The booth camera: the laptop's webcam, a USB webcam, a phone used as a
 * webcam (Phone Link, Camo, DroidCam) or a DSLR through its webcam app or an
 * HDMI capture card. They all show up in the same list.
 */

export async function listCameras(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
}

export function cameraError(e: unknown): string {
  const name = e instanceof DOMException || e instanceof Error ? e.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'The camera is blocked. Click the camera icon in the address bar, choose Allow, then try again.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera found. Plug in a webcam, or start the phone or DSLR webcam app, then try again.';
  if (name === 'NotReadableError' || name === 'AbortError') return 'Another app is using the camera. Close it (Zoom, Teams, the Camera app), then try again.';
  return e instanceof Error ? e.message : 'The camera didn’t start.';
}

async function open(deviceId: string): Promise<MediaStream> {
  const size = { width: { ideal: 1920 }, height: { ideal: 1080 } };
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser can’t use a camera. Use Chrome or Edge.');
  try {
    return await navigator.mediaDevices.getUserMedia({ video: deviceId ? { deviceId: { exact: deviceId }, ...size } : size, audio: false });
  } catch (e) {
    // The chosen camera is gone (unplugged): take whichever is there.
    if (deviceId && e instanceof DOMException && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError')) return navigator.mediaDevices.getUserMedia({ video: size, audio: false });
    throw e;
  }
}

/**
 * A playing video of the camera, for drawing frames from. Turns the camera off
 * when `on` goes false or the page closes.
 */
export function useCamera(deviceId: string, on: boolean): { video: HTMLVideoElement | null; error: string; deviceId: string; retry: () => void } {
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [error, setError] = useState('');
  const [using, setUsing] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!on) return;
    let stream: MediaStream | null = null;
    let gone = false;
    setError('');
    open(deviceId)
      .then(async (s) => {
        if (gone) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        const v = document.createElement('video');
        v.muted = true;
        v.playsInline = true;
        v.srcObject = s;
        await v.play().catch(() => undefined);
        if (gone) return;
        setUsing(s.getVideoTracks()[0]?.getSettings().deviceId ?? deviceId);
        setVideo(v);
      })
      .catch((e) => !gone && setError(cameraError(e)));
    return () => {
      gone = true;
      stream?.getTracks().forEach((t) => t.stop());
      setVideo(null);
    };
  }, [deviceId, on, attempt]);
  return { video, error, deviceId: using, retry: () => setAttempt((n) => n + 1) };
}
