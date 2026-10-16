import * as Location from 'expo-location';
import type { LatLng } from '../domain/geo';
import type { RoutePoint } from '../domain/types';

export interface Area {
  /** Province, e.g. "İstanbul". */
  city: string;
  /** District (ilçe), e.g. "Kadıköy". */
  district: string;
}

const cache = new Map<string, Area | null>();

/**
 * City and district of a place via the platform's reverse geocoder (Apple /
 * Google on the device; no extra service). Results are cached per ~100 m.
 * Returns null when the geocoder has no district (abroad, offline…).
 */
export async function areaAt(p: LatLng): Promise<Area | null> {
  const key = `${p.latitude.toFixed(3)},${p.longitude.toFixed(3)}`;
  if (cache.has(key)) return cache.get(key) ?? null;
  let area: Area | null = null;
  try {
    const [place] = await Location.reverseGeocodeAsync(p);
    // Turkey: region = il (province), subregion = ilçe (district). Some
    // devices put the district in `city` (locality) instead.
    const city = place?.region ?? place?.city ?? null;
    const district = place?.subregion ?? (place?.city && place.city !== city ? place.city : null);
    if (city && district) area = { city: city.trim(), district: district.trim() };
  } catch {
    area = null;
  }
  cache.set(key, area);
  return area;
}

/** Area at the middle of a route (by distance-agnostic midpoint of its fixes). */
export function areaForRoute(points: RoutePoint[]): Promise<Area | null> {
  if (points.length === 0) return Promise.resolve(null);
  let lat = 0;
  let lng = 0;
  for (const p of points) {
    lat += p.latitude;
    lng += p.longitude;
  }
  return areaAt({ latitude: lat / points.length, longitude: lng / points.length });
}
