import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { AppState } from 'react-native';
import { RunnerWatch, type PhoneSessionPayload, type WatchWorkout } from '../../modules/runner-watch';
import { activityRepo } from '../data/local/activityRepo';
import { signalQuality } from '../domain/gpsFilter';
import { estimateClaim } from '../domain/territory';
import { requestRemoteFinish } from '../features/activity/remoteFinish';
import { useRecording } from '../state/recordingStore';
import { useSettings } from '../state/settingsStore';
import { importHealthWorkout } from './health/appleHealth';
import { getNotificationPermission } from './notifications';

/**
 * Apple Watch companion (targets/watch):
 *  - mirrors the phone recording on the watch and executes the watch's
 *    pause / resume / finish commands;
 *  - imports workouts the watch recorded on its own. The watch saves them to
 *    Apple Health and notifies the phone; Health data syncs from the watch
 *    with a delay, so a workout that is not visible yet is retried later.
 */

const PUSH_INTERVAL_MS = 3_000;
const HEARTBEAT_MS = 15_000;

let lastPushAt = 0;
let pendingPush: ReturnType<typeof setTimeout> | null = null;

function payload(): PhoneSessionPayload {
  const { session, distanceM, lastFix, points } = useRecording.getState();
  const units = useSettings.getState().units;
  if (!session) return { state: 'idle', units };
  return {
    state: session.status,
    type: session.type,
    startedAt: session.startedAt,
    movingMsAccum: session.movingMsAccum,
    resumedAt: session.resumedAt ?? undefined,
    distanceM,
    gps: session.status === 'paused' ? 'none' : signalQuality(lastFix?.accuracy ?? null, lastFix?.timestamp ?? null, Date.now()),
    estimatedCells: estimateClaim(points).cells,
    units,
  };
}

function pushNow() {
  if (!RunnerWatch) return;
  if (pendingPush) clearTimeout(pendingPush);
  pendingPush = null;
  lastPushAt = Date.now();
  RunnerWatch.sendPhoneSession(payload());
}

/** At most one update per PUSH_INTERVAL_MS; state changes go out immediately. */
function schedulePush(immediate: boolean) {
  if (immediate) return pushNow();
  if (pendingPush) return;
  pendingPush = setTimeout(pushNow, Math.max(0, PUSH_INTERVAL_MS - (Date.now() - lastPushAt)));
}

async function handleCommand(command: string) {
  const rec = useRecording.getState();
  switch (command) {
    case 'pause':
      if (rec.status === 'recording') await rec.pause();
      break;
    case 'resume':
      if (rec.status === 'paused') await rec.resume();
      break;
    case 'finish':
      if (rec.status === 'recording' || rec.status === 'paused') {
        if (!(await requestRemoteFinish())) {
          const id = await rec.finish();
          if (id) router.push({ pathname: '/summary/[id]', params: { id } });
        }
      }
      break;
  }
  pushNow();
}

let importing = false;
let askedToConnect = false;

/** Imports watch workouts that arrived (now or while the app was closed). */
export async function importWatchWorkouts(): Promise<void> {
  if (!RunnerWatch || importing) return;
  importing = true;
  try {
    const pending = RunnerWatch.pendingWorkouts();
    if (pending.length === 0) return;
    if (!useSettings.getState().healthConnected) {
      // Reading the watch workout needs Health access on the phone; the import
      // screen explains it and lists the workout once access is granted.
      if (AppState.currentState === 'active' && !askedToConnect) {
        askedToConnect = true;
        router.push('/import-health');
      }
      return;
    }
    const already = await activityRepo.externalIds('apple_health');
    for (const w of pending) {
      if (already.has(w.workoutId)) {
        RunnerWatch.ackWorkout(w.workoutId);
        continue;
      }
      try {
        const id = await importHealthWorkout(w.workoutId);
        RunnerWatch.ackWorkout(w.workoutId);
        await announce(w, id);
      } catch (e) {
        // Not synced from the watch yet: keep it and retry on the next foreground.
        // Any other failure (no route, permission) is permanent for this workout.
        const message = e instanceof Error ? e.message : String(e);
        if (!message.includes('bulunamadı')) RunnerWatch.ackWorkout(w.workoutId);
      }
    }
  } finally {
    importing = false;
  }
}

async function announce(w: WatchWorkout, activityId: string) {
  if (AppState.currentState === 'active') {
    router.push({ pathname: '/summary/[id]', params: { id: activityId } });
    return;
  }
  if ((await getNotificationPermission()) !== 'granted') return;
  const km = (w.distanceM / 1000).toFixed(2).replace('.', ',');
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Saatten aktivite geldi',
      body: `${km} km kaydedildi. Hücreleri almak için özeti açıp kaydet.`,
      data: { kind: 'watch_workout', activityId },
    },
    trigger: null,
  });
}

/** Starts the watch link; returns a cleanup function. No-op without the native module (Android). */
export function startWatchLink(): () => void {
  if (!RunnerWatch) return () => undefined;

  let prev = useRecording.getState();
  const unsubscribe = useRecording.subscribe((s) => {
    const statusChanged = s.status !== prev.status || s.session?.status !== prev.session?.status;
    if (statusChanged || s.distanceM !== prev.distanceM || s.lastFix !== prev.lastFix) schedulePush(statusChanged);
    prev = s;
  });
  const heartbeat = setInterval(() => {
    if (useRecording.getState().session) pushNow();
  }, HEARTBEAT_MS);
  const commands = RunnerWatch.addListener('onCommand', (e) => void handleCommand(e.command));
  const workouts = RunnerWatch.addListener('onWatchWorkout', () => void importWatchWorkouts());
  const appState = AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      pushNow();
      void importWatchWorkouts();
    }
  });

  pushNow();
  void importWatchWorkouts();

  return () => {
    unsubscribe();
    clearInterval(heartbeat);
    commands.remove();
    workouts.remove();
    appState.remove();
    if (pendingPush) clearTimeout(pendingPush);
  };
}
