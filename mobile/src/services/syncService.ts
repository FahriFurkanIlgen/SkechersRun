import * as Network from 'expo-network';
import { activityRepo } from '../data/local/activityRepo';
import { submitActivity } from '../data/remote/activityApi';
import { backendConfigured } from '../data/remote/supabase';
import { useAuth } from '../state/authStore';
import { useSettings } from '../state/settingsStore';
import { notifyActivityProcessed } from './notifications';

/**
 * Outbox: saved activities are uploaded when a session and connectivity are
 * available. Uploads are idempotent (client UUID), so retries are safe.
 */
let running: Promise<number> | null = null;

export function canSync(): boolean {
  return backendConfigured && !!useAuth.getState().session;
}

async function run(): Promise<number> {
  if (!canSync()) return 0;
  const net = await Network.getNetworkStateAsync();
  if (net.isInternetReachable === false || net.isConnected === false) return 0;

  const pending = await activityRepo.listPendingUpload();
  let uploaded = 0;
  for (const activity of pending) {
    try {
      const points = await activityRepo.getPoints(activity.id);
      const { remoteId, claim } = await submitActivity(activity, points);
      await activityRepo.markSynced(activity.id, remoteId, claim);
      await notifyActivityProcessed(claim, useSettings.getState().notificationPrefs, activity.id).catch(() => undefined);
      uploaded++;
    } catch (e) {
      await activityRepo.markSyncError(activity.id, e instanceof Error ? e.message : String(e));
    }
  }
  return uploaded;
}

export function syncPending(): Promise<number> {
  if (!running) running = run().finally(() => (running = null));
  return running;
}
