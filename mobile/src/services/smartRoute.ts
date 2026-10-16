import { RunnerDirections } from '../../modules/runner-directions';
import type { LatLng } from '../domain/geo';
import { loopDistanceM, loopWaypoints, pickDistinct, scoreContext, scoreLoop, suggestRoutes, type RouteSuggestion } from '../domain/routeSuggest';
import type { ActivityType, Landmark, TerritoryCell } from '../domain/types';

/** Geometric candidates tried on streets; each costs a few Apple Maps requests. */
const CANDIDATES = 6;
/** A street loop this much longer/shorter than planned no longer fits the chosen duration. */
const MAX_STRETCH = 1.6;
const MIN_STRETCH = 0.5;

export const streetRoutesAvailable = RunnerDirections != null;

/**
 * Smart-route options. With Apple Maps directions (iOS) the geometric loops are
 * routed along walkable streets and scored again — loops that would cross
 * water or need long detours drop out. Elsewhere the geometric loops are
 * returned as direction hints (snapped = false).
 */
export async function smartRoutes(input: {
  start: LatLng;
  minutes: number;
  type: ActivityType;
  territories: TerritoryCell[];
  landmarks: Landmark[];
}): Promise<RouteSuggestion[]> {
  const geometric = suggestRoutes({ ...input, count: CANDIDATES });
  if (!RunnerDirections || geometric.length === 0) return geometric.slice(0, 3);

  const target = loopDistanceM(input.type, input.minutes);
  const ctx = scoreContext(input.territories, input.landmarks);
  const mode = input.type === 'ride' ? 'cycling' : 'walking';
  const snapped = await Promise.all(
    geometric.map(async (g): Promise<RouteSuggestion | null> => {
      const res = await RunnerDirections!
        .route(loopWaypoints(g.points).map((p) => [p.latitude, p.longitude] as [number, number]), mode)
        .catch(() => null);
      if (!res || res.points.length < 4) return null;
      if (res.distanceM > target * MAX_STRETCH || res.distanceM < target * MIN_STRETCH) return null;
      const points = res.points.map(([latitude, longitude]) => ({ latitude, longitude }));
      const scored = scoreLoop(points, ctx);
      if (!scored) return null;
      return { ...g, ...scored, points, distanceM: res.distanceM, snapped: true };
    }),
  );
  const onStreets = pickDistinct(
    snapped.filter((s): s is RouteSuggestion => s != null),
    3,
  );
  // No street loop fits (e.g. directions unavailable offline): fall back to hints.
  return onStreets.length > 0 ? onStreets : geometric.slice(0, 3);
}
