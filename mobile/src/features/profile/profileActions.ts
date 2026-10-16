import * as ImagePicker from 'expo-image-picker';
import { activityRepo } from '../../data/local/activityRepo';
import { privacyZoneRepo } from '../../data/local/privacyZoneRepo';
import {
  countOwnActivities,
  deleteMyAccount,
  deleteMyLocationData,
  fetchMyActivities,
  fetchMyPrivacyZones,
  fetchMyRoutePointsBulk,
  fetchMyProfile,
  syncPrivacyZones,
  updateMyProfile,
  uploadAvatar,
  type RemoteProfile,
} from '../../data/remote/profileApi';
import { saveRemoteNotificationPrefs } from '../../data/remote/socialApi';
import type { ActivityType, AthleteLevel, Visibility } from '../../domain/types';
import { useAccountSync } from '../../state/accountSyncStore';
import { useAuth } from '../../state/authStore';
import { useSettings } from '../../state/settingsStore';
import { bestEffortS } from '../../domain/metrics';
import { validateUsername } from '../../domain/username';

export { normalizeUsername, validateUsername } from '../../domain/username';

export interface ProfilePatch {
  username?: string;
  preferredActivity?: ActivityType;
  level?: AthleteLevel;
  profileVisibility?: Visibility;
  defaultActivityVisibility?: Visibility;
  showInLeaderboards?: boolean;
  homeCity?: string | null;
  homeDistrict?: string | null;
}

function userId(): string | null {
  return useAuth.getState().session?.user.id ?? null;
}

async function pullProfile(uid: string) {
  const remote = await fetchMyProfile(uid).catch(() => null);
  if (remote) applyProfile(remote);
}

function applyProfile(remote: RemoteProfile) {
  useSettings.getState().set({
    username: remote.username,
    avatarUri: remote.avatarUrl,
    preferredActivity: remote.preferredActivity,
    level: remote.level,
    profileVisibility: remote.profileVisibility,
    defaultActivityVisibility: remote.defaultActivityVisibility,
    showInLeaderboards: remote.showInLeaderboards,
    homeCity: remote.homeCity,
    homeDistrict: remote.homeDistrict,
  });
}

/**
 * Installs from before data ownership was tracked: the local data is this
 * account's if every uploaded activity on the device is this account's.
 * Without uploaded activities there is nothing to tell, so it is adopted.
 */
async function inferLegacyOwner(uid: string): Promise<string | null | undefined> {
  const remoteIds = (await activityRepo.listSaved()).map((a) => a.remoteId).filter((id): id is string => !!id);
  if (remoteIds.length === 0) return null;
  try {
    return (await countOwnActivities(uid, remoteIds)) === remoteIds.length ? uid : 'another-account';
  } catch {
    // Cannot check (offline): decide later; uploads stay paused until then.
    return undefined;
  }
}

/**
 * Downloads the account's activities that are not on this device yet (new
 * phone, reinstall, after another account used it). Summaries are written
 * first so history and weekly totals appear at once; routes follow in bulk
 * (one request per 100 activities, multi-row inserts). Failures leave what is there.
 */
async function restoreFromServer(sync: ReturnType<typeof useAccountSync.getState>) {
  const [known, remote] = await Promise.all([activityRepo.knownIds(), fetchMyActivities()]);
  const missing = remote.filter((a) => !known.has(a.id) && !known.has(a.clientId));
  if (missing.length === 0) return;
  if (!sync.busy) sync.start('Aktivitelerin indiriliyor');
  await activityRepo.insertRestored(
    missing.map((a) => ({
      id: a.clientId,
      remoteId: a.id,
      type: a.type,
      title: a.title,
      visibility: a.visibility,
      routeShare: a.routeShare,
      source: a.source,
      externalId: a.externalId,
      sourceDevice: a.sourceDevice,
      startedAt: a.startedAt,
      endedAt: a.endedAt,
      movingTimeS: a.movingTimeS,
      distanceM: a.distanceM,
      claim: {
        status: a.status,
        reasons: a.reasons,
        distanceM: a.distanceM,
        claimedCells: a.claimedCells,
        netGainCells: a.netGainCells,
        capturedCells: a.capturedCells,
        capturedFromUsers: 0,
      },
    })),
  );
  useAccountSync.getState().bumpData();

  const withRoutes = missing.filter((a) => a.status === 'accepted' || a.distanceM > 0);
  for (let i = 0; i < withRoutes.length; i += 100) {
    const batch = withRoutes.slice(i, i + 100);
    useAccountSync.getState().update(`Rotalar indiriliyor (${Math.min(i + batch.length, withRoutes.length)}/${withRoutes.length})`);
    const routes = await fetchMyRoutePointsBulk(batch.map((a) => a.id));
    await activityRepo.insertRestoredPoints(
      batch.map((a) => {
        const points = routes.get(a.id) ?? [];
        return { id: a.clientId, points, best5kS: bestEffortS(points, 5000), best10kS: bestEffortS(points, 10000) };
      }),
    );
  }
  useAccountSync.getState().bumpData();
}

