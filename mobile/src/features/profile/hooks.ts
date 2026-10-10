import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { fetchProfileStats, type ProfileStats } from '../../data/remote/profileApi';
import { defaultWeeklyGoalKm, weekDistanceM } from '../../domain/goals';
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

export function useWeeklyGoal(activities: Activity[]) {
  const goalKm = useSettings((s) => s.weeklyGoalKm);
  const level = useSettings((s) => s.level);
  return useMemo(() => {
    const target = (goalKm ?? defaultWeeklyGoalKm(level)) * 1000;
    const done = weekDistanceM(activities);
    return { doneM: done, targetM: target, ratio: target > 0 ? done / target : 0 };
  }, [activities, goalKm, level]);
}
