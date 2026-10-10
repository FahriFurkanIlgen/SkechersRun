import type {
  ActivityType,
  AppNotification,
  AthleteLevel,
  Club,
  FeedPost,
  NotificationPrefs,
} from '../../domain/types';
import { requireSupabase } from './supabase';

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

// ---- Feed -----------------------------------------------------------------

interface FeedRow {
  id: string;
  activity_id: string;
  user_id: string;
  username: string;
  avatar_url: string | null;
  activity_type: ActivityType;
  title: string;
  distance_m: number;
  moving_time_s: number;
  net_gain_cells: number;
  public_route: { type: string; coordinates: unknown } | null;
  like_count: number;
  liked_by_me: boolean;
  created_at: string;
}

function routeCoords(g: FeedRow['public_route']): [number, number][] | null {
  if (!g) return null;
  if (g.type === 'LineString') return g.coordinates as [number, number][];
  if (g.type === 'MultiLineString') return (g.coordinates as [number, number][][]).flat();
  return null;
}

export async function fetchFeed(before?: string): Promise<FeedPost[]> {
  const rows = check(
    await requireSupabase().rpc('get_feed', { p_before: before ?? null, p_limit: 20 }),
  ) as FeedRow[];
  return rows.map((r) => ({
    id: r.id,
    activityId: r.activity_id,
    userId: r.user_id,
    username: r.username,
    avatarUrl: r.avatar_url,
    activityType: r.activity_type,
    title: r.title,
    distanceM: r.distance_m,
    movingTimeS: r.moving_time_s,
    netGainCells: r.net_gain_cells,
    publicRoute: routeCoords(r.public_route),
    likeCount: Number(r.like_count),
    likedByMe: r.liked_by_me,
    createdAt: r.created_at,
  }));
}

export async function toggleLike(postId: string): Promise<boolean> {
  return check(await requireSupabase().rpc('toggle_like', { p_post: postId })) as boolean;
}

// ---- Follows ----------------------------------------------------------------

export interface PersonRow {
  id: string;
  username: string;
  avatarUrl: string | null;
  status?: 'pending' | 'accepted';
}

export async function searchUsers(query: string): Promise<PersonRow[]> {
  const q = query.trim().toLowerCase().replace(/[^a-z0-9_.]/g, '');
  if (q.length < 2) return [];
  const rows = check(
    await requireSupabase()
      .from('profiles')
      .select('id, username, avatar_url')
      .ilike('username', `${q}%`)
      .limit(20),
  ) as { id: string; username: string; avatar_url: string | null }[];
  return rows.map((r) => ({ id: r.id, username: r.username, avatarUrl: r.avatar_url }));
}

export async function followUser(userId: string): Promise<'pending' | 'accepted'> {
  return check(await requireSupabase().rpc('follow_user', { target: userId })) as 'pending' | 'accepted';
}

export async function unfollowUser(userId: string) {
  check(await requireSupabase().rpc('unfollow_user', { target: userId }));
}

export async function respondFollow(followerId: string, accept: boolean) {
  check(await requireSupabase().rpc('respond_follow', { follower: followerId, accept }));
}

/** Followers (people following me) and following (people I follow). */
export async function fetchFollowGraph(myId: string): Promise<{ followers: PersonRow[]; following: PersonRow[] }> {
  const rows = check(
    await requireSupabase()
      .from('follows')
      .select(
        'follower_id, followee_id, status, follower:profiles!follows_follower_id_fkey(id, username, avatar_url), followee:profiles!follows_followee_id_fkey(id, username, avatar_url)',
      ),
  ) as unknown as {
    follower_id: string;
    followee_id: string;
    status: 'pending' | 'accepted';
    follower: { id: string; username: string; avatar_url: string | null };
    followee: { id: string; username: string; avatar_url: string | null };
  }[];
  return {
    followers: rows
      .filter((r) => r.followee_id === myId)
      .map((r) => ({ id: r.follower.id, username: r.follower.username, avatarUrl: r.follower.avatar_url, status: r.status })),
    following: rows
      .filter((r) => r.follower_id === myId)
      .map((r) => ({ id: r.followee.id, username: r.followee.username, avatarUrl: r.followee.avatar_url, status: r.status })),
  };
}

