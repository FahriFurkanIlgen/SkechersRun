import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Button, EmptyState, Loading, Screen } from '../components/ui';
import { supabase } from '../data/remote/supabase';
import { useSettings } from '../state/settingsStore';

/**
 * Target of the sign-up confirmation e-mail (runner://auth-callback?code=…).
 * The PKCE verifier was stored on this device at sign-up, so opening the link
 * here signs the user in directly.
 */
export default function AuthCallback() {
  const params = useLocalSearchParams<{ code?: string; error_description?: string }>();
  const [exchangeError, setError] = useState<string | null>(null);
  const linkError = params.error_description ?? (!params.code || !supabase ? 'Bağlantı geçersiz ya da süresi dolmuş.' : null);
  const error = linkError ?? exchangeError;

  useEffect(() => {
    if (!params.code || !supabase || params.error_description) return;
    supabase.auth
      .exchangeCodeForSession(params.code)
      .then(({ error: e }) => {
        if (e) throw e;
        router.replace(useSettings.getState().onboardingDone ? '/(tabs)' : '/onboarding');
      })
      .catch((e: unknown) =>
        setError(
          e instanceof Error && /verifier/i.test(e.message)
            ? 'E-postan doğrulandı. Bağlantıyı başka bir cihazda açtığın için oturum açılamadı; uygulamada e-posta ve şifrenle giriş yap.'
            : e instanceof Error
              ? e.message
              : String(e),
        ),
      );
  }, [params.code, params.error_description]);

  return (
    <Screen>
      {error ? (
        <>
          <EmptyState icon="alert" title="Giriş tamamlanamadı" message={error} />
          <Button label="Giriş ekranına git" onPress={() => router.replace('/auth')} />
        </>
      ) : (
        <Loading label="Giriş yapılıyor" />
      )}
    </Screen>
  );
}
