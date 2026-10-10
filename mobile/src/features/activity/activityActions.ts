import { activityRepo } from '../../data/local/activityRepo';
import { deleteRemoteActivity, updateRemoteActivity } from '../../data/remote/activityApi';
import type { RouteShare, Visibility } from '../../domain/types';
import { exportToAppleHealth } from '../../services/health/appleHealth';
import { canSync, syncPending } from '../../services/syncService';
import { useSettings } from '../../state/settingsStore';

/** Use-case functions for activities; screens call these instead of repositories. */
export const activityActions = {
  async save(id: string, title: string, visibility: Visibility, routeShare: RouteShare = 'trimmed') {
    await activityRepo.save(id, {
      title,
      visibility,
      routeShare,
      syncState: canSync() ? 'pending_upload' : 'local_only',
    });
    // Fire and forget: failures stay in the outbox and are retried later.
    void syncPending();
    const { appleHealthConnected, appleHealthExport } = useSettings.getState();
    if (appleHealthConnected && appleHealthExport) {
      void (async () => {
        const activity = await activityRepo.get(id);
        if (activity) await exportToAppleHealth(activity, await activityRepo.getPoints(id));
      })().catch(() => undefined);
    }
  },

  async discard(id: string) {
    await activityRepo.delete(id);
  },

  async update(id: string, title: string, visibility: Visibility, routeShare: RouteShare) {
    const a = await activityRepo.get(id);
    if (!a) return;
    if (a.remoteId) await updateRemoteActivity(a.remoteId, title, visibility, routeShare);
    await activityRepo.update(id, { title, visibility, routeShare });
  },

  async remove(id: string) {
    const a = await activityRepo.get(id);
    if (a?.remoteId) await deleteRemoteActivity(a.remoteId);
    await activityRepo.delete(id);
  },
};
