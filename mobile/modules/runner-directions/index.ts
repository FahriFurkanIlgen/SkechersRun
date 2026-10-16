import { requireOptionalNativeModule } from 'expo-modules-core';

interface RunnerDirectionsModule {
  route(waypoints: [number, number][], mode: 'walking' | 'cycling'): Promise<{ points: [number, number][]; distanceM: number } | null>;
}

/** Apple Maps directions; null on Android, web and Expo Go. */
export const RunnerDirections = requireOptionalNativeModule<RunnerDirectionsModule>('RunnerDirections');
