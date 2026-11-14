import { useEffect, useRef } from 'react';
import { boothFrame, type BoothFrameKey } from '../domain/booth';
import { drawBoothFrame, loadFrameArt, type FrameArt } from './frames';

/** The live camera in its JoshWorks frame, redrawn every frame. */
export function FramePreview({
  video,
  frame,
  mirror,
  eventName,
  date,
  className,
  label,
}: {
  video: HTMLVideoElement | null;
  frame: BoothFrameKey;
  mirror: boolean;
  eventName: string;
  date: string;
  className?: string;
  label: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const f = boothFrame(frame);
    canvas.width = f.w;
    canvas.height = f.h;
    let art: FrameArt | null = null;
    let raf = 0;
    let gone = false;
    void loadFrameArt()
      .then((a) => (art = a))
      .catch(() => null);
    const tick = () => {
      if (gone) return;
      const live = video && video.readyState >= 2 && video.videoWidth > 0;
      drawBoothFrame(ctx, frame, live ? video : canvas, live ? video.videoWidth : 0, live ? video.videoHeight : 0, { mirror, eventName, date, art });
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      gone = true;
      cancelAnimationFrame(raf);
    };
  }, [video, frame, mirror, eventName, date]);
  return <canvas ref={ref} className={className} role="img" aria-label={label} />;
}
