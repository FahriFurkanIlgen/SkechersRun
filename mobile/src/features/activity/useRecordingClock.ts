import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { signalQuality, type SignalQuality } from '../../domain/gpsFilter';
import { movingMs } from '../../services/location/recordingSession';
import { useRecording } from '../../state/recordingStore';

/** Ticks once per second while the screen is visible; derives elapsed time and GPS quality. */
export function useRecordingClock(): { movingS: number; signal: SignalQuality } {
  const session = useRecording((s) => s.session);
  const lastFix = useRecording((s) => s.lastFix);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = setInterval(() => setNow(Date.now()), 1000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        setNow(Date.now());
        timer ??= setInterval(() => setNow(Date.now()), 1000);
      } else if (timer) {
        // No UI updates in background — saves battery. Recording continues in the task.
        clearInterval(timer);
        timer = null;
      }
    });
    return () => {
      if (timer) clearInterval(timer);
      sub.remove();
    };
  }, []);

  return {
    movingS: session ? movingMs(session, now) / 1000 : 0,
    signal: session?.status === 'paused' ? 'none' : signalQuality(lastFix?.accuracy ?? null, lastFix?.timestamp ?? null, now),
  };
}
