// Pure Strava → Runner conversions (no I/O), shared by index.ts and its tests.

export type RunnerType = 'walk' | 'run' | 'ride' | 'wheelchair';

/** Strava sport_type → Runner activity type; null = not importable (no outdoor GPS route). */
const SPORT: Record<string, RunnerType> = {
  Walk: 'walk',
  Hike: 'walk',
  Run: 'run',
  TrailRun: 'run',
  Ride: 'ride',
  MountainBikeRide: 'ride',
  GravelRide: 'ride',
  Wheelchair: 'wheelchair',
};

export function runnerType(sportType: string | null | undefined, type?: string | null): RunnerType | null {
  return SPORT[sportType ?? ''] ?? SPORT[type ?? ''] ?? null;
}

export interface StravaSummary {
  id: number;
  name: string;
  sport_type?: string;
  type?: string;
  start_date: string;
  moving_time: number;
  elapsed_time: number;
  distance: number;
  manual?: boolean;
  trainer?: boolean;
  device_name?: string | null;
  map?: { summary_polyline?: string | null } | null;
}

export interface ImportableActivity {
  id: string;
  name: string;
  type: RunnerType;
  startedAt: number;
  movingTimeS: number;
  elapsedTimeS: number;
  distanceM: number;
  deviceName: string | null;
}

/** Activities with a GPS route of a supported sport; manual and indoor ones are dropped. */
export function importable(list: StravaSummary[]): ImportableActivity[] {
  const out: ImportableActivity[] = [];
  for (const a of list) {
    const type = runnerType(a.sport_type, a.type);
    if (!type || a.manual || a.trainer || !a.map?.summary_polyline) continue;
    out.push({
      id: String(a.id),
      name: a.name,
      type,
      startedAt: Date.parse(a.start_date),
      movingTimeS: a.moving_time,
      elapsedTimeS: a.elapsed_time,
      distanceM: a.distance,
      deviceName: a.device_name ?? null,
    });
  }
  return out;
}

export interface StreamSet {
  latlng?: { data: [number, number][] };
  time?: { data: number[] };
  altitude?: { data: number[] };
  velocity_smooth?: { data: number[] };
  moving?: { data: boolean[] };
}

export interface ExternalLocation {
  latitude: number;
  longitude: number;
  /** Strava has no accuracy; a typical watch/phone value so the device filter treats it as good GPS. */
  horizontalAccuracy: number;
  timestamp: number;
  speed: number | null;
  altitude: number | null;
  segment: number;
}

/** Long gaps (auto-pause) start a new segment so distance is never bridged across them. */
const PAUSE_GAP_S = 60;
const STRAVA_ACCURACY_M = 8;

export function streamsToLocations(streams: StreamSet, startedAt: number): ExternalLocation[] {
  const ll = streams.latlng?.data ?? [];
  const t = streams.time?.data ?? [];
  const out: ExternalLocation[] = [];
  let segment = 0;
  for (let i = 0; i < ll.length && i < t.length; i++) {
    if (i > 0 && t[i] - t[i - 1] > PAUSE_GAP_S) segment++;
    out.push({
      latitude: ll[i][0],
      longitude: ll[i][1],
      horizontalAccuracy: STRAVA_ACCURACY_M,
      timestamp: startedAt + t[i] * 1000,
      speed: streams.velocity_smooth?.data[i] ?? null,
      altitude: streams.altitude?.data[i] ?? null,
      segment,
    });
  }
  return out;
}
