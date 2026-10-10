import * as Location from 'expo-location';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { backendConfigured } from '../../data/remote/supabase';
import { fetchCells, MAX_CELL_QUERY_SPAN_DEG } from '../../data/remote/cellsApi';
import type { LatLng, Region } from '../../domain/geo';
import type { TerritoryCell } from '../../domain/types';
import { getLocationAccess, type LocationAccess } from '../../services/location/permissions';
import { useAuth } from '../../state/authStore';

/** Permission state + a current position for the home map. */
export function useCurrentLocation() {
  const [access, setAccess] = useState<LocationAccess | null>(null);
  const [position, setPosition] = useState<LatLng | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const a = await getLocationAccess();
    setAccess(a);
    if (a !== 'foreground' && a !== 'background') return;
    try {
      const last = await Location.getLastKnownPositionAsync({ maxAge: 60_000 });
      if (last) setPosition({ latitude: last.coords.latitude, longitude: last.coords.longitude });
      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setPosition({ latitude: current.coords.latitude, longitude: current.coords.longitude });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Konum alınamadı.');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  // Re-check when returning from the system Settings app.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s === 'active' && void refresh());
    return () => sub.remove();
  }, [refresh]);

  return { access, position, error, refresh };
}

export type TerritoryStatus =
  | 'backend_off'
  | 'signed_out'
  | 'zoom_in'
  | 'loading'
  | 'ready'
  | 'error';

/** Owned cells visible in the current map region, debounced. */
export function useTerritories(region: Region | null) {
  const session = useAuth((s) => s.session);
  const [territories, setTerritories] = useState<TerritoryCell[]>([]);
  const [status, setStatus] = useState<TerritoryStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async (r: Region) => {
    const id = ++requestId.current;
    setStatus('loading');
    try {
      const result = await fetchCells(r);
      if (id !== requestId.current) return;
      setTerritories(result);
      setStatus('ready');
      setError(null);
    } catch (e) {
      if (id !== requestId.current) return;
      setStatus('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // Conditions that prevent a request are derived, not stored.
  const tooWide =
    !!region && (region.latitudeDelta > MAX_CELL_QUERY_SPAN_DEG || region.longitudeDelta > MAX_CELL_QUERY_SPAN_DEG);
  const gate: TerritoryStatus | null = !backendConfigured
    ? 'backend_off'
    : !session
      ? 'signed_out'
      : tooWide
        ? 'zoom_in'
        : null;

  useEffect(() => {
    if (gate || !region) return;
    const t = setTimeout(() => void load(region), 400);
    return () => clearTimeout(t);
  }, [gate, region, load]);

  return {
    territories: gate ? [] : territories,
    status: gate ?? status,
    error,
    retry: () => region && load(region),
  };
}
