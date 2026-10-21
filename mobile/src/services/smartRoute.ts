import { RunnerDirections } from '../../modules/runner-directions';
import { haversineM, type LatLng } from '../domain/geo';
import { loopDistanceM, loopMinutes, loopWaypoints, pickDistinct, scoreContext, scoreLoop, suggestRoutes, type RouteSuggestion } from '../domain/routeSuggest';
import type { ActivityType, Landmark, TerritoryCell } from '../domain/types';

/** Geometric candidates tried on streets; each costs four Apple Maps requests, and Apple throttles at about 50 a minute. */
const CANDIDATES = 4;
/** A street loop this much longer/shorter than planned no longer fits the chosen duration. */
const MAX_STRETCH = 1.7;
const MIN_STRETCH = 0.5;
/**
 * Street polylines bend every few dozen meters; a long straight leg is a ferry
 * or bridge-less water crossing that walking directions sometimes include.
 */
const MAX_STRAIGHT_LEG_M = 400;

function hasLongLeg(points: LatLng[]): boolean {
  for (let i = 1; i < points.length; i++) if (haversineM(points[i - 1], points[i]) > MAX_STRAIGHT_LEG_M) return true;
  return false;
}

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
      if (hasLongLeg(points)) return null;
      const scored = scoreLoop(points, ctx);
      if (!scored) return null;
      // Rank loops close to the chosen duration first; the card shows the real time.
      const fit = Math.max(0.2, 1 - Math.abs(res.distanceM / target - 1));
      return {
        ...g,
        ...scored,
        score: scored.score * fit,
        points,
        distanceM: res.distanceM,
        minutes: loopMinutes(input.type, res.distanceM),
        snapped: true,
      };
    }),
  );
  const onStreets = pickDistinct(
    snapped.filter((s): s is RouteSuggestion => s != null),
    3,
  );
  // Never fall back to geometric loops here: where streets are known, a loop
  // that found no street route probably crosses water.
  return onStreets;
}
