import { evaluateFix } from './gpsFilter';
import type { ActivityType, RoutePoint } from './types';

/** A location sample from a health platform workout route. */
export interface ExternalLocation {
  latitude: number;
  longitude: number;
  horizontalAccuracy: number;
  /** Epoch milliseconds. */
  timestamp: number;
  speed: number | null;
  altitude: number | null;
  /** Separate route objects (e.g. a paused workout) become separate segments. */
  segment: number;
}

/**
 * Converts an imported workout route into Runner route points, applying the
 * same GPS filter as live recording so imports and phone recordings are
 * judged identically (the server re-validates both).
 */
export function routeFromExternalLocations(locations: ExternalLocation[], type: ActivityType): RoutePoint[] {
  const sorted = [...locations].sort((a, b) => a.timestamp - b.timestamp || a.segment - b.segment);
  const out: RoutePoint[] = [];
  let last: RoutePoint | null = null;
  for (const l of sorted) {
    const fix = {
      latitude: l.latitude,
      longitude: l.longitude,
      accuracy: l.horizontalAccuracy >= 0 ? l.horizontalAccuracy : Number.POSITIVE_INFINITY,
      altitude: l.altitude,
      speed: l.speed != null && l.speed >= 0 ? l.speed : null,
      timestamp: l.timestamp,
      mocked: false,
    };
    const reference = last && last.segment === l.segment ? last : null;
    if (!evaluateFix(fix, reference, type).accept) continue;
    const point: RoutePoint = { ...fix, seq: out.length, segment: l.segment };
    out.push(point);
    last = point;
  }
  return out;
}
