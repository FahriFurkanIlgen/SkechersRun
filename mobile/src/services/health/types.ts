import type { ActivityType } from '../../domain/types';

/** A workout in the device's health platform that can be imported. */
export interface HealthWorkout {
  /** Platform id: HealthKit UUID or Health Connect record id. */
  uuid: string;
  type: ActivityType;
  startedAt: number;
  endedAt: number;
  durationS: number;
  distanceM: number | null;
  sourceName: string;
  deviceName: string | null;
  alreadyImported: boolean;
}

export type HealthAvailability = 'available' | 'needs_update' | 'unavailable';

export class NoRouteError extends Error {
  constructor() {
    super('Bu antrenmanda GPS rotası yok ya da rota izni verilmedi (ör. iç mekân veya konum kapalıyken kaydedilmiş). Hücre kazanmak için rota gerekir.');
  }
}

export class HealthUnavailableError extends Error {
  constructor() {
    super('Sağlık verilerine bu cihazda erişilemiyor.');
  }
}
