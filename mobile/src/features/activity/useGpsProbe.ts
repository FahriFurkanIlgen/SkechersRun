import * as Location from 'expo-location';
import { useEffect, useState } from 'react';

export type ProbeLevel = 0 | 1 | 2 | 3 | 4;

export function accuracyToLevel(accuracy: number | null): ProbeLevel {
  if (accuracy == null) return 0;
  if (accuracy <= 10) return 4;
  if (accuracy <= 20) return 3;
  if (accuracy <= 30) return 2;
  return 1;
}

/**
 * Short-lived high-accuracy watch used before starting an activity to show
 * whether GPS is ready. Stops as soon as the screen unmounts.
 */
export function useGpsProbe(enabled: boolean) {
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, distanceInterval: 0, timeInterval: 1000 },
      (loc) => setAccuracy(loc.coords.accuracy ?? null),
      (reason) => setError(reason),
    )
      .then((s) => {
        if (cancelled) s.remove();
        else sub = s;
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [enabled]);

  return { accuracy, level: accuracyToLevel(accuracy), error };
}
