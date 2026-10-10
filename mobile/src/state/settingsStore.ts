import { kv as Storage } from '../data/local/kv';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type {
  ActivityType,
  AthleteLevel,
  NotificationPrefs,
  UnitSystem,
  Visibility,
} from '../domain/types';

export type ThemePreference = 'system' | 'light' | 'dark';

interface SettingsState {
  onboardingDone: boolean;
  /** User chose to continue without an account (data stays on device). */
  localOnly: boolean;
  username: string;
  avatarUri: string | null;
  preferredActivity: ActivityType;
  level: AthleteLevel;
  units: UnitSystem;
  theme: ThemePreference;
  profileVisibility: Visibility;
  defaultActivityVisibility: Visibility;
  showInLeaderboards: boolean;
  /** null = use the level default (see goals.defaultWeeklyGoalKm). */
  weeklyGoalKm: number | null;
  /** Spoken split every km during recording. */
  voiceFeedback: boolean;
  /** Vibration every km during recording. */
  hapticFeedback: boolean;
  /** Partner (sponsored) content. Off unless the user opts in. */
  partnerContent: boolean;
  /** User granted health platform access (Apple Health / Health Connect) from Runner. */
  healthConnected: boolean;
  /** Write saved Runner activities to the health platform. */
  healthExport: boolean;
  notificationPrefs: NotificationPrefs;
  set: (patch: Partial<Omit<SettingsState, 'set' | 'reset'>>) => void;
  reset: () => void;
}

const defaults = {
  onboardingDone: false,
  localOnly: false,
  username: '',
  avatarUri: null,
  preferredActivity: 'walk' as ActivityType,
  level: 'beginner' as AthleteLevel,
  units: 'metric' as UnitSystem,
  theme: 'system' as ThemePreference,
  // Private by default: the user opts in to sharing.
  profileVisibility: 'followers' as Visibility,
  defaultActivityVisibility: 'followers' as Visibility,
  showInLeaderboards: true,
  weeklyGoalKm: null as number | null,
  voiceFeedback: false,
  hapticFeedback: true,
  partnerContent: false,
  healthConnected: false,
  healthExport: false,
  notificationPrefs: {
    enabled: true,
    movementReminders: true,
    weeklySummary: true,
    activityCompleted: true,
    territoryChanges: true,
    followRequests: true,
    clubInvites: true,
  },
};

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaults,
      set: (patch) => set(patch),
      reset: () => set(defaults),
    }),
    {
      name: 'runner.settings',
      version: 3,
      storage: createJSONStorage(() => Storage),
      // v1 → v2: new preferences get their defaults. v2 → v3: Apple Health flags became platform-neutral.
      migrate: (persisted) => {
        const { appleHealthConnected, appleHealthExport, ...rest } = (persisted ?? {}) as {
          appleHealthConnected?: boolean;
          appleHealthExport?: boolean;
          notificationPrefs?: object;
        };
        return {
          ...defaults,
          ...(appleHealthConnected != null ? { healthConnected: appleHealthConnected } : {}),
          ...(appleHealthExport != null ? { healthExport: appleHealthExport } : {}),
          ...rest,
          notificationPrefs: { ...defaults.notificationPrefs, ...(rest.notificationPrefs ?? {}) },
        };
      },
      partialize: ({ set: _s, reset: _r, ...rest }) => rest,
    },
  ),
);
