import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { activityRepo } from '../../data/local/activityRepo';
import { speedMps } from '../../domain/metrics';
import { estimateClaim, type ClaimEstimate } from '../../domain/territory';
import type { Activity, RoutePoint } from '../../domain/types';

export interface ActivityWithRoute {
  activity: Activity;
  points: RoutePoint[];
  estimate: ClaimEstimate;
  avgSpeedMps: number | null;
  /** False while the activity waits on the summary screen for save/discard. */
  saved: boolean;
  /** Personal records this activity set compared with earlier saved activities. */
  records: PersonalRecord[];
}

export interface PersonalRecord {
  label: string;
  timeS: number;
  /** Seconds faster than the previous best, null if this is the first. */
  improvementS: number | null;
}

function findRecords(activity: Activity, others: Activity[]): PersonalRecord[] {
  const out: PersonalRecord[] = [];
  const check = (label: string, pick: (a: Activity) => number | null) => {
    const mine = pick(activity);
    if (mine == null) return;
    const previous = others
      .filter((o) => o.id !== activity.id && o.startedAt < activity.startedAt)
      .map(pick)
      .filter((v): v is number => v != null);
    const best = previous.length ? Math.min(...previous) : null;
    if (best == null || mine < best) out.push({ label, timeS: mine, improvementS: best == null ? null : best - mine });
  };
  check('en hızlı 5 km', (a) => a.best5kS);
  check('en hızlı 10 km', (a) => a.best10kS);
  return out;
}

/** Loads an activity with its route; reloads whenever the screen regains focus. */
export function useActivity(id: string | undefined) {
  const [data, setData] = useState<ActivityWithRoute | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      const activity = await activityRepo.get(id);
      if (!activity) {
        setData(null);
        setError('Aktivite bulunamadı.');
        return;
      }
      const [points, status, others] = await Promise.all([
        activityRepo.getPoints(id),
        activityRepo.getStatus(id),
        activityRepo.listSaved(),
      ]);
      setData({
        activity,
        points,
        estimate: estimateClaim(points),
        avgSpeedMps: speedMps(activity.distanceM, activity.movingTimeS),
        saved: status === 'saved',
        records: findRecords(activity, others),
      });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return { data, loading, error, reload: load };
}

export function useActivityHistory() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setActivities(await activityRepo.listSaved());
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return { activities, loading, reload: load };
}

export interface LocalStats {
  count: number;
  distanceM: number;
  timeS: number;
  claimedCells: number;
  longestM: number;
  best5kS: number | null;
  best10kS: number | null;
  firstAt: number | null;
}

export function computeLocalStats(activities: Activity[]): LocalStats {
  const min = (vals: (number | null)[]) => {
    const v = vals.filter((x): x is number => x != null);
    return v.length ? Math.min(...v) : null;
  };
  return {
    count: activities.length,
    distanceM: activities.reduce((s, a) => s + a.distanceM, 0),
    timeS: activities.reduce((s, a) => s + a.movingTimeS, 0),
    claimedCells: activities.reduce((s, a) => s + (a.claim?.netGainCells ?? 0), 0),
    longestM: activities.reduce((m, a) => Math.max(m, a.distanceM), 0),
    best5kS: min(activities.map((a) => a.best5kS)),
    best10kS: min(activities.map((a) => a.best10kS)),
    firstAt: activities.length ? Math.min(...activities.map((a) => a.startedAt)) : null,
  };
}
