/** Saving and sharing files from the app, with fallbacks for phones. */

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function canShareFiles(): boolean {
  try {
    const probe = new File(['x'], 'x.txt', { type: 'text/plain' });
    return typeof navigator !== 'undefined' && !!navigator.canShare && navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

/** Opens the phone's share sheet (Messenger, Drive, Nearby Share...). Returns false if unavailable or cancelled. */
export async function shareBlob(blob: Blob, filename: string, title?: string): Promise<boolean> {
  try {
    const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
    if (!navigator.canShare || !navigator.canShare({ files: [file] })) return false;
    await navigator.share({ files: [file], title: title ?? filename });
    return true;
  } catch {
    return false;
  }
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = () => reject(r.error ?? new Error('Could not read the file'));
    r.readAsText(file);
  });
}

export function readFileAsDataURL(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = () => reject(r.error ?? new Error('Could not read the file'));
    r.readAsDataURL(file);
  });
}

/** Shrink a photo (receipt, QR code) so it stays small in storage. */
export async function compressImage(file: Blob, maxSide = 1280, quality = 0.82, mime = 'image/jpeg'): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('That file is not an image the app can read'));
      i.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    if (mime === 'image/jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(img, 0, 0, w, h);
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, quality));
    return out ?? file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function toCSV(rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  const cell = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // BOM so Excel opens the ₱ sign and accents correctly.
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
}

export function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'file';
}
