import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';
import { Platform } from 'react-native';
import { activityRepo } from '../../data/local/activityRepo';
import { bestEffortS, routeDistanceM } from '../../domain/metrics';
import { estimateClaim } from '../../domain/territory';
import type { ActivityType, Visibility } from '../../domain/types';
import { emitTrackingError, ingestLocations, resetIngestCache } from './ingest';
import { getLocationAccess } from './permissions';
import {
  clearSession,
  movingMs,
  readSession,
  writeSession,
  type RecordingSession,
} from './recordingSession';
import { LOCATION_TASK } from './trackingTask';

let foregroundSub: Location.LocationSubscription | null = null;

function locationOptions(type: ActivityType): Location.LocationTaskOptions {
  return {
    // ~10 m accuracy class: GPS quality without the extra drain of "navigation" mode.
    accuracy: Location.Accuracy.High,
    distanceInterval: type === 'ride' ? 10 : 5,
    timeInterval: 2000, // Android only
    activityType: Location.ActivityType.Fitness,
    // Never let iOS pause updates on its own; that would cut the route.
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    // Batch delivery while in background so the CPU can sleep between wakeups.
    deferredUpdatesInterval: 10_000,
    deferredUpdatesDistance: 25,
    foregroundService: {
      notificationTitle: 'Runner aktivite kaydediyor',
      notificationBody: 'Rotan kaydediliyor. Durdurmak için uygulamayı aç.',
      notificationColor: '#0E8C7F',
      killServiceOnDestroy: false,
    },
  };
}

async function startUpdates(session: RecordingSession): Promise<RecordingSession['mode']> {
  const access = await getLocationAccess();
  if (access === 'denied' || access === 'undetermined' || access === 'services_off') {
    throw new Error(access);
  }
  // iOS allows a when-in-use app that started updates in the foreground to keep
  // receiving them in the background (blue status bar pill). Android needs
  // "Always" + a foreground service for that.
  const canUseTask = access === 'background' || Platform.OS === 'ios';
  if (canUseTask) {
    try {
      if (!(await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK))) {
        await Location.startLocationUpdatesAsync(LOCATION_TASK, locationOptions(session.type));
      }
      return 'background';
    } catch (e) {
      // Fall back to foreground-only tracking below.
      emitTrackingError(
        `Arka plan takibi başlatılamadı: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  foregroundSub?.remove();
  const { activityType: _a, deferredUpdatesDistance: _d, deferredUpdatesInterval: _i, foregroundService: _f, ...opts } =
    locationOptions(session.type);
  foregroundSub = await Location.watchPositionAsync(
    opts,
    (loc) => void ingestLocations([loc]),
    (reason) => emitTrackingError(reason),
  );
  return 'foreground';
}

async function stopUpdates() {
  foregroundSub?.remove();
  foregroundSub = null;
  try {
    if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK);
    }
  } catch {
    // Task was never registered in this build.
  }
}

export const trackingService = {
  getSession: readSession,

  async start(type: ActivityType, visibility: Visibility): Promise<RecordingSession> {
    const existing = readSession();
    if (existing) return existing;
    const now = Date.now();
    const session: RecordingSession = {
      activityId: Crypto.randomUUID(),
      type,
      visibility,
      status: 'recording',
      segment: 0,
      nextSeq: 0,
      startedAt: now,
      movingMsAccum: 0,
      resumedAt: now,
      mode: 'background',
    };
    resetIngestCache();
    await activityRepo.createRecording(session.activityId, type, now);
    writeSession(session);
    try {
      const mode = await startUpdates(session);
      const withMode = { ...session, mode };
      writeSession(withMode);
      return withMode;
    } catch (e) {
      clearSession();
      await activityRepo.delete(session.activityId);
      throw e;
    }
  },

  async pause(): Promise<RecordingSession | null> {
    const s = readSession();
    if (!s || s.status !== 'recording') return s;
    const now = Date.now();
    const paused: RecordingSession = {
      ...s,
      status: 'paused',
      movingMsAccum: movingMs(s, now),
      resumedAt: null,
    };
    writeSession(paused);
    // Stopping GPS while paused saves battery on long breaks.
    await stopUpdates();
    return paused;
  },

  async resume(): Promise<RecordingSession | null> {
    const s = readSession();
    if (!s || s.status !== 'paused') return s;
    const resumed: RecordingSession = {
      ...s,
      status: 'recording',
      segment: s.segment + 1,
      resumedAt: Date.now(),
    };
    writeSession(resumed);
    const mode = await startUpdates(resumed);
    const withMode = { ...resumed, mode };
    writeSession(withMode);
    return withMode;
  },

  /** Stops recording and stores totals; returns the activity id for the summary screen. */
  async finish(): Promise<string | null> {
    const s = readSession();
    if (!s) return null;
    await stopUpdates();
    const now = Date.now();
    const points = await activityRepo.getPoints(s.activityId);
    const estimate = estimateClaim(points);
    await activityRepo.finish(s.activityId, {
      endedAt: now,
      movingTimeS: movingMs(s, now) / 1000,
      distanceM: routeDistanceM(points),
      estimatedCells: estimate.cells,
      best5kS: bestEffortS(points, 5000),
      best10kS: bestEffortS(points, 10000),
      visibility: s.visibility ?? 'followers',
    });
    clearSession();
    resetIngestCache();
    return s.activityId;
  },

  async cancel(): Promise<void> {
    const s = readSession();
    await stopUpdates();
    clearSession();
    resetIngestCache();
    if (s) await activityRepo.delete(s.activityId);
  },

  /**
   * Called on app launch: if a recording was in progress (app killed or
   * restarted), make sure location updates are running again.
   */
  async restore(): Promise<RecordingSession | null> {
    const s = readSession();
    if (!s) return null;
    const status = await activityRepo.getStatus(s.activityId);
    if (status !== 'recording') {
      clearSession();
      return null;
    }
    if (s.status === 'recording') {
      try {
        const mode = await startUpdates(s);
        const withMode = { ...s, mode };
        writeSession(withMode);
        return withMode;
      } catch (e) {
        emitTrackingError(e instanceof Error ? e.message : String(e));
      }
    }
    return s;
  },
};
