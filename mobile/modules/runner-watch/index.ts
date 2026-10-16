import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core';

/** Phone recording state mirrored on the watch. Keys must match the watch app (PhoneLink.swift). */
export interface PhoneSessionPayload {
  state: 'idle' | 'recording' | 'paused';
  /** walk | run | ride */
  type?: string;
  startedAt?: number;
  movingMsAccum?: number;
  /** Epoch ms of the current recording stretch; absent while paused. */
  resumedAt?: number;
  distanceM?: number;
  /** good | fair | weak | none */
  gps?: string;
  estimatedCells?: number;
  units?: 'metric' | 'imperial';
  /** Phone's "haptic feedback" setting; the watch taps at every km when on. */
  haptics?: boolean;
  /** Weekly goal and cells for the watch start screen and complication (SharedStats.swift). */
  stats?: WatchStats;
}

export interface WatchStats {
  weekDoneM: number;
  weekTargetM: number;
  /** Monday 00:00 local of the week weekDoneM belongs to, epoch ms. */
  weekStartMs: number;
  cells: number;
  /** true = currently owned (server); false = gained so far (device only). */
  cellsOwned: boolean;
  /** "min": weekDoneM/weekTargetM are minutes, not meters. */
  goalUnit?: 'm' | 'min';
}

/** A workout the watch recorded on its own and saved to Apple Health. */
export interface WatchWorkout {
  workoutId: string;
  type: string;
  startedAt: number;
  endedAt: number;
  distanceM: number;
}

export interface WatchState {
  supported: boolean;
  paired: boolean;
  installed: boolean;
  reachable: boolean;
}

export type WatchCommand = 'pause' | 'resume' | 'finish' | 'sync';

interface NativeModule {
  isSupported(): boolean;
  getWatchState(): WatchState;
  sendPhoneSession(payload: PhoneSessionPayload): void;
  pendingWorkouts(): WatchWorkout[];
  ackWorkout(workoutId: string): void;
  addListener(event: 'onCommand', listener: (e: { command: WatchCommand }) => void): EventSubscription;
  addListener(event: 'onWatchWorkout', listener: (e: WatchWorkout) => void): EventSubscription;
  addListener(event: 'onWatchState', listener: (e: WatchState) => void): EventSubscription;
}

/** null on Android, web and builds without the native module. */
export const RunnerWatch = requireOptionalNativeModule<NativeModule>('RunnerWatch');
