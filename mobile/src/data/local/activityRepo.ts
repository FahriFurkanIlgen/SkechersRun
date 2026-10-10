import type {
  Activity,
  ActivitySource,
  ActivitySyncState,
  ActivityType,
  ClaimResult,
  RoutePoint,
  RouteShare,
  Visibility,
} from '../../domain/types';
import { getDb } from './db';

interface ActivityRow {
  id: string;
  remote_id: string | null;
  type: ActivityType;
  title: string;
  visibility: Visibility;
  route_share: RouteShare;
  source: ActivitySource;
  external_id: string | null;
  source_device: string | null;
  best_5k_s: number | null;
  best_10k_s: number | null;
  status: 'recording' | 'finished' | 'saved';
  started_at: number;
  ended_at: number | null;
  moving_time_s: number;
  distance_m: number;
  estimated_cells: number;
  sync_state: ActivitySyncState;
  claim_json: string | null;
  last_sync_error: string | null;
}

interface PointRow {
  seq: number;
  segment: number;
  lat: number;
  lng: number;
  accuracy: number;
  altitude: number | null;
  speed: number | null;
  ts: number;
  mocked: number;
}

/** Claims stored before the cell model have no cell fields. */
function normaliseClaim(c: Partial<ClaimResult> & { status: ClaimResult['status'] }): ClaimResult {
  return {
    status: c.status,
    reasons: c.reasons ?? [],
    distanceM: c.distanceM ?? 0,
    claimedCells: c.claimedCells ?? 0,
    netGainCells: c.netGainCells ?? 0,
    capturedCells: c.capturedCells ?? 0,
    capturedFromUsers: c.capturedFromUsers ?? 0,
  };
}

function toActivity(r: ActivityRow): Activity {
  return {
    id: r.id,
    remoteId: r.remote_id,
    type: r.type,
    title: r.title,
    visibility: r.visibility,
    routeShare: r.route_share,
    source: r.source ?? 'phone',
    externalId: r.external_id,
    sourceDevice: r.source_device,
    startedAt: r.started_at,
    endedAt: r.ended_at ?? r.started_at,
    movingTimeS: r.moving_time_s,
    distanceM: r.distance_m,
    estimatedCells: r.estimated_cells,
    best5kS: r.best_5k_s,
    best10kS: r.best_10k_s,
    syncState: r.sync_state,
    claim: r.claim_json ? normaliseClaim(JSON.parse(r.claim_json)) : null,
    lastSyncError: r.last_sync_error,
  };
}

function toPoint(r: PointRow): RoutePoint {
  return {
    seq: r.seq,
    segment: r.segment,
    latitude: r.lat,
    longitude: r.lng,
    accuracy: r.accuracy,
    altitude: r.altitude,
    speed: r.speed,
    timestamp: r.ts,
    mocked: r.mocked === 1,
  };
}

