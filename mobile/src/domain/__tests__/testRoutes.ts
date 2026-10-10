import type { RoutePoint } from '../types';

const M_PER_DEG_LAT = 111_195;

/** Builds a route by walking through offsets (meters east/north of an origin) at a constant speed. */
export function routeFromOffsets(
  offsets: [number, number][],
  speedMps: number,
  origin = { latitude: 41.0, longitude: 29.0 },
  stepM = 10,
): RoutePoint[] {
  const mPerDegLng = M_PER_DEG_LAT * Math.cos((origin.latitude * Math.PI) / 180);
  const pts: RoutePoint[] = [];
  let t = 1_700_000_000_000;
  const push = (x: number, y: number) =>
    pts.push({
      seq: pts.length,
      segment: 0,
      latitude: origin.latitude + y / M_PER_DEG_LAT,
      longitude: origin.longitude + x / mPerDegLng,
      accuracy: 5,
      altitude: null,
      speed: speedMps,
      timestamp: t,
      mocked: false,
    });
  push(offsets[0][0], offsets[0][1]);
  for (let i = 1; i < offsets.length; i++) {
    const [x0, y0] = offsets[i - 1];
    const [x1, y1] = offsets[i];
    const len = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.round(len / stepM));
    for (let s = 1; s <= steps; s++) {
      t += ((len / steps) / speedMps) * 1000;
      push(x0 + ((x1 - x0) * s) / steps, y0 + ((y1 - y0) * s) / steps);
    }
  }
  return pts;
}

export const square = (side: number): [number, number][] => [
  [0, 0],
  [side, 0],
  [side, side],
  [0, side],
  [0, 0],
];
