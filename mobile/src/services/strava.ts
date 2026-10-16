import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { activityRepo } from '../data/local/activityRepo';
import { requireSupabase } from '../data/remote/supabase';
import { routeFromExternalLocations, type ExternalLocation } from '../domain/importRoute';
import { bestEffortS, routeDistanceM } from '../domain/metrics';
import { estimateClaim } from '../domain/territory';
import type { ActivityType, Visibility } from '../domain/types';
import { NoRouteError } from './health/types';

/**
 * Strava import. The OAuth code goes to the `strava` Edge Function, which keeps
 * the tokens; the device only ever sees activity lists and routes. Imported
 * activities are submitted like Health imports (same server validation).
 */

const CLIENT_ID = process.env.EXPO_PUBLIC_STRAVA_CLIENT_ID ?? '';
// Strava matches the redirect's host against the app's "Authorization Callback Domain".
const REDIRECT_URI = process.env.EXPO_PUBLIC_STRAVA_REDIRECT_URI ?? 'runner://strava-callback';

export const stravaConfigured = CLIENT_ID.length > 0;

export interface StravaActivity {
  id: string;
  name: string;
  type: ActivityType;
  startedAt: number;
  movingTimeS: number;
  elapsedTimeS: number;
  distanceM: number;
  deviceName: string | null;
  alreadyImported: boolean;
}

export interface StravaStatus {
  connected: boolean;
  athleteName: string | null;
}

const ERRORS: Record<string, string> = {
  strava_not_configured: 'Strava bağlantısı sunucuda henüz ayarlanmadı.',
  not_connected: 'Strava hesabın bağlı değil.',
  strava_unauthorized: 'Strava erişimi geri alınmış. Yeniden bağlan.',
  strava_token_failed: 'Strava bağlantısı doğrulanamadı. Yeniden dene.',
  strava_rate_limited: 'Strava şu an çok fazla istek alıyor; birkaç dakika sonra dene.',
  not_importable: 'Bu aktivitede GPS rotası yok ya da türü desteklenmiyor.',
};

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await requireSupabase().functions.invoke('strava', { body });
  if (error) {
    // FunctionsHttpError carries the JSON body in `context`.
    let code: string | undefined;
    try {
      code = (await (error as { context?: Response }).context?.json())?.error;
    } catch {
      code = undefined;
    }
    throw new Error((code && ERRORS[code]) ?? 'Strava’ya ulaşılamadı. Bağlantını kontrol edip yeniden dene.');
  }
  return data as T;
}

export async function fetchStravaStatus(): Promise<StravaStatus> {
  const { data, error } = await requireSupabase().rpc('strava_status');
  if (error) throw new Error(error.message);
  const row = (data as { connected: boolean; athlete_name: string | null }[] | null)?.[0];
  return { connected: !!row?.connected, athleteName: row?.athlete_name ?? null };
}

/** Opens Strava's consent page; resolves false if the player cancelled. */
export async function connectStrava(): Promise<boolean> {
  const url =
    'https://www.strava.com/oauth/mobile/authorize?' +
    new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      approval_prompt: 'auto',
      scope: 'activity:read_all',
    }).toString();
  const result = await WebBrowser.openAuthSessionAsync(url, REDIRECT_URI);
  if (result.type !== 'success') return false;
  const params = new URL(result.url).searchParams;
  if (params.get('error')) return false;
  const code = params.get('code');
  const scope = params.get('scope') ?? '';
  if (!code) throw new Error('Strava bağlantısı tamamlanamadı.');
  if (!scope.includes('activity:read')) throw new Error('Aktiviteleri okuma izni verilmedi. Bağlanırken “aktivitelerini görüntüle” iznini açık bırak.');
  await call({ action: 'exchange', code, scope });
  return true;
}

export async function disconnectStrava(): Promise<void> {
  await call({ action: 'disconnect' });
}

export async function listStravaActivities(page = 1): Promise<{ activities: StravaActivity[]; more: boolean }> {
  const res = await call<{ activities: Omit<StravaActivity, 'alreadyImported'>[]; more: boolean }>({ action: 'activities', page });
  const imported = await activityRepo.externalIds('strava');
  return { activities: res.activities.map((a) => ({ ...a, alreadyImported: imported.has(a.id) })), more: res.more };
}

/** Downloads the route and creates the local activity; returns its id. */
export async function importStravaActivity(stravaId: string): Promise<string> {
  const { activity, locations } = await call<{ activity: Omit<StravaActivity, 'alreadyImported'>; locations: ExternalLocation[] }>({
    action: 'streams',
    id: stravaId,
  });
  const points = routeFromExternalLocations(locations, activity.type);
  if (points.length < 2) throw new NoRouteError();
  const id = Crypto.randomUUID();
  await activityRepo.createImported({
    id,
    type: activity.type,
    source: 'strava',
    externalId: activity.id,
    sourceDevice: activity.deviceName ? `${activity.deviceName} · Strava` : 'Strava',
    startedAt: activity.startedAt,
  });
  await activityRepo.appendPoints(id, points);
  await activityRepo.finish(id, {
    endedAt: activity.startedAt + activity.elapsedTimeS * 1000,
    movingTimeS: activity.movingTimeS,
    distanceM: routeDistanceM(points),
    estimatedCells: estimateClaim(points).cells,
    best5kS: bestEffortS(points, 5000),
    best10kS: bestEffortS(points, 10000),
    visibility: 'followers' satisfies Visibility,
  });
  return id;
}
