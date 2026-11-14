import { boothFrame, centerSquare, type BoothFrameKey } from '../domain/booth';
import markUrl from '../assets/brand/mark-outline.png';
import lockupUrl from '../assets/brand/lockup-on-light.png';

/**
 * The JoshWorks frames, drawn on a canvas. The live preview (on both screens)
 * and the saved photo use the same drawing, so what the customer sees is what
 * they get.
 */

export interface FrameArt {
  mark: HTMLImageElement;
  lockup: HTMLImageElement;
}

let art: Promise<FrameArt> | null = null;

const load = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Couldn’t load ${src}`));
    img.src = src;
  });

/** The logo images, loaded once. */
export function loadFrameArt(): Promise<FrameArt> {
  art ??= Promise.all([load(markUrl), load(lockupUrl)]).then(([mark, lockup]) => ({ mark, lockup }));
  return art;
}

export interface FrameOptions {
  /** Flip left to right, like a mirror. */
  mirror: boolean;
  eventName: string;
  date: string;
  art: FrameArt | null;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawPhoto(ctx: CanvasRenderingContext2D, src: CanvasImageSource, srcW: number, srcH: number, x: number, y: number, s: number, mirror: boolean) {
  const { sx, sy, size } = centerSquare(srcW, srcH);
  if (!size) {
    ctx.fillStyle = '#2B2627';
    ctx.fillRect(x, y, s, s);
    return;
  }
  ctx.save();
  if (mirror) {
    ctx.translate(x + s, y);
    ctx.scale(-1, 1);
    ctx.drawImage(src, sx, sy, size, size, 0, 0, s, s);
  } else {
    ctx.drawImage(src, sx, sy, size, size, x, y, s, s);
  }
  ctx.restore();
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

/** Draw the framed photo onto a canvas the frame's size (see BOOTH_FRAMES). */
export function drawBoothFrame(ctx: CanvasRenderingContext2D, key: BoothFrameKey, src: CanvasImageSource, srcW: number, srcH: number, o: FrameOptions): void {
  const f = boothFrame(key);
  const { w, h } = f;
  ctx.clearRect(0, 0, w, h);
  if (f.key === 'sticker') {
    // The white die-cut edge, then the photo with rounded corners inside it.
    ctx.fillStyle = '#FFFFFF';
    roundRect(ctx, 24, 24, w - 48, h - 48, 150);
    ctx.fill();
    ctx.save();
    roundRect(ctx, 70, 70, w - 140, h - 140, 110);
    ctx.clip();
    drawPhoto(ctx, src, srcW, srcH, 70, 70, w - 140, o.mirror);
    ctx.restore();
    if (o.art) ctx.drawImage(o.art.mark, w - 262, h - 262, 250, 250);
    return;
  }
  if (f.key === 'polaroid') {
    ctx.fillStyle = '#FFFDF8';
    ctx.fillRect(0, 0, w, h);
    drawPhoto(ctx, src, srcW, srcH, 70, 70, w - 140, o.mirror);
    const base = 70 + (w - 140);
    if (o.art) {
      const lh = 104;
      ctx.drawImage(o.art.lockup, 70, base + 78, (lh * o.art.lockup.naturalWidth) / o.art.lockup.naturalHeight, lh);
    }
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#231F20';
    ctx.font = "600 44px Sora, Manrope, 'Segoe UI', sans-serif";
    ctx.fillText(fitText(ctx, o.eventName, 560), w - 70, base + 128);
    ctx.fillStyle = '#6B6566';
    ctx.font = "500 34px Manrope, 'Segoe UI', sans-serif";
    ctx.fillText(o.date, w - 70, base + 180);
    // The brand bar along the bottom: teal, then yellow.
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, '#1A8C99');
    g.addColorStop(0.32, '#4FC0D0');
    g.addColorStop(0.58, '#7FD3E0');
    g.addColorStop(0.58, '#FEC756');
    g.addColorStop(0.82, '#F9BB2E');
    g.addColorStop(1, '#E9A517');
    ctx.fillStyle = g;
    ctx.fillRect(0, h - 20, w, 20);
    return;
  }
  drawPhoto(ctx, src, srcW, srcH, 0, 0, w, o.mirror);
  if (o.art) ctx.drawImage(o.art.mark, w - 206, h - 206, 170, 170);
}

/** The finished file: the frame drawn at full size. */
export async function captureBoothPhoto(key: BoothFrameKey, src: CanvasImageSource, srcW: number, srcH: number, o: Omit<FrameOptions, 'art'>): Promise<Blob> {
  const f = boothFrame(key);
  const canvas = document.createElement('canvas');
  canvas.width = f.w;
  canvas.height = f.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser can’t draw the photo.');
  const a = await loadFrameArt().catch(() => null);
  drawBoothFrame(ctx, key, src, srcW, srcH, { ...o, art: a });
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Couldn’t save the photo.'))), f.type, 0.92));
}
