import type { Session } from '@supabase/supabase-js';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
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
  /** Native Sign in with Apple (iOS). Resolves false if the user cancelled. */
  signInWithApple: () => Promise<boolean>;
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
      // The confirmation e-mail links back into the app (src/app/auth-callback.tsx).
      options: { data: { username }, emailRedirectTo: Linking.createURL('auth-callback') },
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

  /**
   * Sign in with Apple via the system sheet, then exchange Apple's identity
   * token for a Supabase session. Needs the Apple provider enabled in
   * Supabase with the app's bundle id as an authorized client id.
   */
  signInWithApple: async () => {
    const sb = requireSupabase();
    // Apple receives only the hash; Supabase checks the raw value against it.
    const rawNonce = Crypto.randomUUID();
    const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
    let credential: AppleAuthentication.AppleAuthenticationCredential;
    try {
      credential = await AppleAuthentication.signInAsync({
        requestedScopes: [AppleAuthentication.AppleAuthenticationScope.EMAIL],
        nonce: hashedNonce,
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') return false;
      throw e;
    }
    if (!credential.identityToken) throw new Error('Apple kimlik bilgisi alınamadı.');
    const { error } = await sb.auth.signInWithIdToken({ provider: 'apple', token: credential.identityToken, nonce: rawNonce });
    if (error) throw new Error(error.message);
    return true;
  },

  signOut: async () => {
    await supabase?.auth.signOut();
    set({ session: null });
  },
}));
