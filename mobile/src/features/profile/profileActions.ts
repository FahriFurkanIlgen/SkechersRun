import * as ImagePicker from 'expo-image-picker';
import { activityRepo } from '../../data/local/activityRepo';
import { privacyZoneRepo } from '../../data/local/privacyZoneRepo';
import {
  countOwnActivities,
  deleteMyAccount,
  deleteMyLocationData,
  fetchMyPrivacyZones,
  fetchMyProfile,
  syncPrivacyZones,
  updateMyProfile,
  uploadAvatar,
} from '../../data/remote/profileApi';
import { saveRemoteNotificationPrefs } from '../../data/remote/socialApi';
import type { ActivityType, AthleteLevel, Visibility } from '../../domain/types';
import { useAuth } from '../../state/authStore';
import { useSettings } from '../../state/settingsStore';
import { validateUsername } from '../../domain/username';

export { normalizeUsername, validateUsername } from '../../domain/username';

export interface ProfilePatch {
  username?: string;
  preferredActivity?: ActivityType;
  level?: AthleteLevel;
  profileVisibility?: Visibility;
  defaultActivityVisibility?: Visibility;
  showInLeaderboards?: boolean;
}

function userId(): string | null {
  return useAuth.getState().session?.user.id ?? null;
}

async function pullProfile(uid: string) {
  const remote = await fetchMyProfile(uid).catch(() => null);
  if (!remote) return;
  useSettings.getState().set({
    username: remote.username,
    avatarUri: remote.avatarUrl,
    preferredActivity: remote.preferredActivity,
    level: remote.level,
    profileVisibility: remote.profileVisibility,
    defaultActivityVisibility: remote.defaultActivityVisibility,
    showInLeaderboards: remote.showInLeaderboards,
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

/** Removes the previous account's data from this device; device preferences (units, theme…) stay. */
async function clearAccountData() {
  await activityRepo.deleteEverything();
  useSettings.getState().set({
    username: '',
    avatarUri: null,
    weeklyGoalKm: null,
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
    const settings = useSettings.getState();
    let owner = settings.dataOwnerId;
    if (owner === 'legacy') {
      const inferred = await inferLegacyOwner(uid);
      if (inferred === undefined) return;
      owner = inferred;
    }
    if (owner === uid && settings.dataOwnerId === uid) {
      await pullProfile(uid);
      return;
    }
    const adopting = owner === null;
    if (!adopting && owner !== uid) await clearAccountData();
    useSettings.getState().set({ dataOwnerId: uid });

    const remote = await fetchMyProfile(uid).catch(() => null);
    const local = useSettings.getState();
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
    } else {
      await pullProfile(uid);
    }
    if (adopting) {
      await syncPrivacyZones(await privacyZoneRepo.list()).catch(() => undefined);
    } else {
      await privacyZoneRepo.replaceAll(await fetchMyPrivacyZones()).catch(() => undefined);
    }
    await saveRemoteNotificationPrefs(uid, local.notificationPrefs, null).catch(() => undefined);
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
