import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { activityRepo } from '../../data/local/activityRepo';
import { privacyZoneRepo } from '../../data/local/privacyZoneRepo';
import { useSettings } from '../../state/settingsStore';

/**
 * Exports everything stored on this device (activities, raw GPS points,
 * privacy zones, preferences) as JSON and opens the system share sheet.
 * Server-side data can be requested separately (see README).
 */
export async function exportLocalData(): Promise<void> {
  const activities = await activityRepo.listSaved();
  const withPoints = await Promise.all(
    activities.map(async (a) => ({ ...a, points: await activityRepo.getPoints(a.id) })),
  );
  const { set: _set, reset: _reset, ...preferences } = useSettings.getState();
  const payload = {
    exportedAt: new Date().toISOString(),
    format: 'runner-export/1',
    preferences,
    privacyZones: await privacyZoneRepo.list(),
    activities: withPoints,
  };
  const file = new File(Paths.cache, `runner-verilerim-${new Date().toISOString().slice(0, 10)}.json`);
  file.create({ overwrite: true });
  file.write(JSON.stringify(payload, null, 2));
  if (!(await Sharing.isAvailableAsync())) throw new Error('Bu cihazda paylaşım kullanılamıyor.');
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Runner verilerin' });
}
