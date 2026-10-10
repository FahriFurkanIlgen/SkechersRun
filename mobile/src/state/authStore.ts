import type { Session } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { create } from 'zustand';
import { supabase, requireSupabase } from '../data/remote/supabase';

interface AuthState {
  session: Session | null;
  initialized: boolean;
  init: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string, username: string) => Promise<{ needsConfirmation: boolean }>;
  signInWithProvider: (provider: 'apple' | 'google') => Promise<void>;
  signOut: () => Promise<void>;
}

export const useAuth = create<AuthState>((set) => ({
  session: null,
  initialized: false,

  init: async () => {
    if (!supabase) {
      set({ initialized: true });
      return;
    }
    const { data } = await supabase.auth.getSession();
    set({ session: data.session, initialized: true });
    supabase.auth.onAuthStateChange((_event, session) => set({ session }));
  },

  signInWithEmail: async (email, password) => {
    const { error } = await requireSupabase().auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
  },

  signUpWithEmail: async (email, password, username) => {
    const { data, error } = await requireSupabase().auth.signUp({
      email,
      password,
      options: { data: { username } },
    });
    if (error) throw new Error(error.message);
    return { needsConfirmation: !data.session };
  },

  /**
   * Apple / Google via Supabase OAuth (PKCE) in a system browser session.
   * Requires the provider to be enabled in the Supabase dashboard and
   * `runner://auth-callback` in the allowed redirect URLs.
   */
  signInWithProvider: async (provider) => {
    const sb = requireSupabase();
    const redirectTo = Linking.createURL('auth-callback');
    const { data, error } = await sb.auth.signInWithOAuth({
      provider,
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error || !data.url) throw new Error(error?.message ?? 'OAuth başlatılamadı.');
    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type !== 'success') return;
    const code = new URL(result.url).searchParams.get('code');
    if (!code) throw new Error('Giriş tamamlanamadı.');
    const { error: exchangeError } = await sb.auth.exchangeCodeForSession(code);
    if (exchangeError) throw new Error(exchangeError.message);
  },

  signOut: async () => {
    await supabase?.auth.signOut();
    set({ session: null });
  },
}));