/** Removes the previous account's data from this device; device preferences (units, theme…) stay. */
async function clearAccountData() {
  await activityRepo.deleteEverything();
  useSettings.getState().set({
    username: '',
    avatarUri: null,
    weeklyGoalKm: null,
    homeCity: null,
    homeDistrict: null,
    liveShareEnabled: false,
    liveShareContactIds: [],
  });
}

export const profileActions = {
  /** Saves locally and, when signed in, on the server (server errors are thrown). */
  async save(patch: ProfilePatch) {
    const uid = userId();
    if (uid) await updateMyProfile(uid, patch);
    useSettings.getState().set(patch);
  },

  /** Lets the user pick a square photo; returns false when cancelled. */
  async pickAvatar(): Promise<boolean> {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (result.canceled || !result.assets[0]) return false;
    const asset = result.assets[0];
    const uid = userId();
    let uri = asset.uri;
    if (uid) {
      uri = await uploadAvatar(uid, asset.uri, asset.mimeType ?? 'image/jpeg');
      await updateMyProfile(uid, { avatarUrl: uri });
    }
    useSettings.getState().set({ avatarUri: uri });
    return true;
  },

  /**
   * After sign-in (or app start with a session). On-device data belongs to one
   * account at a time (settings.dataOwnerId):
   *  - never tied to an account (local-only use) → adopted by this account;
   *  - same account → profile refreshed from the server;
   *  - another account → that account's local data is removed first, so it is
   *    never shown under, or uploaded to, the account that just signed in.
   * Uploads (syncService) wait until this has set the owner.
   */
  async reconcileAfterSignIn() {
    const uid = userId();
    if (!uid) return;
    const sync = useAccountSync.getState();
    const settings = useSettings.getState();
    const switching = settings.dataOwnerId !== uid;
    if (switching) sync.start('Hesabın yükleniyor');
    try {
      let owner = settings.dataOwnerId;
      if (owner === 'legacy') {
        const inferred = await inferLegacyOwner(uid);
        if (inferred === undefined) return;
        owner = inferred;
      }
      if (owner === uid && settings.dataOwnerId === uid) {
        await Promise.all([pullProfile(uid), restoreFromServer(sync).catch(() => undefined)]);
        return;
      }
      const adopting = owner === null;
      if (!adopting && owner !== uid) await clearAccountData();
      useSettings.getState().set({ dataOwnerId: uid });
      useAccountSync.getState().bumpData();

      // Independent steps run in parallel; activities usually take longest.
      const local = useSettings.getState();
      const localZones = await privacyZoneRepo.list();
      await Promise.all([
        (async () => {
          const remote = await fetchMyProfile(uid).catch(() => null);
          // Server generated a placeholder username on sign-up: replace it with the local choice.
          if (adopting && remote?.username.startsWith('runner_') && local.username && !validateUsername(local.username)) {
            await updateMyProfile(uid, {
              username: local.username,
              preferredActivity: local.preferredActivity,
              level: local.level,
              profileVisibility: local.profileVisibility,
              defaultActivityVisibility: local.defaultActivityVisibility,
              showInLeaderboards: local.showInLeaderboards,
              // e.g. the name is taken by another account: show the server profile instead.
            }).catch(() => pullProfile(uid));
          } else if (remote) {
            applyProfile(remote);
          }
        })(),
        adopting && localZones.length > 0
          ? // Zones entered before signing in become this account's.
            syncPrivacyZones(localZones).catch(() => undefined)
          : fetchMyPrivacyZones()
              .then((zones) => privacyZoneRepo.replaceAll(zones))
              .catch(() => undefined),
        // Push token is managed by services/push; leave it untouched here.
        saveRemoteNotificationPrefs(uid, local.notificationPrefs).catch(() => undefined),
        restoreFromServer(useAccountSync.getState()).catch(() => undefined),
      ]);
    } finally {
      useAccountSync.getState().finish();
    }
  },

  /**
   * Signs out. Push notifications for this account stop on this device. If
   * everything reached the server, the account's data is removed from the
   * device (it is restored at the next sign-in), so someone using the phone
   * without an account does not see it. Unsynced activities are kept so they
   * can still be uploaded when the same account signs in again.
   */
  async signOut() {
    const uid = userId();
    if (uid) await saveRemoteNotificationPrefs(uid, useSettings.getState().notificationPrefs, null).catch(() => undefined);
    const pending = await this.pendingUploadCount();
    await useAuth.getState().signOut();
    if (pending === 0) {
      await clearAccountData();
      useSettings.getState().set({ dataOwnerId: null });
    }
  },

  /** Unsynced activities that would be lost if another account signs in on this device. */
  async pendingUploadCount(): Promise<number> {
    return (await activityRepo.listPendingUpload()).length;
  },

  /** Deletes raw GPS routes and territory on the server and on this device. Stats remain. */
  async deleteLocationData() {
    if (userId()) await deleteMyLocationData();
    await activityRepo.deleteAllRoutePoints();
  },

  async deleteAccount() {
    if (userId()) await deleteMyAccount();
    await activityRepo.deleteEverything();
    await useAuth.getState().signOut();
    useSettings.getState().reset();
  },
};
