import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { Icon } from '../components/Icon';
import { Banner, Button, EmptyState, Loading, Screen, Txt } from '../components/ui';
import { ACTIVITY_LABEL, formatDistance, formatDuration } from '../domain/format';
import { health, type HealthAvailability, type HealthWorkout } from '../services/health';
import { useSettings } from '../state/settingsStore';
import { fonts, radius, useTheme } from '../theme/theme';

const HEALTH_CONNECT_STORE = 'market://details?id=com.google.android.apps.healthdata';

/**
 * Import workouts from the device's health platform (Apple Health on iOS,
 * Health Connect on Android) — e.g. recorded with Apple Watch, Wear OS or
 * a Garmin synced through its phone app — as Runner activities.
 */
export default function ImportHealth() {
  const { colors } = useTheme();
  const units = useSettings((s) => s.units);
  const connected = useSettings((s) => s.healthConnected);
  const set = useSettings((s) => s.set);
  const [availability, setAvailability] = useState<HealthAvailability | null>(health ? null : 'unavailable');
  const [workouts, setWorkouts] = useState<HealthWorkout[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (health) void health.availability().then(setAvailability);
  }, []);

  const load = useCallback(async () => {
    if (!health || availability !== 'available' || !connected) return;
    try {
      setError(null);
      setWorkouts(await health.listWorkouts());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setWorkouts([]);
    }
  }, [availability, connected]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const connect = async () => {
    if (!health) return;
    try {
      setError(null);
      const granted = await health.connect();
      // iOS never reveals whether reading was allowed; Health Connect does.
      if (granted || health.source === 'apple_health') set({ healthConnected: true });
      else setError(`Antrenman okuma izni verilmedi. İzni ${health.permissionHint} bölümünden açabilirsin.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const importOne = async (w: HealthWorkout) => {
    if (!health) return;
    setBusyId(w.uuid);
    setError(null);
    try {
      const id = await health.importWorkout(w.uuid);
      router.replace({ pathname: '/summary/[id]', params: { id } });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  if (!health || availability === 'unavailable') {
    return (
      <Screen edges={[]}>
        <EmptyState
          icon="heart"
          title="Sağlık verisi kullanılamıyor"
          message={
            health?.source === 'health_connect'
              ? 'Bu cihazda Health Connect bulunamadı. Health Connect, Android 14 ve sonrasında sistemle birlikte gelir; daha eski sürümlerde Play Store’dan yüklenebilir.'
              : 'Bu cihazda Sağlık verisi yok.'
          }
          action={health?.source === 'health_connect' ? { label: 'Play Store’da aç', onPress: () => void Linking.openURL(HEALTH_CONNECT_STORE) } : undefined}
        />
      </Screen>
    );
  }

  if (availability === null) {
    return (
      <Screen edges={[]}>
        <Loading label="Kontrol ediliyor" />
      </Screen>
    );
  }

  if (availability === 'needs_update') {
    return (
      <Screen edges={[]}>
        <EmptyState
          icon="heart"
          title="Health Connect güncellenmeli"
          message="Antrenmanları okuyabilmek için Health Connect’in güncel sürümü gerekiyor."
          action={{ label: 'Play Store’da güncelle', onPress: () => void Linking.openURL(HEALTH_CONNECT_STORE) }}
        />
      </Screen>
    );
  }

  if (!connected) {
    return (
      <Screen edges={[]}>
        <EmptyState
          icon="heart"
          title="Saat antrenmanlarını getir"
          message={`${health.watches} veya başka bir uygulamayla kaydettiğin yürüyüş, koşu ve bisiklet antrenmanlarını rotasıyla içe aktar. İçe aktarılan antrenman da hücre kazandırır.`}
          action={{ label: `${health.nameTo} bağlan`, onPress: () => void connect() }}
        />
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <Txt variant="caption" muted style={{ textAlign: 'center' }}>
          Yalnızca antrenmanlar, rotaları ve mesafe okunur. Nabız gibi diğer sağlık verileri istenmez. İzni istediğin zaman{' '}
          {health.permissionHint} bölümünden geri alabilirsin.
        </Txt>
      </Screen>
    );
  }

  return (
    <Screen edges={[]}>
      <Txt variant="bodySm" muted>
        Son 7 günün antrenmanları. İçe aktardığında rota ve süre aktivite özetine gelir; kaydedince sunucu tıpkı telefonla kayıt gibi
        doğrular ve hücreleri hesaplar.
        {health.source === 'health_connect' ? ' Rotayı paylaşmak için Health Connect her antrenmanda ayrıca izin ister.' : ''}
      </Txt>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {workouts === null ? (
        <Loading label="Antrenmanlar okunuyor" />
      ) : workouts.length === 0 ? (
        <EmptyState
          icon="route"
          title="İçe aktarılacak antrenman yok"
          message={`Son 7 günde yürüyüş, koşu veya bisiklet antrenmanı bulunamadı ya da okuma izni verilmedi. İzinleri ${health.permissionHint} bölümünden kontrol edebilirsin.`}
          action={health.openSettings ? { label: 'Health Connect’i aç', onPress: health.openSettings } : undefined}
        />
      ) : (
        <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, borderWidth: 1, borderColor: colors.border }}>
          {workouts.map((w, i) => (
            <Pressable
              key={w.uuid}
              accessibilityRole="button"
              accessibilityState={{ disabled: w.alreadyImported, busy: busyId === w.uuid }}
              disabled={w.alreadyImported || busyId !== null}
              onPress={() => void importOne(w)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.border, opacity: w.alreadyImported ? 0.55 : 1 }}
            >
              <Icon name={w.type} size={26} color={colors.text} strokeWidth={1.9} />
              <View style={{ flex: 1, gap: 2 }}>
                <Txt variant="body" style={{ fontFamily: fonts.bodySemi }}>
                  {ACTIVITY_LABEL[w.type]} · {new Date(w.startedAt).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}{' '}
                  {new Date(w.startedAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
                </Txt>
                <Txt variant="caption" muted>
                  {w.distanceM != null ? `${formatDistance(w.distanceM, units)} · ` : ''}
                  {formatDuration(w.durationS)} · {w.deviceName ?? w.sourceName}
                </Txt>
              </View>
              {w.alreadyImported ? (
                <Txt variant="caption" muted>İçe aktarıldı</Txt>
              ) : (
                <Button label="Aktar" size="sm" variant="tonal" loading={busyId === w.uuid} onPress={() => void importOne(w)} />
              )}
            </Pressable>
          ))}
        </View>
      )}
      <Button label="Yenile" variant="text" onPress={() => void load()} />
    </Screen>
  );
}
