import { router } from 'expo-router';
import { useState } from 'react';
import { Image, View } from 'react-native';
import { Banner, Button, Field, Segmented, Txt } from '../../components/ui';
import { backendConfigured } from '../../data/remote/supabase';
import { ACTIVITY_LABEL } from '../../domain/format';
import type { ActivityType, AthleteLevel } from '../../domain/types';
import { OnboardingStep } from '../../features/onboarding/OnboardingStep';
import { normalizeUsername, profileActions, validateUsername } from '../../features/profile/profileActions';
import { useAuth } from '../../state/authStore';
import { useSettings } from '../../state/settingsStore';
import { spacing } from '../../theme/theme';

/** Final setup step: name, photo, activity preference, level, account. */
export default function OnboardingProfile() {
  const settings = useSettings();
  const session = useAuth((s) => s.session);
  const [username, setUsername] = useState(settings.username);
  const [activity, setActivity] = useState<ActivityType>(settings.preferredActivity);
  const [level, setLevel] = useState<AthleteLevel>(settings.level);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const finish = async (localOnly: boolean) => {
    const v = validateUsername(username);
    if (v) return setError(v);
    setBusy(true);
    try {
      await profileActions.save({ username, preferredActivity: activity, level });
      settings.set({ onboardingDone: true, localOnly });
      router.replace('/(tabs)');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <OnboardingStep
      icon="profile"
      title="Son bir adım"
      lead="Arkadaşların seni bu adla görür. Seviyen yalnızca hedeflerini ve kimlerle karşılaştırılacağını belirler."
      footer={
        session ? (
          <Button label="Başla" size="lg" loading={busy} onPress={() => void finish(false)} />
        ) : backendConfigured ? (
          <>
            <Button label="Hesap oluştur ve başla" size="lg" onPress={() => router.push('/auth')} />
            <Button label="Hesapsız devam et" variant="text" loading={busy} onPress={() => void finish(true)} />
            <Txt variant="caption" muted style={{ textAlign: 'center' }}>
              Hesapsız kullanımda aktiviteler yalnızca bu cihazda kalır; alan kazanmak ve sıralamalar için hesap gerekir.
            </Txt>
          </>
        ) : (
          <>
            <Button label="Bu cihazda başla" size="lg" loading={busy} onPress={() => void finish(true)} />
            <Txt variant="caption" muted style={{ textAlign: 'center' }}>
              Sunucu bağlantısı yapılandırılmadı: aktiviteler yalnızca bu cihazda saklanır, alan sahiplenme ve sosyal
              özellikler kapalıdır.
            </Txt>
          </>
        )
      }
    >
      <View style={{ gap: spacing(4) }}>
        <Field
          label="Kullanıcı adı"
          value={username}
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={(t) => {
            setUsername(normalizeUsername(t));
            setError(null);
          }}
          placeholder="ornek: sabah_kosucusu"
          hint="3–24 karakter: küçük harf, rakam, _ veya ."
        />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing(3) }}>
          {settings.avatarUri ? (
            <Image source={{ uri: settings.avatarUri }} style={{ width: 56, height: 56, borderRadius: 28 }} accessibilityLabel="Profil fotoğrafı" />
          ) : null}
          <Button
            label={settings.avatarUri ? 'Fotoğrafı değiştir' : 'Profil fotoğrafı ekle'}
            variant="secondary"
            size="sm"
            onPress={() => void profileActions.pickAvatar().catch((e) => setError(String(e)))}
          />
        </View>
        <Segmented
          label="En sık yaptığın aktivite"
          value={activity}
          onChange={setActivity}
          options={[
            { value: 'walk', label: ACTIVITY_LABEL.walk, icon: 'walk' },
            { value: 'run', label: ACTIVITY_LABEL.run, icon: 'run' },
            { value: 'ride', label: ACTIVITY_LABEL.ride, icon: 'ride' },
          ]}
        />
        <Segmented
          label="Seviye"
          value={level}
          onChange={setLevel}
          options={[
            { value: 'beginner', label: 'Yeni başlıyorum' },
            { value: 'experienced', label: 'Düzenli' },
          ]}
        />
        {error ? <Banner tone="danger">{error}</Banner> : null}
      </View>
    </OnboardingStep>
  );
}
