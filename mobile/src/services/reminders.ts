import * as Notifications from 'expo-notifications';
import type { NotificationPrefs } from '../domain/types';
import { getNotificationPermission } from './notifications';

const REMINDER_ID = 'runner.movement-reminder';
const WEEKLY_ID = 'runner.weekly-summary';

/**
 * Local, on-device reminders (no server involved): one gentle daily nudge and
 * a Sunday-evening prompt to look at the week. Re-run whenever prefs change.
 */
export async function syncLocalReminders(prefs: NotificationPrefs): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(REMINDER_ID).catch(() => undefined);
  await Notifications.cancelScheduledNotificationAsync(WEEKLY_ID).catch(() => undefined);
  if (!prefs.enabled || (await getNotificationPermission()) !== 'granted') return;

  if (prefs.movementReminders) {
    await Notifications.scheduleNotificationAsync({
      identifier: REMINDER_ID,
      content: { title: 'Kısa bir tur?', body: 'Birkaç dakikalık yürüyüş de haftalık hedefine sayılır.' },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: 18, minute: 0 },
    });
  }
  if (prefs.weeklySummary) {
    await Notifications.scheduleNotificationAsync({
      identifier: WEEKLY_ID,
      content: { title: 'Haftan nasıl geçti?', body: 'Mesafeni, alanını ve hedeflerini Görevler’de gör.' },
      // weekday: 1 = Sunday
      trigger: { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: 1, hour: 19, minute: 0 },
    });
  }
}
