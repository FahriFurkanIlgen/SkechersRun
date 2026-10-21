import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { Platform } from 'react-native';
import { saveRemoteNotificationPrefs } from '../data/remote/socialApi';
import type { NotificationKind } from '../domain/types';
import { useAuth } from '../state/authStore';
import { useSettings } from '../state/settingsStore';
import { getNotificationPermission } from './notifications';

/**
 * Push notifications: the device registers an Expo push token with the
 * backend; the `send-push` Edge Function (supabase/functions) delivers a push
 * for each row inserted into `notifications`. Requires an EAS project id
 * (EAS_PROJECT_ID) and the database webhook described in the README.
 */
export function pushConfigured(): boolean {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return !!extra?.eas?.projectId;
}

/** Registers (or clears) this device's push token for the signed-in user. */
export async function syncPushToken(): Promise<'registered' | 'cleared' | 'unavailable'> {
  const session = useAuth.getState().session;
  if (!session || !pushConfigured()) return 'unavailable';
  const { notificationPrefs } = useSettings.getState();
  let token: string | null = null;
  if (notificationPrefs.enabled && (await getNotificationPermission()) === 'granted') {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Battle Run',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    const projectId = (Constants.expoConfig?.extra as { eas: { projectId: string } }).eas.projectId;
    token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  }
  await saveRemoteNotificationPrefs(session.user.id, notificationPrefs, token);
  return token ? 'registered' : 'cleared';
}

const ROUTE_FOR_KIND: Record<NotificationKind, string> = {
  activity_completed: '/(tabs)/profile',
  territory_gained: '/(tabs)',
  territory_lost: '/(tabs)',
  follow_request: '/people',
  new_follower: '/people',
  club_invite: '/inbox',
  live_share: '/inbox',
};

/** Opens the relevant screen when a push (or local notification) is tapped. */
export function handleNotificationTaps(): () => void {
  const open = (response: Notifications.NotificationResponse | null) => {
    const data = response?.notification.request.content.data as
      | { kind?: NotificationKind; activityId?: string; shareId?: string | null }
      | undefined;
    if (!data?.kind) return;
    if (data.kind === 'live_share' && data.shareId) {
      router.push({ pathname: '/live/[id]', params: { id: data.shareId } });
      return;
    }
    // Local notification for a workout recorded on the Apple Watch (services/watch.ts).
    if ((data.kind as string) === 'watch_workout' && data.activityId) {
      router.push({ pathname: '/summary/[id]', params: { id: data.activityId } });
      return;
    }
    if (data.activityId && data.kind === 'activity_completed') {
      router.push({ pathname: '/activity/[id]', params: { id: data.activityId } });
      return;
    }
    router.push(ROUTE_FOR_KIND[data.kind] as never);
  };
  const last = Notifications.getLastNotificationResponse();
  if (last) open(last);
  const sub = Notifications.addNotificationResponseReceivedListener(open);
  return () => sub.remove();
}
