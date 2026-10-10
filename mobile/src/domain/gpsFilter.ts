import { haversineM } from './geo';
import { RULES, jumpSpeedLimit } from './rules';
import type { ActivityType, RoutePoint } from './types';

export type RawFix = Omit<RoutePoint, 'seq' | 'segment'>;

export type FilterDecision =
  | { accept: true }
  | { accept: false; reason: 'low_accuracy' | 'jitter' | 'jump' | 'stale' };

/**
 * Decides whether a raw GPS fix should be appended to the route. The server
 * re-validates everything; this keeps obviously bad data out of the live view
 * and out of local storage.
 */
export function evaluateFix(
  fix: RawFix,
  last: RoutePoint | null,
  type: ActivityType,
): FilterDecision {
  if (!Number.isFinite(fix.accuracy) || fix.accuracy > RULES.maxAccuracyM) {
    return { accept: false, reason: 'low_accuracy' };
  }
  if (!last) return { accept: true };

  const dt = fix.timestamp - last.timestamp;
  if (dt <= 0) return { accept: false, reason: 'stale' };

  const d = haversineM(last, fix);
  if (d / (dt / 1000) > jumpSpeedLimit(type)) {
    return { accept: false, reason: 'jump' };
  }
  if (d < RULES.minPointSpacingM && dt < RULES.minPointIntervalMs) {
    return { accept: false, reason: 'jitter' };
  }
  return { accept: true };
}

export type SignalQuality = 'good' | 'fair' | 'weak' | 'none';

export function signalQuality(
  lastAccuracy: number | null,
  lastFixAt: number | null,
  now: number,
): SignalQuality {
  if (lastAccuracy == null || lastFixAt == null) return 'none';
  if (now - lastFixAt > RULES.signalLostAfterMs) return 'none';
  if (lastAccuracy <= 10) return 'good';
  if (lastAccuracy <= 20) return 'fair';
  return 'weak';
}
