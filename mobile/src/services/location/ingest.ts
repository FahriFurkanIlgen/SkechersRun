import type { LocationObject } from 'expo-location';
import { activityRepo } from '../../data/local/activityRepo';
import { evaluateFix, type RawFix } from '../../domain/gpsFilter';
import type { RoutePoint } from '../../domain/types';
import { pushLiveLocation } from '../liveShare';
import { readSession, writeSession } from './recordingSession';

export interface IngestEvent {
  activityId: string;
  accepted: RoutePoint[];
  /** Latest raw fix, accepted or not — drives the GPS signal indicator. */
  lastRaw: { accuracy: number; timestamp: number } | null;
  rejectedCount: number;
}

type Listener = (event: IngestEvent) => void;
const listeners = new Set<Listener>();

export function subscribeIngest(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitTrackingError(message: string) {
  errorListeners.forEach((l) => l(message));
}
const errorListeners = new Set<(message: string) => void>();
export function subscribeTrackingErrors(listener: (message: string) => void): () => void {
  errorListeners.add(listener);
  return () => errorListeners.delete(listener);
}

// Cache of the last accepted point; falls back to the DB after a JS restart.
let lastAccepted: { activityId: string; point: RoutePoint } | null = null;

// Location batches can arrive while a previous batch is still being written.
let queue: Promise<void> = Promise.resolve();

function toRawFix(l: LocationObject): RawFix {
  return {
    latitude: l.coords.latitude,
    longitude: l.coords.longitude,
    accuracy: l.coords.accuracy ?? Number.POSITIVE_INFINITY,
    altitude: l.coords.altitude ?? null,
    speed: l.coords.speed != null && l.coords.speed >= 0 ? l.coords.speed : null,
    timestamp: l.timestamp,
    mocked: l.mocked === true,
  };
}

async function process(locations: LocationObject[]): Promise<void> {
  const session = readSession();
  if (!session || session.status !== 'recording' || locations.length === 0) return;

  let last =
    lastAccepted?.activityId === session.activityId
      ? lastAccepted.point
      : await activityRepo.getLastPoint(session.activityId);

  const accepted: RoutePoint[] = [];
  let rejectedCount = 0;
  let seq = session.nextSeq;
  const sorted = [...locations].sort((a, b) => a.timestamp - b.timestamp);

  for (const loc of sorted) {
    const fix = toRawFix(loc);
    // A new segment starts after resume; never compare against the pre-pause point.
    const reference = last && last.segment === session.segment ? last : null;
    // Skip fixes cached by the OS from before the start / the last resume.
    if (fix.timestamp < (session.resumedAt ?? session.startedAt) - 1000) continue;
    const decision = evaluateFix(fix, reference, session.type);
    if (!decision.accept) {
      rejectedCount++;
      continue;
    }
    const point: RoutePoint = { ...fix, seq: seq++, segment: session.segment };
    accepted.push(point);
    last = point;
  }

  if (accepted.length > 0) {
    await activityRepo.appendPoints(session.activityId, accepted);
    // Re-read in case the user paused while we were writing.
    const latest = readSession();
    if (latest && latest.activityId === session.activityId) {
      writeSession({ ...latest, nextSeq: seq });
    }
    lastAccepted = { activityId: session.activityId, point: accepted[accepted.length - 1] };
    // Safety sharing (if on): the newest position, throttled.
    pushLiveLocation(accepted);
  }

  const tail = sorted[sorted.length - 1];
  const event: IngestEvent = {
    activityId: session.activityId,
    accepted,
    lastRaw: tail ? { accuracy: tail.coords.accuracy ?? Infinity, timestamp: tail.timestamp } : null,
    rejectedCount,
  };
  listeners.forEach((l) => l(event));
}

export function ingestLocations(locations: LocationObject[]): Promise<void> {
  queue = queue.then(() => process(locations)).catch((e) => {
    emitTrackingError(e instanceof Error ? e.message : String(e));
  });
  return queue;
}

export function resetIngestCache() {
  lastAccepted = null;
}
