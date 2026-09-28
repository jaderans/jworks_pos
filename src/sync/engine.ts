import { getLocal } from '../db/local';
import { setSyncStatus } from './useSync';

/**
 * Cloud sync starts only when this device has been connected to the team's
 * Firebase project (Settings → Cloud sync). Until then everything stays on
 * the device and moves between devices with merge files.
 */
export async function startSync(): Promise<void> {
  const cfg = await getLocal<unknown>('cloudConfig', null);
  if (!cfg) {
    setSyncStatus({ enabled: false, state: 'idle', message: 'Cloud sync is not set up.' });
    return;
  }
  const { startCloudSync } = await import('./cloud');
  await startCloudSync();
}
