import type { Region } from '../../domain/geo';
import type { TerritoryCell } from '../../domain/types';
import { requireSupabase } from './supabase';

/** The server refuses wider queries; the map asks the user to zoom in. */
export const MAX_CELL_QUERY_SPAN_DEG = 0.3;

interface Row {
  q: number;
  r: number;
  owner_id: string;
  username: string | null;
  is_mine: boolean;
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
  }));
}
