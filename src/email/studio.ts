import type { MailerSettings } from '../db/types';

/**
 * JoshWorks Studio lives on the same site (jaderans.github.io), so on a device
 * that has both apps the POS can read Studio's mailer link and key from Studio's
 * own database. Read-only, and it never creates that database if it isn't there.
 */
const STUDIO_DB = 'jworks-campaigns';

export async function studioMailer(): Promise<Pick<MailerSettings, 'url' | 'key' | 'replyTo'> | null> {
  try {
    if (typeof indexedDB === 'undefined') return null;
    if (indexedDB.databases) {
      const list = await indexedDB.databases();
      if (!list.some((d) => d.name === STUDIO_DB)) return null;
    }
    const handle = await new Promise<IDBDatabase | null>((resolve) => {
      const req = indexedDB.open(STUDIO_DB);
      // Studio isn't on this device: undo instead of creating an empty database.
      req.onupgradeneeded = () => req.transaction?.abort();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    });
    if (!handle) return null;
    try {
      if (!handle.objectStoreNames.contains('settings')) return null;
      const row = await new Promise<{ value?: { mailerUrl?: string; mailerKey?: string; replyTo?: string } } | undefined>((resolve) => {
        const r = handle.transaction('settings', 'readonly').objectStore('settings').get('email');
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => resolve(undefined);
      });
      const v = row?.value;
      if (!v?.mailerUrl || !v.mailerKey) return null;
      return { url: v.mailerUrl, key: v.mailerKey, replyTo: v.replyTo ?? '' };
    } finally {
      handle.close();
    }
  } catch {
    return null;
  }
}
