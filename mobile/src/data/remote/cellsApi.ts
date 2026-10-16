import type { Region } from '../../domain/geo';
import type { Landmark, TerritoryCell } from '../../domain/types';
import { requireSupabase } from './supabase';

/** The server refuses wider queries; the map asks the user to zoom in. */
export const MAX_CELL_QUERY_SPAN_DEG = 0.3;

interface Row {
  q: number;
  r: number;
  owner_id: string;
  username: string | null;
  is_mine: boolean;
  weak: boolean | null;
  protected: boolean | null;
  landmark: string | null;
}

/** Owned cells inside the visible region. Hexagon geometry is computed on the device from q/r. */
export async function fetchCells(region: Region): Promise<TerritoryCell[]> {
  const { data, error } = await requireSupabase().rpc('cells_in_bbox', {
    min_lng: region.longitude - region.longitudeDelta / 2,
    min_lat: region.latitude - region.latitudeDelta / 2,
    max_lng: region.longitude + region.longitudeDelta / 2,
    max_lat: region.latitude + region.latitudeDelta / 2,
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).map((r) => ({
    q: r.q,
    r: r.r,
    ownerId: r.owner_id,
    username: r.username,
    isMine: r.is_mine,
    weak: !!r.weak,
    protected: !!r.protected,
    landmark: r.landmark ?? null,
  }));
}

/** Landmark cells ("kale") in the region, claimed or not. */
export async function fetchLandmarks(region: Region): Promise<Landmark[]> {
  const { data, error } = await requireSupabase().rpc('landmarks_in_bbox', {
    min_lng: region.longitude - region.longitudeDelta / 2,
    min_lat: region.latitude - region.latitudeDelta / 2,
    max_lng: region.longitude + region.longitudeDelta / 2,
    max_lat: region.latitude + region.latitudeDelta / 2,
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as { q: number; r: number; name: string; owner_username: string | null; is_mine: boolean }[]).map((l) => ({
    q: l.q,
    r: l.r,
    name: l.name,
    ownerUsername: l.owner_username,
    isMine: l.is_mine,
  }));
}
