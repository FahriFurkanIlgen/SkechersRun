import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import {
  ExerciseType,
  getSdkStatus,
  initialize,
  insertRecords,
  openHealthConnectSettings,
  readRecord,
  readRecords,
  requestExerciseRoute,
  requestPermission,
  SdkAvailabilityStatus,
  type ExerciseSessionRecord,
  type RecordResult,
} from 'react-native-health-connect';
import { activityRepo } from '../../data/local/activityRepo';
import { routeFromExternalLocations } from '../../domain/importRoute';
import { bestEffortS, routeDistanceM } from '../../domain/metrics';
import { RULES } from '../../domain/rules';
import { estimateClaim } from '../../domain/territory';
import type { Activity, ActivityType, RoutePoint, Visibility } from '../../domain/types';
import { HealthUnavailableError, NoRouteError, type HealthAvailability, type HealthWorkout } from './types';

/**
 * Health Connect (Android) integration — the counterpart of appleHealth.ts.
 * Wear OS, Samsung Health and Garmin/Polar (via their Android apps) write
 * workouts here. Routes need the user's consent per workout, which Health
 * Connect asks for in its own dialog when a workout is imported.
 */

const IMPORT_WINDOW_DAYS = 7; // the server rejects older activities
const OWN_PACKAGE = Constants.expoConfig?.android?.package ?? '';

const TYPE_FROM_HC: Partial<Record<number, ActivityType>> = {
  [ExerciseType.WALKING]: 'walk',
  [ExerciseType.HIKING]: 'walk',
  [ExerciseType.RUNNING]: 'run',
  [ExerciseType.BIKING]: 'ride',
  [ExerciseType.WHEELCHAIR]: 'wheelchair',
};

const HC_FROM_TYPE: Record<ActivityType, number> = {
  walk: ExerciseType.WALKING,
  run: ExerciseType.RUNNING,
  ride: ExerciseType.BIKING,
  wheelchair: ExerciseType.WHEELCHAIR,
};

let initialized = false;

async function ensureInitialized(): Promise<void> {
  if (initialized) return;
  if (!(await initialize())) throw new HealthUnavailableError();
  initialized = true;
}

export function healthConnectSupported(): boolean {
  return Platform.OS === 'android';
}

export async function healthConnectAvailability(): Promise<HealthAvailability> {
  if (!healthConnectSupported()) return 'unavailable';
  try {
    const status = await getSdkStatus();
    if (status === SdkAvailabilityStatus.SDK_AVAILABLE) return 'available';
    if (status === SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) return 'needs_update';
    return 'unavailable';
  } catch {
    return 'unavailable';
  }
}

/** Shows the Health Connect permission screen. Returns whether workouts can be read. */
export async function connectHealthConnect(): Promise<boolean> {
  await ensureInitialized();
  const granted = await requestPermission([
    { accessType: 'read', recordType: 'ExerciseSession' },
    { accessType: 'read', recordType: 'Distance' },
    { accessType: 'write', recordType: 'ExerciseSession' },
    { accessType: 'write', recordType: 'ExerciseRoute' },
    { accessType: 'write', recordType: 'Distance' },
  ]);
  return granted.some((p) => p.accessType === 'read' && p.recordType === 'ExerciseSession');
}

export { openHealthConnectSettings };

type Session = RecordResult<'ExerciseSession'>;

function deviceLabel(s: Session): string | null {
  const d = s.metadata?.device;
  const name = [d?.manufacturer, d?.model].filter(Boolean).join(' ').trim();
  return name ? name.slice(0, 64) : null;
}

/** Health Connect has no human-readable app name; show the package's last part. */
function originLabel(s: Session): string {
  const origin = s.metadata?.dataOrigin ?? '';
  if (origin.includes('samsung')) return 'Samsung Health';
  if (origin.includes('google.android.apps.fitness')) return 'Fitbit / Google Fit';
  if (origin.includes('garmin')) return 'Garmin Connect';
  if (origin.includes('polar')) return 'Polar Flow';
  return origin.split('.').pop() || 'Health Connect';
}

async function sessionDistanceM(s: Session): Promise<number | null> {
  try {
    const { records } = await readRecords('Distance', {
      timeRangeFilter: { operator: 'between', startTime: s.startTime, endTime: s.endTime },
      dataOriginFilter: s.metadata?.dataOrigin ? [s.metadata.dataOrigin] : undefined,
    });
    if (records.length === 0) return null;
    return records.reduce((sum, r) => sum + r.distance.inMeters, 0);
  } catch {
    return null;
  }
}

