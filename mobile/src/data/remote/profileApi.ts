import type { PrivacyZone } from '../../domain/privacy';
import type { ActivityType, AthleteLevel, Visibility } from '../../domain/types';
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
    .select('id, username, avatar_url, preferred_activity, level, profile_visibility, default_activity_visibility, show_in_leaderboards')
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

export async function deleteMyLocationData() {
  const { error } = await requireSupabase().rpc('delete_my_location_data');
  if (error) throw new Error(error.message);
}

export async function deleteMyAccount() {
  const { error } = await requireSupabase().rpc('delete_my_account');
  if (error) throw new Error(error.message);
}
