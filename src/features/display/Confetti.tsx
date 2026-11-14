import { useEffect, useRef } from 'react';

const COLORS = ['#f7d820', '#1fa3a8', '#ee9d17', '#5fcf94', '#e07a5f', '#ffffff', '#4fc0d0'];
const RUN_MS = 4200;

/** A burst of confetti over the whole screen when someone wins: `burst` changes to fire it. */
export function Confetti({ burst }: { burst: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!burst || !canvas || !ctx) return;
    const w = (canvas.width = window.innerWidth);
    const h = (canvas.height = window.innerHeight);
    const size = Math.max(6, Math.min(w, h) / 90);
    // Two cannons from the bottom corners, and a shower from the top.
    const pieces = Array.from({ length: 220 }, (_, i) => {
      const side = i % 3;
      const fromTop = side === 2;
      const angle = fromTop ? Math.PI / 2 + (Math.random() - 0.5) * 0.8 : side === 0 ? -Math.PI / 3 - Math.random() * 0.5 : (-2 * Math.PI) / 3 + Math.random() * 0.5;
      const speed = fromTop ? Math.random() * 3 : (0.9 + Math.random() * 0.8) * Math.sqrt(h) * 0.9;
      return {
        x: fromTop ? Math.random() * w : side === 0 ? 0 : w,
        y: fromTop ? -20 - Math.random() * h * 0.3 : h,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        spin: Math.random() * Math.PI,
        vs: (Math.random() - 0.5) * 0.3,
        color: COLORS[i % COLORS.length],
        w: size * (0.6 + Math.random() * 0.8),
        h: size * (0.4 + Math.random() * 0.5),
      };
    });
    const start = performance.now();
    let raf = 0;
    let last = start;
    const frame = (now: number) => {
      const dt = Math.min(2.5, (now - last) / 16.7);
      last = now;
      ctx.clearRect(0, 0, w, h);
      const fade = Math.max(0, 1 - Math.max(0, now - start - RUN_MS * 0.7) / (RUN_MS * 0.3));
      ctx.globalAlpha = fade;
      for (const p of pieces) {
        p.vy += 0.32 * dt;
        p.vx *= 0.99;
        p.vy *= 0.99;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.spin += p.vs * dt;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.spin);
        ctx.scale(1, Math.abs(Math.cos(p.spin * 2)) + 0.2);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (now - start < RUN_MS) raf = requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, w, h);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ctx.clearRect(0, 0, w, h);
    };
  }, [burst]);
  return <canvas ref={ref} className="cd-confetti" aria-hidden="true" />;
}