// ---- Leaderboards -------------------------------------------------------------

export type LeaderboardScope = 'global' | 'nearby';
export type LeaderboardMetric = 'area' | 'weekly_gain' | 'active_days';

export interface LeaderboardRow {
  rank: number;
  userId: string;
  username: string;
  avatarUrl: string | null;
  value: number;
  weeklyActivities: number;
  isMe: boolean;
}

export async function fetchLeaderboard(opts: {
  scope: LeaderboardScope;
  metric: LeaderboardMetric;
  level: AthleteLevel | null;
  center?: { latitude: number; longitude: number };
  radiusKm?: number;
  who?: 'all' | 'friends';
}): Promise<LeaderboardRow[]> {
  const rows = check(
    await requireSupabase().rpc('leaderboard', {
      p_scope: opts.scope,
      p_metric: opts.metric,
      p_level: opts.level,
      p_lat: opts.center?.latitude ?? null,
      p_lng: opts.center?.longitude ?? null,
      p_radius_km: opts.radiusKm ?? 10,
      p_limit: 50,
      p_who: opts.who ?? 'all',
    }),
  ) as {
    rank: number;
    user_id: string;
    username: string;
    avatar_url: string | null;
    value: number;
    weekly_activities: number;
    is_me: boolean;
  }[];
  return rows.map((r) => ({
    rank: Number(r.rank),
    userId: r.user_id,
    username: r.username,
    avatarUrl: r.avatar_url,
    value: r.value,
    weeklyActivities: Number(r.weekly_activities),
    isMe: r.is_me,
  }));
}

// ---- Clubs --------------------------------------------------------------------

export async function fetchClubs(): Promise<Club[]> {
  const rows = check(await requireSupabase().rpc('list_clubs')) as {
    id: string; name: string; description: string | null; owner_id: string; invite_code: string | null;
    member_count: number; is_member: boolean; created_at: string;
  }[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    ownerId: r.owner_id,
    inviteCode: r.invite_code ?? '',
    memberCount: Number(r.member_count),
    isMember: r.is_member,
    createdAt: r.created_at,
  }));
}

export async function createClub(name: string, description: string, isPrivate: boolean) {
  check(await requireSupabase().rpc('create_club', { p_name: name, p_description: description, p_private: isPrivate }));
}

export async function joinClub(args: { code?: string; clubId?: string }) {
  check(await requireSupabase().rpc('join_club', { p_code: args.code ?? null, p_club: args.clubId ?? null }));
}

export async function leaveClub(clubId: string) {
  check(await requireSupabase().rpc('leave_club', { p_club: clubId }));
}

// ---- Notifications ---------------------------------------------------------------

export async function fetchNotifications(): Promise<AppNotification[]> {
  const rows = check(
    await requireSupabase()
      .from('notifications')
      .select('id, kind, payload, read_at, created_at')
      .order('created_at', { ascending: false })
      .limit(50),
  ) as { id: string; kind: AppNotification['kind']; payload: Record<string, unknown>; read_at: string | null; created_at: string }[];
  return rows.map((r) => ({ id: r.id, kind: r.kind, payload: r.payload, readAt: r.read_at, createdAt: r.created_at }));
}

export async function markNotificationsRead(ids: string[]) {
  if (!ids.length) return;
  check(await requireSupabase().from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids));
}

export async function saveRemoteNotificationPrefs(userId: string, prefs: NotificationPrefs, pushToken: string | null) {
  check(
    await requireSupabase().from('notification_prefs').upsert({
      user_id: userId,
      enabled: prefs.enabled,
      activity_completed: prefs.activityCompleted,
      territory_changes: prefs.territoryChanges,
      follow_requests: prefs.followRequests,
      club_invites: prefs.clubInvites,
      push_token: pushToken,
      updated_at: new Date().toISOString(),
    }),
  );
}
