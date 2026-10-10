import * as Notifications from 'expo-notifications';
import { formatCells } from '../domain/format';
import type { ClaimResult, NotificationPrefs } from '../domain/types';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function getNotificationPermission(): Promise<'granted' | 'denied' | 'undetermined'> {
  const { status } = await Notifications.getPermissionsAsync();
  return status;
}

export async function requestNotificationPermission(): Promise<'granted' | 'denied' | 'undetermined'> {
  const { status } = await Notifications.requestPermissionsAsync();
  return status;
}

/**
 * Local notification after the server processed an uploaded activity.
 * Follow requests / club invites / lost territory arrive in the in-app inbox;
 * delivering them as push requires a server-side sender (see README).
 */
export async function notifyActivityProcessed(
  claim: ClaimResult,
  prefs: NotificationPrefs,
): Promise<void> {
  if (!prefs.enabled) return;
  if ((await getNotificationPermission()) !== 'granted') return;
  let content: Notifications.NotificationContentInput | null = null;
  if (claim.status === 'accepted' && claim.netGainCells > 0 && prefs.territoryChanges) {
    content = {
      title: 'Hücre kazandın',
      body:
        claim.capturedCells > 0
          ? `+${formatCells(claim.netGainCells)}; ${formatCells(claim.capturedCells)} başka oyunculardan ele geçirildi.`
          : `+${formatCells(claim.netGainCells)} artık senin.`,
    };
  } else if (prefs.activityCompleted) {
    content = {
      title: claim.status === 'accepted' ? 'Aktivite işlendi' : 'Aktivite doğrulanamadı',
      body:
        claim.status === 'accepted'
          ? 'Aktiviten kaydedildi.'
          : 'Ayrıntılar için aktivite detayına bak.',
    };
  }
  if (content) await Notifications.scheduleNotificationAsync({ content, trigger: null });
}
