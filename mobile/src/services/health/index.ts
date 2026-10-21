import { Platform } from 'react-native';
import type { Activity, ActivitySource, RoutePoint } from '../../domain/types';
import {
  appleHealthSupported,
  connectAppleHealth,
  exportToAppleHealth,
  importHealthWorkout,
  listHealthWorkouts,
} from './appleHealth';
import {
  connectHealthConnect,
  exportToHealthConnect,
  healthConnectAvailability,
  importHealthConnectWorkout,
  listHealthConnectWorkouts,
  openHealthConnectSettings,
} from './healthConnect';
import type { HealthAvailability, HealthWorkout } from './types';

export * from './types';

/**
 * The device's health platform: Apple Health on iOS, Health Connect on
 * Android. Screens use this facade and never the platform modules directly.
 */
export interface HealthPlatform {
  source: Extract<ActivitySource, 'apple_health' | 'health_connect'>;
  /** Shown in UI, e.g. "Apple Sağlık". */
  name: string;
  /** "Apple Sağlık’a" / "Health Connect’e" (Turkish dative suffix). */
  nameTo: string;
  /** "Apple Sağlık’tan" / "Health Connect’ten" (Turkish ablative suffix). */
  nameFrom: string;
  /** Typical watches whose workouts arrive through this platform. */
  watches: string;
  availability(): Promise<HealthAvailability>;
  /** Shows the system permission screen; resolves false if reading was not allowed. */
  connect(): Promise<boolean>;
  listWorkouts(): Promise<HealthWorkout[]>;
  /** Returns the id of the new local activity. */
  importWorkout(id: string): Promise<string>;
  exportActivity(activity: Activity, points: RoutePoint[]): Promise<void>;
  /** Where the user manages the permission. */
  permissionHint: string;
  openSettings?: () => void;
}

const apple: HealthPlatform = {
  source: 'apple_health',
  name: 'Apple Sağlık',
  nameTo: 'Apple Sağlık’a',
  nameFrom: 'Apple Sağlık’tan',
  watches: 'Apple Watch',
  availability: async () => (appleHealthSupported() ? 'available' : 'unavailable'),
  connect: connectAppleHealth,
  listWorkouts: listHealthWorkouts,
  importWorkout: importHealthWorkout,
  exportActivity: exportToAppleHealth,
  permissionHint: 'Sağlık uygulaması → Paylaşım → Uygulamalar → Battle Run',
};

const healthConnect: HealthPlatform = {
  source: 'health_connect',
  name: 'Health Connect',
  nameTo: 'Health Connect’e',
  nameFrom: 'Health Connect’ten',
  watches: 'Wear OS, Galaxy Watch, Garmin',
  availability: healthConnectAvailability,
  connect: connectHealthConnect,
  listWorkouts: listHealthConnectWorkouts,
  importWorkout: importHealthConnectWorkout,
  exportActivity: exportToHealthConnect,
  permissionHint: 'Health Connect → Uygulama izinleri → Battle Run',
  openSettings: openHealthConnectSettings,
};

export const health: HealthPlatform | null =
  Platform.OS === 'ios' ? apple : Platform.OS === 'android' ? healthConnect : null;
