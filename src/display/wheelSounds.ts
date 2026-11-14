import { db } from '../db/db';
import type { DisplaySettings } from './slides';
import type { SoundChoice } from './sound';

/** The wheel's sounds as set in Settings → Customer screen, with the owner's files read from this laptop. */
export async function wheelSoundChoice(s: DisplaySettings): Promise<SoundChoice | null> {
  if (!s.wheelSound) return null;
  const file = async (id: string) => (id && id !== 'none' ? ((await db.displayMedia.get(id))?.blob ?? null) : null);
  const tune = s.spinTune === 'none' ? 'none' : ((await file(s.spinTune)) ?? 'built-in');
  const win = (await file(s.winSound)) ?? 'built-in';
  return { volume: Math.max(0, Math.min(100, s.soundVolume)) / 100, tune, win };
}
