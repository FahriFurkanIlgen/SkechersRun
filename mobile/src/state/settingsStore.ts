import Storage from 'expo-sqlite/kv-store';
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
  /** User granted Apple Health access from Runner. */
  appleHealthConnected: boolean;
  /** Write saved Runner activities to Apple Health. */
  appleHealthExport: boolean;
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
  appleHealthConnected: false,
  appleHealthExport: false,
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
      version: 2,
      storage: createJSONStorage(() => Storage),
      // v1 → v2: new preferences get their defaults.
      migrate: (persisted) => ({ ...defaults, ...(persisted as object), notificationPrefs: { ...defaults.notificationPrefs, ...((persisted as { notificationPrefs?: object })?.notificationPrefs ?? {}) } }),
      partialize: ({ set: _s, reset: _r, ...rest }) => rest,
    },
  ),
);
