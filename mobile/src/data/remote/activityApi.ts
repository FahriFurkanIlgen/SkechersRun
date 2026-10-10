import type { Activity, ClaimResult, RoutePoint, RouteShare, Visibility } from '../../domain/types';
import { requireSupabase } from './supabase';

const MAX_POINTS = 19_000;

interface SubmitResponse {
  activity_id: string;
  status: 'accepted' | 'rejected';
  reasons: string[];
  distance_m: number;
  claimed_cells: number;
  net_gain_cells: number;
  captured_cells: number;
  captured_from_users: number;
}

/** Uploads raw points; the server validates them and decides territory ownership. */
export async function submitActivity(
  activity: Activity,
  points: RoutePoint[],
): Promise<{ remoteId: string; claim: ClaimResult }> {
  const sb = requireSupabase();
  // Server accepts at most MAX_POINTS fixes; very long activities are thinned evenly.
  if (points.length > MAX_POINTS) {
    const step = points.length / MAX_POINTS;
    points = Array.from({ length: MAX_POINTS }, (_, i) => points[Math.floor(i * step)]);
  }
  const payload = {
    client_id: activity.id,
    type: activity.type,
    title: activity.title,
    visibility: activity.visibility,
    route_share: activity.routeShare,
    source: activity.source,
    external_id: activity.externalId,
    source_device: activity.sourceDevice,
    started_at: activity.startedAt,
    ended_at: activity.endedAt,
    moving_time_s: activity.movingTimeS,
    // Compact tuples keep long activities well under request limits.
    points: points.map((p) => [
      p.latitude,
      p.longitude,
      p.accuracy,
      p.timestamp,
      p.segment,
      p.speed,
      p.altitude,
      p.mocked,
    ]),
  };
  const { data, error } = await sb.rpc('submit_activity', { payload });
  if (error) throw new Error(error.message);
  const r = data as SubmitResponse;
  return {
    remoteId: r.activity_id,
    claim: {
      status: r.status,
      reasons: r.reasons,
      distanceM: r.distance_m,
      claimedCells: r.claimed_cells,
      netGainCells: r.net_gain_cells,
      capturedCells: r.captured_cells,
      capturedFromUsers: r.captured_from_users,
    },
  };
}

export async function updateRemoteActivity(
  remoteId: string,
  title: string,
  visibility: Visibility,
  routeShare: RouteShare,
) {
  const { error } = await requireSupabase().rpc('update_activity', {
    p_id: remoteId,
    p_title: title,
    p_visibility: visibility,
    p_route_share: routeShare,
  });
  if (error) throw new Error(error.message);
}

export async function deleteRemoteActivity(remoteId: string) {
  const { error } = await requireSupabase().rpc('delete_activity', { p_id: remoteId });
  if (error) throw new Error(error.message);
}

/** User-facing explanation for server rejection reasons and claim notes. */
export const REASON_LABEL: Record<string, string> = {
  not_enough_points: 'Yeterli GPS noktası yok.',
  mock_location: 'Sahte konum sağlayıcısı algılandı.',
  non_monotonic_time: 'GPS zaman damgaları tutarsız.',
  future_timestamp: 'Aktivite zamanı gelecekte görünüyor.',
  too_old: 'Aktivite 7 günden eski olduğu için işlenmedi.',
  impossible_average_speed: 'Ortalama hız bu aktivite türü için mümkün değil.',
  impossible_speed_segments: 'Rotanın büyük bölümünde hız bu aktivite türü için mümkün değil.',
  route_jumps: 'Rotada çok sayıda konum sıçraması var.',
  overlapping_activity: 'Aynı zaman aralığında başka bir aktiviten zaten kayıtlı.',
  duplicate_trace: 'Bu rota daha önce yüklenmiş.',
  duplicate_import: 'Bu antrenman daha önce içe aktarılmış.',
  below_min_distance: 'Hücre kazanmak için en az 400 m gerekiyor.',
  claim_too_large: 'Tek aktivite sınırı (300 hücre) aşıldığı için hücre verilmedi.',
  loop: 'Döngü kapandı: geçtiğin hücreler + çevrelediğin hücreler.',
  corridor: 'Açık rota: içinden geçtiğin hücreler.',
};
