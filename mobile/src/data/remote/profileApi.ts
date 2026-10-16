import type { PrivacyZone } from '../../domain/privacy';
import type { ActivitySource, ActivityType, AthleteLevel, RoutePoint, RouteShare, Visibility } from '../../domain/types';
import { requireSupabase } from './supabase';

export interface RemoteProfile {
  id: string;
  username: string;
  avatarUrl: string | null;
  preferredActivity: ActivityType;
  level: AthleteLevel;
  profileVisibility: Visibility;
  defaultActivityVisibility: Visibility;
  showInLeaderboards: boolean;
  /** "İlçe takımı": the district the player competes for. */
  homeCity: string | null;
  homeDistrict: string | null;
}

export interface ProfileStats {
  activityCount: number;
  totalDistanceM: number;
  totalTimeS: number;
  territoryCells: number;
  totalGainCells: number;
  longestM: number;
}

export async function fetchMyProfile(userId: string): Promise<RemoteProfile | null> {
  const { data, error } = await requireSupabase()
    .from('profiles')
    .select('id, username, avatar_url, preferred_activity, level, profile_visibility, default_activity_visibility, show_in_leaderboards, home_city, home_district')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    id: data.id,
    username: data.username,
    avatarUrl: data.avatar_url,
    preferredActivity: data.preferred_activity,
    level: data.level,
    profileVisibility: data.profile_visibility,
    defaultActivityVisibility: data.default_activity_visibility,
    showInLeaderboards: data.show_in_leaderboards,
    homeCity: data.home_city ?? null,
    homeDistrict: data.home_district ?? null,
  };
}

export async function updateMyProfile(userId: string, patch: Partial<Omit<RemoteProfile, 'id'>>) {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.username !== undefined) row.username = patch.username;
  if (patch.avatarUrl !== undefined) row.avatar_url = patch.avatarUrl;
  if (patch.preferredActivity !== undefined) row.preferred_activity = patch.preferredActivity;
  if (patch.level !== undefined) row.level = patch.level;
  if (patch.profileVisibility !== undefined) row.profile_visibility = patch.profileVisibility;
  if (patch.defaultActivityVisibility !== undefined) row.default_activity_visibility = patch.defaultActivityVisibility;
  if (patch.showInLeaderboards !== undefined) row.show_in_leaderboards = patch.showInLeaderboards;
  if (patch.homeCity !== undefined) row.home_city = patch.homeCity;
  if (patch.homeDistrict !== undefined) row.home_district = patch.homeDistrict;
  const { error } = await requireSupabase().from('profiles').update(row).eq('id', userId);
  if (error) {
    if (error.code === '23505') throw new Error('Bu kullanıcı adı alınmış.');
    if (error.code === '23514') throw new Error('Kullanıcı adı 3-24 karakter; küçük harf, rakam, _ veya . olmalı.');
    throw new Error(error.message);
  }
}

export async function fetchProfileStats(userId: string): Promise<ProfileStats> {
  const { data, error } = await requireSupabase().rpc('profile_stats', { p_user: userId });
  if (error) throw new Error(error.message);
  const d = data as Record<string, number>;
  return {
    activityCount: Number(d.activity_count),
    totalDistanceM: d.total_distance_m,
    totalTimeS: d.total_time_s,
    territoryCells: Number(d.territory_cells),
    totalGainCells: Number(d.total_gain_cells),
    longestM: d.longest_m,
  };
}

/** Uploads a local image to the `avatars` bucket and returns its public URL. */
export async function uploadAvatar(userId: string, localUri: string, mimeType: string): Promise<string> {
  const sb = requireSupabase();
  const ext = mimeType.split('/')[1] ?? 'jpg';
  const path = `${userId}/avatar-${Date.now()}.${ext}`;
  const body = await (await fetch(localUri)).arrayBuffer();
  const { error } = await sb.storage.from('avatars').upload(path, body, { contentType: mimeType, upsert: true });
  if (error) throw new Error(error.message);
  return sb.storage.from('avatars').getPublicUrl(path).data.publicUrl;
}

export async function syncPrivacyZones(zones: PrivacyZone[]) {
  const { error } = await requireSupabase().rpc('set_privacy_zones', {
    zones: zones.map((z) => ({ label: z.label, lat: z.center.latitude, lng: z.center.longitude, radius_m: z.radiusM })),
  });
  if (error) throw new Error(error.message);
}

