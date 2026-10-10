import * as SQLite from 'expo-sqlite';

/**
 * On-device database. GPS points are written here as soon as they arrive (also
 * from the background task) so a crash or OS kill during a long activity loses
 * at most the last batch of fixes.
 */
let db: SQLite.SQLiteDatabase | null = null;

const MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS activities (
    id TEXT PRIMARY KEY NOT NULL,
    remote_id TEXT,
    type TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    visibility TEXT NOT NULL DEFAULT 'private',
    status TEXT NOT NULL,              -- recording | finished | saved
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    moving_time_s REAL NOT NULL DEFAULT 0,
    distance_m REAL NOT NULL DEFAULT 0,
    estimated_area_m2 REAL NOT NULL DEFAULT 0,
    sync_state TEXT NOT NULL DEFAULT 'local_only',
    claim_json TEXT,
    last_sync_error TEXT
  );
  CREATE TABLE IF NOT EXISTS route_points (
    activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    segment INTEGER NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    accuracy REAL NOT NULL,
    altitude REAL,
    speed REAL,
    ts INTEGER NOT NULL,
    mocked INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (activity_id, seq)
  );
  CREATE TABLE IF NOT EXISTS privacy_zones (
    id TEXT PRIMARY KEY NOT NULL,
    label TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    radius_m REAL NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_activities_status ON activities(status, started_at);
  `,
  `
  ALTER TABLE activities ADD COLUMN route_share TEXT NOT NULL DEFAULT 'trimmed';
  ALTER TABLE activities ADD COLUMN best_5k_s REAL;
  ALTER TABLE activities ADD COLUMN best_10k_s REAL;
  `,
  `
  ALTER TABLE activities ADD COLUMN estimated_cells INTEGER NOT NULL DEFAULT 0;
  `,
];

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  const instance = await SQLite.openDatabaseAsync('runner.db');
  await instance.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const row = await instance.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  for (let v = current; v < MIGRATIONS.length; v++) {
    await instance.withTransactionAsync(async () => {
      await instance.execAsync(MIGRATIONS[v]);
      await instance.execAsync(`PRAGMA user_version = ${v + 1}`);
    });
  }
  db = instance;
  return instance;
}
