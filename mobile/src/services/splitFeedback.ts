import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import { durationLabel, formatPaceOrSpeed } from '../domain/format';
import type { ActivityType, UnitSystem } from '../domain/types';

/**
 * Announces each completed kilometre (or mile) so runners don't need to look
 * at the screen. Runs in the JS context; while the app is backgrounded iOS may
 * not play speech, so this is a convenience, not a guarantee.
 */
export function splitUnitM(units: UnitSystem) {
  return units === 'imperial' ? 1609.344 : 1000;
}

export async function announceSplit(opts: {
  index: number;
  movingS: number;
  splitSpeedMps: number | null;
  type: ActivityType;
  units: UnitSystem;
  voice: boolean;
  haptic: boolean;
}) {
  if (opts.haptic) {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  }
  if (opts.voice) {
    const unit = opts.units === 'imperial' ? 'mil' : 'kilometre';
    const pace = formatPaceOrSpeed(opts.splitSpeedMps, opts.type, opts.units);
    const paceText =
      pace.value === '–'
        ? ''
        : opts.type === 'ride'
          ? ` Son ${unit} hızın saatte ${pace.value.replace('.', ',')}.`
          : ` Son ${unit} tempon ${pace.value.replace(':', ' dakika ')} saniye.`;
    Speech.speak(`${opts.index} ${unit}. Süre ${durationLabel(opts.movingS)}.${paceText}`, { language: 'tr-TR' });
  }
}
