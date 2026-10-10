import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { backendConfigured } from '../../data/remote/supabase';
import { useAuth } from '../../state/authStore';

/**
 * Loads server data for social screens with explicit loading / error /
 * unavailable states. `loader` must be stable (wrap in useCallback).
 */
export function useRemoteList<T>(loader: () => Promise<T[]>) {
  const session = useAuth((s) => s.session);
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const available = backendConfigured && !!session;

  const load = useCallback(async () => {
    if (!available) return;
    setLoading(true);
    try {
      setItems(await loader());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [available, loader]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return { items, setItems, loading, error, available, reload: load };
}