export const activityRepo = {
  async createRecording(id: string, type: ActivityType, startedAt: number): Promise<void> {
    const db = await getDb();
    await db.runAsync(
      `INSERT INTO activities (id, type, status, started_at) VALUES (?, ?, 'recording', ?)`,
      id,
      type,
      startedAt,
    );
  },

  /** An activity imported from a health platform, waiting on the summary screen like a recorded one. */
  async createImported(data: {
    id: string;
    type: ActivityType;
    source: ActivitySource;
    externalId: string;
    sourceDevice: string | null;
    startedAt: number;
  }): Promise<void> {
    const db = await getDb();
    await db.runAsync(
      `INSERT INTO activities (id, type, status, started_at, source, external_id, source_device)
         VALUES (?, ?, 'recording', ?, ?, ?, ?)`,
      data.id,
      data.type,
      data.startedAt,
      data.source,
      data.externalId,
      data.sourceDevice,
    );
  },

  async externalIds(source: ActivitySource): Promise<Set<string>> {
    const db = await getDb();
    const rows = await db.getAllAsync<{ external_id: string }>(
      `SELECT external_id FROM activities WHERE source = ? AND external_id IS NOT NULL`,
      source,
    );
    return new Set(rows.map((r) => r.external_id));
  },

  async appendPoints(activityId: string, points: RoutePoint[]): Promise<void> {
    if (points.length === 0) return;
    const db = await getDb();
    await db.withTransactionAsync(async () => {
      for (const p of points) {
        await db.runAsync(
          `INSERT OR IGNORE INTO route_points
             (activity_id, seq, segment, lat, lng, accuracy, altitude, speed, ts, mocked)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          activityId,
          p.seq,
          p.segment,
          p.latitude,
          p.longitude,
          p.accuracy,
          p.altitude,
          p.speed,
          p.timestamp,
          p.mocked ? 1 : 0,
        );
      }
    });
  },

  async getPoints(activityId: string): Promise<RoutePoint[]> {
    const db = await getDb();
    const rows = await db.getAllAsync<PointRow>(
      `SELECT seq, segment, lat, lng, accuracy, altitude, speed, ts, mocked
         FROM route_points WHERE activity_id = ? ORDER BY seq`,
      activityId,
    );
    return rows.map(toPoint);
  },

  async getLastPoint(activityId: string): Promise<RoutePoint | null> {
    const db = await getDb();
    const row = await db.getFirstAsync<PointRow>(
      `SELECT seq, segment, lat, lng, accuracy, altitude, speed, ts, mocked
         FROM route_points WHERE activity_id = ? ORDER BY seq DESC LIMIT 1`,
      activityId,
    );
    return row ? toPoint(row) : null;
  },

  /** Recording stopped; awaiting the user's save/discard decision on the summary screen. */
  async finish(
    id: string,
    data: {
      endedAt: number;
      movingTimeS: number;
      distanceM: number;
      estimatedCells: number;
      best5kS: number | null;
      best10kS: number | null;
      visibility: Visibility;
    },
  ): Promise<void> {
    const db = await getDb();
    await db.runAsync(
      `UPDATE activities SET status = 'finished', ended_at = ?, moving_time_s = ?,
         distance_m = ?, estimated_cells = ?, best_5k_s = ?, best_10k_s = ?, visibility = ? WHERE id = ?`,
      data.endedAt,
      data.movingTimeS,
      data.distanceM,
      data.estimatedCells,
      data.best5kS,
      data.best10kS,
      data.visibility,
      id,
    );
  },

  async save(
    id: string,
    data: { title: string; visibility: Visibility; routeShare: RouteShare; syncState: ActivitySyncState },
  ): Promise<void> {
    const db = await getDb();
    await db.runAsync(
      `UPDATE activities SET status = 'saved', title = ?, visibility = ?, route_share = ?, sync_state = ? WHERE id = ?`,
      data.title,
      data.visibility,
      data.routeShare,
      data.syncState,
      id,
    );
  },

  async update(id: string, data: { title: string; visibility: Visibility; routeShare: RouteShare }): Promise<void> {
    const db = await getDb();
    await db.runAsync(
      `UPDATE activities SET title = ?, visibility = ?, route_share = ? WHERE id = ?`,
      data.title,
      data.visibility,
      data.routeShare,
      id,
    );
  },

  async markSynced(id: string, remoteId: string, claim: ClaimResult): Promise<void> {
    const db = await getDb();
    await db.runAsync(
      `UPDATE activities SET remote_id = ?, claim_json = ?, sync_state = ?, last_sync_error = NULL,
         distance_m = ? WHERE id = ?`,
      remoteId,
      JSON.stringify(claim),
      claim.status === 'accepted' ? 'uploaded' : 'rejected',
      claim.distanceM,
      id,
    );
  },

  async markSyncError(id: string, message: string): Promise<void> {
    const db = await getDb();
    await db.runAsync(
      `UPDATE activities SET sync_state = 'pending_upload', last_sync_error = ? WHERE id = ?`,
      message,
      id,
    );
  },

  async setSyncState(id: string, state: ActivitySyncState): Promise<void> {
    const db = await getDb();
    await db.runAsync(`UPDATE activities SET sync_state = ? WHERE id = ?`, state, id);
  },

  async delete(id: string): Promise<void> {
    const db = await getDb();
    await db.runAsync(`DELETE FROM activities WHERE id = ?`, id);
  },

  async get(id: string): Promise<Activity | null> {
    const db = await getDb();
    const row = await db.getFirstAsync<ActivityRow>(`SELECT * FROM activities WHERE id = ?`, id);
    return row ? toActivity(row) : null;
  },

  async getStatus(id: string): Promise<ActivityRow['status'] | null> {
    const db = await getDb();
    const row = await db.getFirstAsync<{ status: ActivityRow['status'] }>(
      `SELECT status FROM activities WHERE id = ?`,
      id,
    );
    return row?.status ?? null;
  },

  async listSaved(): Promise<Activity[]> {
    const db = await getDb();
    const rows = await db.getAllAsync<ActivityRow>(
      `SELECT * FROM activities WHERE status = 'saved' ORDER BY started_at DESC`,
    );
    return rows.map(toActivity);
  },

  async listPendingUpload(): Promise<Activity[]> {
    const db = await getDb();
    const rows = await db.getAllAsync<ActivityRow>(
      `SELECT * FROM activities WHERE status = 'saved' AND sync_state IN ('pending_upload', 'local_only')
         ORDER BY started_at`,
    );
    return rows.map(toActivity);
  },

  /** Activity left in 'finished' state (e.g. app closed on the summary screen). */
  async findUnsavedFinished(): Promise<Activity | null> {
    const db = await getDb();
    const row = await db.getFirstAsync<ActivityRow>(
      `SELECT * FROM activities WHERE status = 'finished' ORDER BY started_at DESC LIMIT 1`,
    );
    return row ? toActivity(row) : null;
  },

  /** Start/end coordinates of saved activities, used for privacy-zone suggestions. */
  async listEndpoints(): Promise<{ latitude: number; longitude: number }[]> {
    const db = await getDb();
    return db.getAllAsync<{ latitude: number; longitude: number }>(
      `SELECT p.lat AS latitude, p.lng AS longitude FROM route_points p
         JOIN activities a ON a.id = p.activity_id AND a.status = 'saved'
        WHERE p.seq = (SELECT MIN(seq) FROM route_points WHERE activity_id = p.activity_id)
           OR p.seq = (SELECT MAX(seq) FROM route_points WHERE activity_id = p.activity_id)`,
    );
  },

  /** Removes raw GPS points for all activities while keeping summary stats. */
  async deleteAllRoutePoints(): Promise<void> {
    const db = await getDb();
    await db.runAsync(`DELETE FROM route_points`);
  },

  async deleteEverything(): Promise<void> {
    const db = await getDb();
    await db.execAsync(`DELETE FROM route_points; DELETE FROM activities; DELETE FROM privacy_zones;`);
  },
};