/** The signed-in user's privacy zones as stored on the server (centres already jittered). */
export async function fetchMyPrivacyZones(): Promise<PrivacyZone[]> {
  const { data, error } = await requireSupabase().rpc('my_privacy_zones');
  if (error) throw new Error(error.message);
  return ((data ?? []) as { id: string; label: string; lat: number; lng: number; radius_m: number }[]).map((z) => ({
    id: z.id,
    label: z.label,
    center: { latitude: z.lat, longitude: z.lng },
    radiusM: z.radius_m,
  }));
}

/** Which of these server activities belong to `userId` (others' private ones are simply not returned). */
export async function countOwnActivities(userId: string, remoteIds: string[]): Promise<number> {
  if (remoteIds.length === 0) return 0;
  const { count, error } = await requireSupabase()
    .from('activities')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .in('id', remoteIds);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export interface RemoteActivity {
  id: string;
  clientId: string;
  type: ActivityType;
  title: string;
  visibility: Visibility;
  routeShare: RouteShare;
  startedAt: number;
  endedAt: number;
  movingTimeS: number;
  distanceM: number;
  status: 'accepted' | 'rejected';
  reasons: string[];
  claimedCells: number;
  netGainCells: number;
  capturedCells: number;
  source: ActivitySource;
  externalId: string | null;
  sourceDevice: string | null;
}

/** The signed-in user's own activities on the server, newest first. */
export async function fetchMyActivities(): Promise<RemoteActivity[]> {
  const { data, error } = await requireSupabase().rpc('my_activities', { p_limit: 200 });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    clientId: r.client_id as string,
    type: r.type as ActivityType,
    title: (r.title as string) ?? '',
    visibility: r.visibility as Visibility,
    routeShare: (r.route_share as RouteShare) ?? 'trimmed',
    startedAt: Number(r.started_at),
    endedAt: Number(r.ended_at),
    movingTimeS: Number(r.moving_time_s),
    distanceM: Number(r.distance_m),
    status: r.status as 'accepted' | 'rejected',
    reasons: (r.reasons as string[]) ?? [],
    claimedCells: Number(r.claimed_cells ?? 0),
    netGainCells: Number(r.net_gain_cells ?? 0),
    capturedCells: Number(r.captured_cells ?? 0),
    source: ((r.source as ActivitySource) ?? 'phone'),
    externalId: (r.external_id as string) ?? null,
    sourceDevice: (r.source_device as string) ?? null,
  }));
}

/** Route points of several own activities in one request (server caps at 100 ids). */
export async function fetchMyRoutePointsBulk(activityIds: string[]): Promise<Map<string, RoutePoint[]>> {
  const { data, error } = await requireSupabase().rpc('my_route_points_bulk', { p_activities: activityIds });
  if (error) throw new Error(error.message);
  const out = new Map<string, RoutePoint[]>();
  for (const row of (data ?? []) as { activity_id: string; points: (number | null)[][] }[]) {
    out.set(
      row.activity_id,
      row.points.map(([seq, segment, lat, lng, accuracy, altitude, speed, ts]) => ({
        seq: seq as number,
        segment: segment as number,
        latitude: lat as number,
        longitude: lng as number,
        accuracy: accuracy as number,
        altitude,
        speed,
        timestamp: ts as number,
        mocked: false,
      })),
    );
  }
  return out;
}

/** Raw route points of one of the user's own activities. */
export async function fetchMyRoutePoints(activityId: string): Promise<RoutePoint[]> {
  const { data, error } = await requireSupabase().rpc('my_route_points', { p_activity: activityId });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, number | null>[]).map((p) => ({
    seq: p.seq as number,
    segment: p.segment as number,
    latitude: p.lat as number,
    longitude: p.lng as number,
    accuracy: p.accuracy as number,
    altitude: p.altitude,
    speed: p.speed,
    timestamp: Number(p.ts),
    mocked: false,
  }));
}

export async function deleteMyLocationData() {
  const { error } = await requireSupabase().rpc('delete_my_location_data');
  if (error) throw new Error(error.message);
}

export async function deleteMyAccount() {
  const { error } = await requireSupabase().rpc('delete_my_account');
  if (error) throw new Error(error.message);
}
