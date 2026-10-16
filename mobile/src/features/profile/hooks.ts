import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchProfileStats, type ProfileStats } from '../../data/remote/profileApi';
import { fetchMySeason, type MySeason } from '../../data/remote/socialApi';
import { useAccountSync } from '../../state/accountSyncStore';
import { defaultWeeklyGoalKm, defaultWeeklyGoalMinutes, formatGoalMinutes, weekDistanceM, weekMinutes } from '../../domain/goals';
import { formatGoalDistance } from '../../domain/format';
import type { Activity } from '../../domain/types';
import { useAuth } from '../../state/authStore';
import { useSettings } from '../../state/settingsStore';

/** Server-side profile stats (territory etc.); null when signed out / unavailable. */
export function useRemoteStats() {
  const session = useAuth((s) => s.session);
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!session) return;
      let cancelled = false;
      fetchProfileStats(session.user.id)
        .then((s) => {
          if (!cancelled) {
            setStats(s);
            setError(null);
          }
        })
        .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
      return () => {
        cancelled = true;
      };
    }, [session]),
  );

  return { stats: session ? stats : null, error };
}

export interface WeeklyGoal {
  kind: 'distance' | 'minutes';
  /** Meters or minutes, matching `kind`. */
  done: number;
  target: number;
  ratio: number;
  /** "12,4 km" / "1 sa 30 dk" */
  format: (value: number) => string;
  /** How much one activity adds to this goal. */
  amountOf: (a: Activity) => number;
}

export function useWeeklyGoal(activities: Activity[]): WeeklyGoal {
  const goalKm = useSettings((s) => s.weeklyGoalKm);
  const goalMinutes = useSettings((s) => s.weeklyGoalMinutes);
  const kind = useSettings((s) => s.weeklyGoalType);
  const level = useSettings((s) => s.level);
  const units = useSettings((s) => s.units);
  return useMemo(() => {
    if (kind === 'minutes') {
      const target = goalMinutes ?? defaultWeeklyGoalMinutes(level);
      const done = weekMinutes(activities);
      return { kind, done, target, ratio: target > 0 ? done / target : 0, format: formatGoalMinutes, amountOf: (a) => a.movingTimeS / 60 };
    }
    const target = (goalKm ?? defaultWeeklyGoalKm(level)) * 1000;
    const done = weekDistanceM(activities);
    return {
      kind,
      done,
      target,
      ratio: target > 0 ? done / target : 0,
      format: (m: number) => formatGoalDistance(m, units),
      amountOf: (a) => a.distanceM,
    };
  }, [activities, goalKm, goalMinutes, kind, level, units]);
}

/** This month's season (points, weak cells, landmarks); null when signed out. */
export function useMySeason() {
  const session = useAuth((s) => s.session);
  const dataVersion = useAccountSync((s) => s.dataVersion);
  const [season, setSeason] = useState<MySeason | null>(null);
  const load = useCallback(() => {
    if (!session) return;
    void fetchMySeason()
      .then(setSeason)
      .catch(() => undefined);
  }, [session]);
  useFocusEffect(load);
  // New uploads change points.
  useEffect(() => {
    if (dataVersion > 0) load();
  }, [dataVersion, load]);
  return session ? season : null;
}
