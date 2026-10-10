import { haversineM } from './geo';
import type { RoutePoint } from './types';

/** Distance in meters, never bridging the gap between pause segments. */
export function routeDistanceM(points: RoutePoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i].segment !== points[i - 1].segment) continue;
    total += haversineM(points[i - 1], points[i]);
  }
  return total;
}

/** Splits a route into its pause-separated segments. */
export function segments(points: RoutePoint[]): RoutePoint[][] {
  const out: RoutePoint[][] = [];
  for (const p of points) {
    const current = out[out.length - 1];
    if (!current || current[0].segment !== p.segment) out.push([p]);
    else current.push(p);
  }
  return out;
}

/** Seconds per kilometer; null when there is not enough distance to be meaningful. */
export function paceSecPerKm(distanceM: number, seconds: number): number | null {
  if (distanceM < 50 || seconds <= 0) return null;
  return seconds / (distanceM / 1000);
}

export function speedMps(distanceM: number, seconds: number): number | null {
  if (seconds <= 0) return null;
  return distanceM / seconds;
}

/**
 * "Current" pace over a trailing window of the active segment. Uses route
 * geometry rather than the device speed field, which is noisy on many phones.
 */
export function currentSpeedMps(points: RoutePoint[], windowMs = 30_000): number | null {
  if (points.length < 2) return null;
  const last = points[points.length - 1];
  let distance = 0;
  let first = last;
  for (let i = points.length - 2; i >= 0; i--) {
    const p = points[i];
    if (p.segment !== last.segment || last.timestamp - p.timestamp > windowMs) break;
    distance += haversineM(p, points[i + 1]);
    first = p;
  }
  const dt = (last.timestamp - first.timestamp) / 1000;
  if (dt < 5) return null;
  return distance / dt;
}

/**
 * Fastest time (seconds) to cover `targetM` within a single pause segment,
 * interpolating inside the step that crosses the target. Null if never covered.
 */
export function bestEffortS(points: RoutePoint[], targetM: number): number | null {
  let best: number | null = null;
  for (const seg of segments(points)) {
    if (seg.length < 2) continue;
    // cumulative distance along the segment
    const cum = [0];
    for (let i = 1; i < seg.length; i++) cum.push(cum[i - 1] + haversineM(seg[i - 1], seg[i]));
    let start = 0;
    for (let end = 1; end < seg.length; end++) {
      while (start < end && cum[end] - cum[start + 1] >= targetM) start++;
      const covered = cum[end] - cum[start];
      if (covered < targetM) continue;
      // Interpolate the exact moment the target distance was reached in the last step.
      const stepM = cum[end] - cum[end - 1];
      const overshoot = covered - targetM;
      const stepT = seg[end].timestamp - seg[end - 1].timestamp;
      const t = seg[end].timestamp - (stepM > 0 ? (overshoot / stepM) * stepT : 0) - seg[start].timestamp;
      const s = t / 1000;
      if (best == null || s < best) best = s;
    }
  }
  return best;
}
