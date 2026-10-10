import * as ImagePicker from 'expo-image-picker';
import { activityRepo } from '../../data/local/activityRepo';
import { privacyZoneRepo } from '../../data/local/privacyZoneRepo';
import {
  deleteMyAccount,
  deleteMyLocationData,
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

  /** After sign-in: pull the server profile, or push the locally entered one. */
  async reconcileAfterSignIn() {
    const uid = userId();
    if (!uid) return;
    const remote = await fetchMyProfile(uid);
    const local = useSettings.getState();
    if (!remote) return;
    // Server generated a placeholder username on sign-up: replace it with the local choice.
    if (remote.username.startsWith('runner_') && local.username && !validateUsername(local.username)) {
      await updateMyProfile(uid, {
        username: local.username,
        preferredActivity: local.preferredActivity,
        level: local.level,
        profileVisibility: local.profileVisibility,
        defaultActivityVisibility: local.defaultActivityVisibility,
        showInLeaderboards: local.showInLeaderboards,
      }).catch(() => undefined);
    } else {
      local.set({
        username: remote.username,
        avatarUri: remote.avatarUrl ?? local.avatarUri,
        preferredActivity: remote.preferredActivity,
        level: remote.level,
        profileVisibility: remote.profileVisibility,
        defaultActivityVisibility: remote.defaultActivityVisibility,
        showInLeaderboards: remote.showInLeaderboards,
      });
    }
    await syncPrivacyZones(await privacyZoneRepo.list()).catch(() => undefined);
    await saveRemoteNotificationPrefs(uid, local.notificationPrefs, null).catch(() => undefined);
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
