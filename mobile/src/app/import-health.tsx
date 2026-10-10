import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Icon } from '../components/Icon';
import { Banner, Button, EmptyState, Loading, Screen, Txt } from '../components/ui';
import { ACTIVITY_LABEL, formatDistance, formatDuration } from '../domain/format';
import {
  appleHealthSupported,
  connectAppleHealth,
  importHealthWorkout,
  listHealthWorkouts,
  type HealthWorkout,
} from '../services/health/appleHealth';
import { useSettings } from '../state/settingsStore';
import { fonts, radius, useTheme } from '../theme/theme';

/** Import Apple Health workouts (e.g. recorded with Apple Watch) as Runner activities. */
export default function ImportHealth() {
  const { colors } = useTheme();
  const units = useSettings((s) => s.units);
  const connected = useSettings((s) => s.appleHealthConnected);
  const set = useSettings((s) => s.set);
  const [workouts, setWorkouts] = useState<HealthWorkout[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const supported = appleHealthSupported();

  const load = useCallback(async () => {
    if (!supported || !connected) return;
    try {
      setError(null);
      setWorkouts(await listHealthWorkouts());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setWorkouts([]);
    }
  }, [supported, connected]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const connect = async () => {
    try {
      await connectAppleHealth();
      set({ appleHealthConnected: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const importOne = async (w: HealthWorkout) => {
    setBusyId(w.uuid);
    setError(null);
    try {
      const id = await importHealthWorkout(w.uuid);
      router.replace({ pathname: '/summary/[id]', params: { id } });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  if (!supported) {
    return (
      <Screen edges={[]}>
        <EmptyState icon="heart" title="Apple Sağlık kullanılamıyor" message="Bu cihazda Sağlık verisi yok. Android'de Health Connect desteği sonraki sürümde gelecek." />
      </Screen>
    );
  }

  if (!connected) {
    return (
      <Screen edges={[]}>
        <EmptyState
          icon="heart"
          title="Apple Watch antrenmanlarını getir"
          message="Apple Watch'ın Antrenman uygulamasıyla ya da başka bir uygulamayla kaydettiğin yürüyüş, koşu ve bisiklet antrenmanlarını rotasıyla içe aktar. İçe aktarılan antrenman da hücre kazandırır."
          action={{ label: 'Apple Sağlık’a bağlan', onPress: () => void connect() }}
        />
        <Txt variant="caption" muted style={{ textAlign: 'center' }}>
          Yalnızca antrenmanlar, rotaları ve mesafe okunur. Nabız gibi diğer sağlık verileri istenmez. İzni Sağlık uygulamasından
          istediğin zaman geri alabilirsin.
        </Txt>
      </Screen>
    );
  }

  return (
    <Screen edges={[]}>
      <Txt variant="bodySm" muted>
        Son 7 günün antrenmanları. İçe aktardığında rota ve süre aktivite özetine gelir; kaydedince sunucu tıpkı telefonla kayıt gibi
        doğrular ve hücreleri hesaplar.
      </Txt>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {workouts === null ? (
        <Loading label="Antrenmanlar okunuyor" />
      ) : workouts.length === 0 ? (
        <EmptyState
          icon="route"
          title="İçe aktarılacak antrenman yok"
          message="Son 7 günde yürüyüş, koşu veya bisiklet antrenmanı bulunamadı ya da Sağlık okuma izni verilmedi. İzinleri Sağlık uygulaması → Paylaşım → Uygulamalar → Runner bölümünden kontrol edebilirsin."
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
