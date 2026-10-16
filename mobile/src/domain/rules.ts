import type { ActivityType } from './types';

/**
 * Game and data-quality rules. The backend (`supabase/migrations/*_territory.sql`)
 * enforces the same values and is the source of truth; the client uses them for
 * live feedback and pre-upload estimates only.
 */
export const RULES = {
  /** Fixes with a worse horizontal accuracy are dropped. */
  maxAccuracyM: 30,
  /** An activity must cover at least this distance to claim territory. */
  minClaimDistanceM: 400,
  /** If the route ends within this distance of its start it counts as a loop. */
  loopCloseDistanceM: 75,
  /** A route claims a hexagon cell once it runs at least this far inside it. */
  minCellPathM: 30,
  /** Upper bound for the cells a single activity can claim. */
  maxClaimCells: 300,
  /** Points closer than this to the previous accepted one are treated as jitter. */
  minPointSpacingM: 3,
  /** Unless this much time passed (keeps time-series alive while standing still). */
  minPointIntervalMs: 15_000,
  /** No accepted fix for this long => signal considered lost. */
  signalLostAfterMs: 20_000,
  /** Public routes never show the first/last stretch of an activity. */
  publicRouteTrimM: 300,
} as const;

/** Sustained speeds above these are physically implausible for the activity type. */
export const MAX_SPEED_MPS: Record<ActivityType, number> = {
  walk: 3.5, // 12.6 km/h
  run: 8, // 28.8 km/h
  ride: 22, // 79 km/h
  wheelchair: 6, // 21.6 km/h (racing chairs on the flat)
};

/** A single jump between consecutive fixes faster than this is a GPS glitch. */
export function jumpSpeedLimit(type: ActivityType): number {
  return MAX_SPEED_MPS[type] * 1.5;
}