/** Walking/running/cycling workouts from the last week that Runner did not write itself. */
export async function listHealthConnectWorkouts(): Promise<HealthWorkout[]> {
  await ensureInitialized();
  const since = new Date(Date.now() - IMPORT_WINDOW_DAYS * 86_400_000);
  const { records } = await readRecords('ExerciseSession', {
    timeRangeFilter: { operator: 'after', startTime: since.toISOString() },
    ascendingOrder: false,
    pageSize: 50,
  });
  const imported = await activityRepo.externalIds('health_connect');
  const sessions = records.filter(
    (s) => s.metadata?.id && TYPE_FROM_HC[s.exerciseType] && s.metadata.dataOrigin !== OWN_PACKAGE,
  );
  return Promise.all(
    sessions.map(async (s) => {
      const startedAt = Date.parse(s.startTime);
      const endedAt = Date.parse(s.endTime);
      return {
        uuid: s.metadata!.id!,
        type: TYPE_FROM_HC[s.exerciseType]!,
        startedAt,
        endedAt,
        durationS: (endedAt - startedAt) / 1000,
        distanceM: await sessionDistanceM(s),
        sourceName: originLabel(s),
        deviceName: deviceLabel(s),
        alreadyImported: imported.has(s.metadata!.id!),
      };
    }),
  );
}

/** Route type comes back as a string from native code despite the numeric TS enum. */
function routeState(s: Session): 'data' | 'none' | 'consent' {
  const t = s.exerciseRoute?.type as unknown;
  if (t === 'DATA' || t === 0) return 'data';
  if (t === 'CONSENT_REQUIRED' || t === 2) return 'consent';
  return 'none';
}

type RouteLocation = Awaited<ReturnType<typeof requestExerciseRoute>>[number];

async function sessionRoute(s: Session): Promise<RouteLocation[]> {
  const state = routeState(s);
  if (state === 'data') return s.exerciseRoute?.route ?? [];
  if (state === 'none') return [];
  // Health Connect shows its own consent dialog for this workout's route.
  return requestExerciseRoute(s.metadata!.id!);
}

/** Native code returns lengths as { inMeters, … } while the TS type says { value, unit }. */
function meters(length: unknown): number | null {
  if (!length || typeof length !== 'object') return null;
  const l = length as { inMeters?: number; value?: number; unit?: string };
  if (typeof l.inMeters === 'number') return l.inMeters;
  if (typeof l.value === 'number' && l.unit === 'meters') return l.value;
  return null;
}

/**
 * Imports one workout as a local activity in "finished" state, so it goes
 * through the normal summary → save → upload flow. Returns the activity id.
 */
export async function importHealthConnectWorkout(recordId: string): Promise<string> {
  await ensureInitialized();
  const session = await readRecord('ExerciseSession', recordId);
  const type = TYPE_FROM_HC[session.exerciseType] ?? 'walk';
  const route = await sessionRoute(session);
  const points = routeFromExternalLocations(
    route.map((l) => ({
      latitude: l.latitude,
      longitude: l.longitude,
      horizontalAccuracy: meters(l.horizontalAccuracy) ?? -1,
      timestamp: Date.parse(l.time),
      speed: null,
      altitude: meters(l.altitude),
      segment: 0,
    })),
    type,
  );
  if (points.length < 2) throw new NoRouteError();

  const id = Crypto.randomUUID();
  const startedAt = Date.parse(session.startTime);
  const endedAt = Date.parse(session.endTime);
  await activityRepo.createImported({
    id,
    type,
    source: 'health_connect',
    externalId: recordId,
    sourceDevice: deviceLabel(session),
    startedAt,
  });
  await activityRepo.appendPoints(id, points);
  await activityRepo.finish(id, {
    endedAt,
    movingTimeS: (endedAt - startedAt) / 1000,
    distanceM: routeDistanceM(points),
    estimatedCells: estimateClaim(points).cells,
    best5kS: bestEffortS(points, 5000),
    best10kS: bestEffortS(points, 10000),
    visibility: 'followers' satisfies Visibility,
  });
  return id;
}

/** Writes a Runner activity (with route and distance) to Health Connect. */
export async function exportToHealthConnect(activity: Activity, points: RoutePoint[]): Promise<void> {
  if (activity.source !== 'phone' || points.length < 2) return;
  await ensureInitialized();
  const startTime = new Date(activity.startedAt).toISOString();
  const endTime = new Date(activity.endedAt).toISOString();
  const session: ExerciseSessionRecord = {
    recordType: 'ExerciseSession',
    exerciseType: HC_FROM_TYPE[activity.type],
    startTime,
    endTime,
    title: activity.title || undefined,
    metadata: { clientRecordId: activity.id },
    exerciseRoute: {
      route: points
        .filter((p) => p.accuracy <= RULES.maxAccuracyM && p.timestamp >= activity.startedAt && p.timestamp <= activity.endedAt)
        .map((p) => ({
          time: new Date(p.timestamp).toISOString(),
          latitude: p.latitude,
          longitude: p.longitude,
          horizontalAccuracy: { value: p.accuracy, unit: 'meters' },
          altitude: p.altitude != null ? { value: p.altitude, unit: 'meters' } : undefined,
        })),
    },
  };
  await insertRecords([
    session,
    { recordType: 'Distance', startTime, endTime, distance: { value: activity.distanceM, unit: 'meters' }, metadata: { clientRecordId: `${activity.id}-distance` } },
  ]);
}
