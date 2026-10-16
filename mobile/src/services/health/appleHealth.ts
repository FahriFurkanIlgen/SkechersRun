import {
  isHealthDataAvailable,
  queryWorkoutSamples,
  requestAuthorization,
  saveWorkoutSample,
  WorkoutActivityType,
  WorkoutRouteTypeIdentifier,
  WorkoutTypeIdentifier,
  type WorkoutProxyTyped,
} from '@kingstinct/react-native-healthkit';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import { activityRepo } from '../../data/local/activityRepo';
import { bestEffortS, routeDistanceM } from '../../domain/metrics';
import { routeFromExternalLocations } from '../../domain/importRoute';
import { RULES } from '../../domain/rules';
import { estimateClaim } from '../../domain/territory';
import type { Activity, ActivityType, RoutePoint, Visibility } from '../../domain/types';
import { NoRouteError, type HealthWorkout } from './types';

/**
 * Apple Health (HealthKit) integration:
 *  - import walking/running/cycling workouts recorded elsewhere — notably the
 *    Apple Watch Workout app — together with their GPS route;
 *  - optionally write Runner activities back to Apple Health.
 * Health data is never sent anywhere except as a Runner activity the user
 * chooses to import (and then only the route + stats, like a phone recording).
 */

const OWN_BUNDLE_HINT = 'runner';

/**
 * Workouts the phone app itself wrote to Health (export) carry its activity id
 * as HKExternalUUID; those are already Runner activities. Workouts recorded by
 * the Runner watch app have no such key and are imported like any other.
 */
function writtenByPhoneApp(w: WorkoutProxyTyped): boolean {
  return w.sourceRevision.source.bundleIdentifier.toLowerCase().includes(OWN_BUNDLE_HINT) && w.metadata?.HKExternalUUID != null;
}
const IMPORT_WINDOW_DAYS = 7; // the server rejects older activities

const TYPE_FROM_HK: Partial<Record<WorkoutActivityType, ActivityType>> = {
  [WorkoutActivityType.walking]: 'walk',
  [WorkoutActivityType.hiking]: 'walk',
  [WorkoutActivityType.running]: 'run',
  [WorkoutActivityType.cycling]: 'ride',
  [WorkoutActivityType.wheelchairWalkPace]: 'wheelchair',
  [WorkoutActivityType.wheelchairRunPace]: 'wheelchair',
};

const HK_FROM_TYPE: Record<ActivityType, WorkoutActivityType> = {
  walk: WorkoutActivityType.walking,
  run: WorkoutActivityType.running,
  ride: WorkoutActivityType.cycling,
  wheelchair: WorkoutActivityType.wheelchairWalkPace,
};

export function appleHealthSupported(): boolean {
  if (Platform.OS !== 'ios') return false;
  try {
    return isHealthDataAvailable();
  } catch {
    return false;
  }
}

/** Shows the system Health permission sheet (each type can be allowed separately). */
export async function connectAppleHealth(): Promise<boolean> {
  return requestAuthorization({
    toRead: [
      WorkoutTypeIdentifier,
      WorkoutRouteTypeIdentifier,
      'HKQuantityTypeIdentifierDistanceWalkingRunning',
      'HKQuantityTypeIdentifierDistanceCycling',
    ],
    toShare: [
      WorkoutTypeIdentifier,
      WorkoutRouteTypeIdentifier,
      'HKQuantityTypeIdentifierDistanceWalkingRunning',
      'HKQuantityTypeIdentifierDistanceCycling',
    ],
  });
}

function toMeters(q?: { unit: string; quantity: number }): number | null {
  if (!q) return null;
  if (q.unit === 'm') return q.quantity;
  if (q.unit === 'km') return q.quantity * 1000;
  if (q.unit === 'mi') return q.quantity * 1609.344;
  if (q.unit === 'yd') return q.quantity * 0.9144;
  if (q.unit === 'ft') return q.quantity * 0.3048;
  return null;
}

function toSeconds(q?: { unit: string; quantity: number }): number {
  if (!q) return 0;
  if (q.unit === 'min') return q.quantity * 60;
  if (q.unit === 'hr') return q.quantity * 3600;
  return q.quantity;
}

