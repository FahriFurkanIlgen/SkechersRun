import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { kv as Storage } from '../local/kv';
import { AppState } from 'react-native';

/**
 * Backend connection. When the env vars are missing the app runs in an explicit
 * "local only" mode: recording works, but territory, social and leaderboard
 * features show that the server is not connected.
 */
const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const backendConfigured = url.length > 0 && anonKey.length > 0;

export const oauthProviders = (process.env.EXPO_PUBLIC_OAUTH_PROVIDERS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter((s): s is 'apple' | 'google' => s === 'apple' || s === 'google');

export const supabase: SupabaseClient | null = backendConfigured
  ? createClient(url, anonKey, {
      auth: {
        storage: Storage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
        flowType: 'pkce',
      },
    })
  : null;

if (supabase) {
  // Only refresh tokens while the app is in the foreground.
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}

export class BackendUnavailableError extends Error {
  constructor() {
    super('Sunucu bağlantısı yapılandırılmadı.');
  }
}

export function requireSupabase(): SupabaseClient {
  if (!supabase) throw new BackendUnavailableError();
  return supabase;
}
