import { haversineM, type LatLng } from './geo';
import { RULES } from './rules';

export interface PrivacyZone {
  id: string;
  label: string;
  center: LatLng;
  radiusM: number;
}

/**
 * Removes the first and last `trimM` meters of a route so that shared routes
 * do not point at the place an activity started or ended.
 */
export function trimRouteEnds<T extends LatLng>(points: T[], trimM: number = RULES.publicRouteTrimM): T[] {
  if (points.length < 2) return [];
  let start = 0;
  let acc = 0;
  while (start < points.length - 1 && acc < trimM) {
    acc += haversineM(points[start], points[start + 1]);
    start++;
  }
  let end = points.length - 1;
  acc = 0;
  while (end > start && acc < trimM) {
    acc += haversineM(points[end], points[end - 1]);
    end--;
  }
  return end > start ? points.slice(start, end + 1) : [];
}

/** Drops every point that falls inside any privacy zone. */
export function removePointsInZones<T extends LatLng>(points: T[], zones: PrivacyZone[]): T[] {
  if (zones.length === 0) return points;
  return points.filter((p) => !zones.some((z) => haversineM(p, z.center) <= z.radiusM));
}

export interface ZoneSuggestion {
  center: LatLng;
  /** How many activity start/end points fall into this cluster. */
  hits: number;
}

/**
 * Finds places where activities repeatedly start or end (typically home or
 * work) so the app can suggest a privacy zone. Runs on-device only.
 */
export function suggestPrivacyZones(
  endpoints: LatLng[],
  existing: PrivacyZone[],
  clusterRadiusM = 150,
  minHits = 3,
): ZoneSuggestion[] {
  const remaining = endpoints.filter(
    (p) => !existing.some((z) => haversineM(p, z.center) <= z.radiusM),
  );
  const used = new Set<number>();
  const suggestions: ZoneSuggestion[] = [];
  for (let i = 0; i < remaining.length; i++) {
    if (used.has(i)) continue;
    const members = [i];
    for (let j = i + 1; j < remaining.length; j++) {
      if (!used.has(j) && haversineM(remaining[i], remaining[j]) <= clusterRadiusM) members.push(j);
    }
    if (members.length >= minHits) {
      members.forEach((m) => used.add(m));
      const lat = members.reduce((s, m) => s + remaining[m].latitude, 0) / members.length;
      const lng = members.reduce((s, m) => s + remaining[m].longitude, 0) / members.length;
      suggestions.push({ center: { latitude: lat, longitude: lng }, hits: members.length });
    }
  }
  return suggestions.sort((a, b) => b.hits - a.hits);
}