function deviceLabel(w: WorkoutProxyTyped): string | null {
  const name = w.device?.name ?? null;
  if (name) return name;
  return w.sourceRevision.productType?.startsWith('Watch') ? 'Apple Watch' : null;
}

/** Walking/running/cycling workouts from the last week (except the phone app's own exports). */
export async function listHealthWorkouts(): Promise<HealthWorkout[]> {
  const since = new Date(Date.now() - IMPORT_WINDOW_DAYS * 86_400_000);
  const workouts = await queryWorkoutSamples({
    limit: 50,
    ascending: false,
    filter: {
      date: { startDate: since },
      OR: Object.keys(TYPE_FROM_HK).map((t) => ({ workoutActivityType: Number(t) as WorkoutActivityType })),
    },
  });
  const imported = await activityRepo.externalIds('apple_health', 'runner_watch');
  return workouts
    .filter((w) => !writtenByPhoneApp(w))
    .map((w) => ({
      uuid: w.uuid,
      type: TYPE_FROM_HK[w.workoutActivityType] ?? 'walk',
      startedAt: w.startDate.getTime(),
      endedAt: w.endDate.getTime(),
      durationS: toSeconds(w.duration),
      distanceM: toMeters(w.totalDistance),
      sourceName: w.sourceRevision.source.name,
      deviceName: deviceLabel(w),
      alreadyImported: imported.has(w.uuid),
    }));
}

/**
 * Imports one workout as a local activity in "finished" state, so it goes
 * through the normal summary → save → upload flow. Returns the activity id.
 */
export async function importHealthWorkout(uuid: string): Promise<string> {
  const [workout] = await queryWorkoutSamples({ limit: 1, filter: { uuid } });
  if (!workout) throw new Error('Antrenman bulunamadı.');
  const type = TYPE_FROM_HK[workout.workoutActivityType] ?? 'walk';
  const routes = await workout.getWorkoutRoutes();
  const points = routeFromExternalLocations(
    routes.flatMap((route, segment) =>
      route.locations.map((l) => ({
        latitude: l.latitude,
        longitude: l.longitude,
        horizontalAccuracy: l.horizontalAccuracy,
        timestamp: l.date.getTime(),
        speed: l.speed,
        altitude: l.altitude,
        segment,
      })),
    ),
    type,
  );
  if (points.length < 2) throw new NoRouteError();

  const id = Crypto.randomUUID();
  const startedAt = workout.startDate.getTime();
  // Recorded by the Runner watch app (WorkoutManager.swift sets this key).
  const fromRunnerWatch = workout.metadata?.RunnerRecordedOnWatch != null;
  await activityRepo.createImported({
    id,
    type,
    source: fromRunnerWatch ? 'runner_watch' : 'apple_health',
    externalId: workout.uuid,
    sourceDevice: fromRunnerWatch ? 'Apple Watch' : deviceLabel(workout),
    startedAt,
  });
  await activityRepo.appendPoints(id, points);
  await activityRepo.finish(id, {
    endedAt: workout.endDate.getTime(),
    movingTimeS: toSeconds(workout.duration) || (workout.endDate.getTime() - startedAt) / 1000,
    distanceM: routeDistanceM(points),
    estimatedCells: estimateClaim(points).cells,
    best5kS: bestEffortS(points, 5000),
    best10kS: bestEffortS(points, 10000),
    visibility: 'followers' satisfies Visibility,
  });
  return id;
}

/** Writes a Runner activity (with route) to Apple Health. */
export async function exportToAppleHealth(activity: Activity, points: RoutePoint[]): Promise<void> {
  if (activity.source !== 'phone' || points.length < 2) return;
  const workout = await saveWorkoutSample(
    HK_FROM_TYPE[activity.type],
    [],
    new Date(activity.startedAt),
    new Date(activity.endedAt),
    { distance: activity.distanceM },
    { HKExternalUUID: activity.id },
  );
  await workout.saveWorkoutRoute(
    points
      .filter((p) => p.accuracy <= RULES.maxAccuracyM)
      .map((p) => ({
        latitude: p.latitude,
        longitude: p.longitude,
        altitude: p.altitude ?? 0,
        course: -1,
        date: new Date(p.timestamp),
        horizontalAccuracy: p.accuracy,
        verticalAccuracy: -1,
        speed: p.speed ?? -1,
      })),
  );
}
