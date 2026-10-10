import type { PrivacyZone } from '../../domain/privacy';
import { getDb } from './db';

/** Privacy zones are always kept on-device; the server receives a copy when signed in. */
export const privacyZoneRepo = {
  async list(): Promise<PrivacyZone[]> {
    const db = await getDb();
    const rows = await db.getAllAsync<{ id: string; label: string; lat: number; lng: number; radius_m: number }>(
      `SELECT * FROM privacy_zones ORDER BY label`,
    );
    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      center: { latitude: r.lat, longitude: r.lng },
      radiusM: r.radius_m,
    }));
  },

  async add(zone: PrivacyZone): Promise<void> {
    const db = await getDb();
    await db.runAsync(
      `INSERT OR REPLACE INTO privacy_zones (id, label, lat, lng, radius_m) VALUES (?, ?, ?, ?, ?)`,
      zone.id,
      zone.label,
      zone.center.latitude,
      zone.center.longitude,
      zone.radiusM,
    );
  },

  async remove(id: string): Promise<void> {
    const db = await getDb();
    await db.runAsync(`DELETE FROM privacy_zones WHERE id = ?`, id);
  },
};
