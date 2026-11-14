import { db } from '../db/db';
import { setLocal } from '../db/local';
import { getDriveFile, listDrive } from '../drive/drive';

/**
 * Custom sticker designs for the customer screen: PNGs in the Drive folder
 * "JoshWorks POS / Custom stickers", named like CS01-Couple.png. The number
 * and the name come from the file name. They're copied onto the laptop that
 * runs the screen, so they keep showing with no internet.
 */

/** The most designs kept on the device. */
export const MAX_STICKERS = 60;

/** "CS02-CoupleSing.png" → { code: "CS02", label: "Couple Sing" }. Names without a number keep their name as the label. */
export function parseStickerName(file: string): { code: string; label: string } {
  const base = file.replace(/\.[a-z0-9]{2,5}$/i, '').trim();
  const m = base.match(/^([A-Za-z]{1,4}[-_ ]?\d{1,4})(?:[-_ ]+(.*))?$/);
  const code = m ? m[1].replace(/[-_ ]/g, '').toUpperCase() : '';
  const rest = (m ? (m[2] ?? '') : base)
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
  return { code, label: rest ? rest[0].toUpperCase() + rest.slice(1) : '' };
}

/** Copy new and changed designs from Drive, and drop the ones taken out of the folder. */
export async function refreshStickers(): Promise<{ added: number; removed: number; total: number }> {
  const files = (await listDrive('stickers')).filter((f) => f.type.startsWith('image/')).slice(0, MAX_STICKERS);
  const have = await db.stickerArt.toArray();
  const byId = new Map(have.map((h) => [h.id, h]));
  let added = 0;
  for (const f of files) {
    const h = byId.get(f.id);
    if (h && h.updated === f.updated && h.name === f.name) continue;
    const blob = await getDriveFile('stickers', f.id);
    await db.stickerArt.put({ id: f.id, name: f.name, ...parseStickerName(f.name), type: f.type, blob, updated: f.updated, fetchedAt: Date.now() });
    added++;
  }
  const keep = new Set(files.map((f) => f.id));
  const gone = have.filter((h) => !keep.has(h.id)).map((h) => h.id);
  await db.stickerArt.bulkDelete(gone);
  await setLocal('stickerSync', { at: Date.now(), total: files.length });
  return { added, removed: gone.length, total: files.length };
}
