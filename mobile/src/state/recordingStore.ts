import { create } from 'zustand';
import { activityRepo } from '../data/local/activityRepo';
import { haversineM } from '../domain/geo';
import { routeDistanceM } from '../domain/metrics';
import type { ActivityType, RoutePoint, Visibility } from '../domain/types';
import { subscribeIngest, subscribeTrackingErrors } from '../services/location/ingest';
import { readSession, type RecordingSession } from '../services/location/recordingSession';
import { trackingService } from '../services/location/trackingService';

type Status = 'idle' | 'starting' | 'recording' | 'paused' | 'finishing';

interface RecordingState {
  status: Status;
  session: RecordingSession | null;
  points: RoutePoint[];
  distanceM: number;
  lastFix: { accuracy: number; timestamp: number } | null;
  rejectedFixes: number;
  error: string | null;
  hydrate: () => Promise<void>;
  start: (type: ActivityType, visibility: Visibility) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  /** Returns the finished activity id. */
  finish: () => Promise<string | null>;
  cancel: () => Promise<void>;
  clearError: () => void;
}

function statusOf(session: RecordingSession | null): Status {
  return session ? session.status : 'idle';
}

export const useRecording = create<RecordingState>((set, get) => {
  subscribeIngest((event) => {
    const { session, points, distanceM } = get();
    if (!session || session.activityId !== event.activityId) return;
    let added = distanceM;
    let prev = points[points.length - 1];
    for (const p of event.accepted) {
      if (prev && prev.segment === p.segment) added += haversineM(prev, p);
      prev = p;
    }
    set({
      points: event.accepted.length ? [...points, ...event.accepted] : points,
      distanceM: added,
      lastFix: event.lastRaw ?? get().lastFix,
      rejectedFixes: get().rejectedFixes + event.rejectedCount,
    });
  });
  subscribeTrackingErrors((message) => set({ error: message }));

  return {
    status: 'idle',
    session: null,
    points: [],
    distanceM: 0,
    lastFix: null,
    rejectedFixes: 0,
    error: null,

    /** Restores an in-progress recording after app restart / background kill. */
    hydrate: async () => {
      const session = await trackingService.restore();
      if (!session) {
        set({ status: 'idle', session: null, points: [], distanceM: 0 });
        return;
      }
      const points = await activityRepo.getPoints(session.activityId);
      set({ session: readSession() ?? session, status: statusOf(session), points, distanceM: routeDistanceM(points) });
    },

    start: async (type, visibility) => {
      set({ status: 'starting', error: null, points: [], distanceM: 0, lastFix: null, rejectedFixes: 0 });
      try {
        const session = await trackingService.start(type, visibility);
        set({ session, status: statusOf(session) });
      } catch (e) {
        set({ status: 'idle', session: null, error: e instanceof Error ? e.message : String(e) });
      }
    },

    pause: async () => {
      const session = await trackingService.pause();
      set({ session, status: statusOf(session) });
    },

    resume: async () => {
      try {
        const session = await trackingService.resume();
        set({ session, status: statusOf(session) });
      } catch (e) {
        set({ error: e instanceof Error ? e.message : String(e) });
      }
    },

    finish: async () => {
      set({ status: 'finishing' });
      const id = await trackingService.finish();
      set({ status: 'idle', session: null, points: [], distanceM: 0, lastFix: null });
      return id;
    },

    cancel: async () => {
      await trackingService.cancel();
      set({ status: 'idle', session: null, points: [], distanceM: 0, lastFix: null });
    },

    clearError: () => set({ error: null }),
  };
});
