import { kv } from '../data/local/kv';
import { requireSupabase, supabase } from '../data/remote/supabase';
import type { ActivityType, RoutePoint } from '../domain/types';

/**
 * Live location sharing while recording (safety). Only the latest position
 * goes to the server, at most every SEND_EVERY_MS; the server erases it when
 * sharing ends and expires a share after 8 hours. State is kept in the sync
 * kv store so the background location task can send updates too.
 */

const KEY = 'runner.liveShare';
const SEND_EVERY_MS = 45_000;

interface ActiveShare {
  id: string;
  viewers: number;
  lastSentAt: number;
}

export function activeLiveShare(): ActiveShare | null {
  try {
    const raw = kv.getItemSync(KEY);
    return raw ? (JSON.parse(raw) as ActiveShare) : null;
  } catch {
    return null;
  }
}

function save(share: ActiveShare | null) {
  if (share) kv.setItemSync(KEY, JSON.stringify(share));
  else kv.removeItemSync(KEY);
}

export interface LiveShareCandidate {
  userId: string;
  username: string;
}

/** Accepted followers: the people who may be chosen to watch. */
export async function fetchLiveShareCandidates(): Promise<LiveShareCandidate[]> {
  const { data, error } = await requireSupabase().rpc('live_share_candidates');
  if (error) throw new Error(error.message);
  return ((data ?? []) as { user_id: string; username: string }[]).map((r) => ({ userId: r.user_id, username: r.username }));
}

export async function startLiveShare(viewerIds: string[], type: ActivityType): Promise<void> {
  if (!supabase || viewerIds.length === 0) return;
  const { data, error } = await supabase.rpc('start_live_share', { p_viewers: viewerIds, p_type: type });
  if (error) throw new Error(error.message);
  save({ id: data as string, viewers: viewerIds.length, lastSentAt: 0 });
}

/** Called for every batch of accepted fixes; sends the newest one now and then. */
export function pushLiveLocation(points: RoutePoint[]): void {
  const share = activeLiveShare();
  const last = points[points.length - 1];
  if (!share || !last || !supabase || Date.now() - share.lastSentAt < SEND_EVERY_MS) return;
  save({ ...share, lastSentAt: Date.now() });
  void supabase.rpc('update_live_share', {
    p_share: share.id,
    p_lat: last.latitude,
    p_lng: last.longitude,
    p_accuracy: last.accuracy,
  });
}

export async function endLiveShare(): Promise<void> {
  const share = activeLiveShare();
  save(null);
  if (share && supabase) await supabase.rpc('end_live_share', { p_share: share.id });
}

export interface LiveShareView {
  username: string;
  activityType: ActivityType;
  startedAt: number;
  active: boolean;
  position: { latitude: number; longitude: number } | null;
  accuracy: number | null;
  lastAt: number | null;
}

/** null when the share does not exist or you are not one of its viewers. */
export async function fetchLiveShare(id: string): Promise<LiveShareView | null> {
  const { data, error } = await requireSupabase().rpc('get_live_share', { p_share: id });
  if (error) throw new Error(error.message);
  const d = data as Record<string, unknown> | null;
  if (!d) return null;
  return {
    username: d.username as string,
    activityType: d.activity_type as ActivityType,
    startedAt: Date.parse(String(d.started_at)),
    active: !!d.active,
    position: d.lat != null && d.lng != null ? { latitude: Number(d.lat), longitude: Number(d.lng) } : null,
    accuracy: d.accuracy != null ? Number(d.accuracy) : null,
    lastAt: d.last_at ? Date.parse(String(d.last_at)) : null,
  };
}
