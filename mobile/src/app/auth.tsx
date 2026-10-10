import { router } from 'expo-router';
import { useState } from 'react';
import { Banner, Button, Field, Screen, Segmented, Txt } from '../components/ui';
import { backendConfigured, oauthProviders } from '../data/remote/supabase';
import { normalizeUsername, profileActions, validateUsername } from '../features/profile/profileActions';
import { useAuth } from '../state/authStore';
import { useSettings } from '../state/settingsStore';

export default function Auth() {
  const auth = useAuth();
  const localUsername = useSettings((s) => s.username);
  const [mode, setMode] = useState<'signin' | 'signup'>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState(localUsername);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  if (!backendConfigured) {
    return (
      <Screen edges={[]}>
        <Banner tone="warning" title="Sunucu bağlı değil">
          Giriş yapılamaz. Kurulum için README’deki Supabase bölümüne bak.
        </Banner>
      </Screen>
    );
  }

  const done = async () => {
    await profileActions.reconcileAfterSignIn().catch(() => undefined);
    router.back();
  };

  const submit = async () => {
    setError(null);
    setInfo(null);
    if (mode === 'signup') {
      const v = validateUsername(username);
      if (v) return setError(v);
      if (password.length < 8) return setError('Şifre en az 8 karakter olmalı.');
    }
    setBusy(true);
    try {
      if (mode === 'signin') {
        await auth.signInWithEmail(email.trim(), password);
        await done();
      } else {
        useSettings.getState().set({ username });
        const { needsConfirmation } = await auth.signUpWithEmail(email.trim(), password, username);
        if (needsConfirmation) setInfo('E-postana gelen bağlantıyla hesabını doğrula, sonra giriş yap.');
        else await done();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const provider = async (p: 'apple' | 'google') => {
    setError(null);
    try {
      await auth.signInWithProvider(p);
      if (useAuth.getState().session) await done();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Screen edges={[]}>
      <Segmented
        label=""
        value={mode}
        onChange={setMode}
        options={[
          { value: 'signup', label: 'Kayıt ol' },
          { value: 'signin', label: 'Giriş yap' },
        ]}
      />
      <Field label="E-posta" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
      <Field
        label="Şifre"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
        hint={mode === 'signup' ? 'En az 8 karakter' : undefined}
      />
      {mode === 'signup' ? (
        <Field label="Kullanıcı adı" value={username} onChangeText={(t) => setUsername(normalizeUsername(t))} autoCapitalize="none" autoCorrect={false} />
      ) : null}
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {info ? <Banner tone="info">{info}</Banner> : null}
      <Button label={mode === 'signup' ? 'Kayıt ol' : 'Giriş yap'} size="lg" loading={busy} onPress={() => void submit()} />

      {oauthProviders.includes('apple') ? (
        <Button label="Apple ile devam et" variant="secondary" onPress={() => void provider('apple')} />
      ) : null}
      {oauthProviders.includes('google') ? (
        <Button label="Google ile devam et" variant="secondary" onPress={() => void provider('google')} />
      ) : null}
      {oauthProviders.length === 0 ? (
        <Txt variant="caption" muted>Apple ve Google ile giriş, Supabase’de sağlayıcılar etkinleştirilince açılır.</Txt>
      ) : null}
    </Screen>
  );
}
