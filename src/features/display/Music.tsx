import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';

/**
 * The owner's music on the customer screen, one track after another in their
 * order, round and round. It fades out (and pauses) while `play` is off: while
 * the wheel spins, an order is called, or a video plays its own sound.
 */
export function Music({ play, volume }: { play: boolean; volume: number }) {
  const tracks = useLiveQuery(async () => (await db.displayMedia.orderBy('sort').toArray()).filter((m) => m.kind === 'audio' && m.role === 'music' && m.on === 1), []);
  const [n, setN] = useState(0);
  const track = tracks?.length ? tracks[n % tracks.length] : null;
  const url = useMemo(() => (track ? URL.createObjectURL(track.blob) : ''), [track]);
  useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url]);
  const ref = useRef<HTMLAudioElement>(null);
  const target = Math.max(0, Math.min(1, volume));

  useEffect(() => {
    const a = ref.current;
    if (!a || !url) return;
    let t = 0;
    if (play) {
      if (a.paused) {
        a.volume = 0;
        void a.play().catch(() => undefined);
      }
    }
    // Ease the volume toward where it should be, then pause when it reaches nothing.
    const goal = play ? target : 0;
    t = window.setInterval(() => {
      const next = a.volume + Math.sign(goal - a.volume) * Math.min(0.05, Math.abs(goal - a.volume));
      a.volume = Math.max(0, Math.min(1, next));
      if (Math.abs(a.volume - goal) < 0.01) {
        a.volume = goal;
        if (!play) a.pause();
        window.clearInterval(t);
      }
    }, 60);
    return () => window.clearInterval(t);
  }, [play, url, target]);

  if (!url) return null;
  return <audio ref={ref} src={url} preload="auto" onEnded={() => setN((x) => x + 1)} onError={() => setN((x) => x + 1)} />;
}
