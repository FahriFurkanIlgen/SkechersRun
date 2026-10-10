import Storage from 'expo-sqlite/kv-store';
import type { ActivityType, Visibility } from '../../domain/types';

/**
 * Persistent state of the activity currently being recorded. Stored in a
 * synchronous key-value store so the background location task (which may run
 * without any UI mounted) can read it, and so a recording survives app restarts.
 */
export interface RecordingSession {
  activityId: string;
  type: ActivityType;
  /** Visibility chosen before starting; becomes the summary default. */
  visibility: Visibility;
  status: 'recording' | 'paused';
  segment: number;
  nextSeq: number;
  startedAt: number;
  /** Moving time accumulated before the current recording stretch, ms. */
  movingMsAccum: number;
  /** When the current recording stretch started; null while paused. */
  resumedAt: number | null;
  /** 'background' = OS location task; 'foreground' = only while app is open. */
  mode: 'background' | 'foreground';
}

const KEY = 'runner.recordingSession';

export function readSession(): RecordingSession | null {
  try {
    const raw = Storage.getItemSync(KEY);
    return raw ? (JSON.parse(raw) as RecordingSession) : null;
  } catch {
    return null;
  }
}

export function writeSession(session: RecordingSession): void {
  Storage.setItemSync(KEY, JSON.stringify(session));
}

export function clearSession(): void {
  Storage.removeItemSync(KEY);
}

export function movingMs(session: RecordingSession, now = Date.now()): number {
  return session.movingMsAccum + (session.resumedAt != null ? now - session.resumedAt : 0);
}
