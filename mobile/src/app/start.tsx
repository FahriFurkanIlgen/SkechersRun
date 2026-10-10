import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, SignalBars, type IconName } from '../components/Icon';
import { Banner, Button, IconButton, Segmented, Txt } from '../components/ui';
import { RULES } from '../domain/rules';
import type { ActivityType, Visibility } from '../domain/types';
import { useGpsProbe } from '../features/activity/useGpsProbe';
import { getBatteryAdvice, openBatterySettings, type BatteryAdvice } from '../services/batteryGuidance';
import {
  getLocationAccess,
  openAppSettings,
  requestBackgroundLocation,
  type LocationAccess,
} from '../services/location/permissions';
import { useRecording } from '../state/recordingStore';
import { useSettings } from '../state/settingsStore';
import { fonts, radius, spacing, useTheme } from '../theme/theme';

const TYPES: { id: ActivityType; label: string; icon: IconName; desc: string }[] = [
  { id: 'walk', label: 'Yürüyüş', icon: 'walk', desc: 'Kendi temponda keşfet. Her sokak sayılır, acele yok.' },
  { id: 'run', label: 'Koşu', icon: 'run', desc: 'Tempoyu sen belirle. Geçtiğin her yol rotana eklenir.' },
  { id: 'ride', label: 'Bisiklet', icon: 'ride', desc: 'Daha geniş alanları dolaş. Alan, rotanın kendisinden hesaplanır.' },
];

const START_ERROR: Record<string, string> = {
  denied: 'Konum izni reddedildi. Ayarlardan izin vermelisin.',
  undetermined: 'Önce konum izni vermelisin.',
  services_off: 'Konum servisleri kapalı.',
};

/** 03 Aktivite öncesi */
export default function PreActivity() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const preferred = useSettings((s) => s.preferredActivity);
  const defaultVisibility = useSettings((s) => s.defaultActivityVisibility);
  const [type, setType] = useState<ActivityType>(preferred);
  const [visibility, setVisibility] = useState<Visibility>(defaultVisibility);
  const [access, setAccess] = useState<LocationAccess | null>(null);
  const [battery, setBattery] = useState<BatteryAdvice | null>(null);
  const rec = useRecording();
  const hasLocation = access === 'foreground' || access === 'background';
  const gps = useGpsProbe(hasLocation);
  const weak = hasLocation && gps.level <= 1;
  const selected = TYPES.find((t) => t.id === type)!;

  useFocusEffect(
    useCallback(() => {
      void getLocationAccess().then(setAccess);
      void getBatteryAdvice().then(setBattery);
    }, []),
  );

  const start = async () => {
    await rec.start(type, visibility);
    if (useRecording.getState().session) router.replace('/record');
  };

  return (
    <View style={{ flex: 1 }}>
      <Pressable accessibilityLabel="Kapat" style={{ flex: 1, backgroundColor: colors.scrim }} onPress={() => router.back()} />
      <View
        accessibilityViewIsModal
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          maxHeight: '92%',
          backgroundColor: colors.surface,
          borderTopLeftRadius: radius.sheet,
          borderTopRightRadius: radius.sheet,
        }}
      >
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: insets.bottom + 16, gap: 14 }}>
          <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: colors.border }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Txt variant="title" style={{ fontSize: 26 }}>Aktiviteye hazırlan</Txt>
            <IconButton icon="close" label="Kapat ve haritaya dön" onPress={() => router.back()} style={{ backgroundColor: colors.surface2, borderWidth: 0 }} />
          </View>

          <View style={{ gap: 10 }}>
            <Txt variant="label" muted>Aktivite türü</Txt>
            <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: 10 }}>
              {TYPES.map((t) => {
                const on = t.id === type;
                return (
                  <Pressable
                    key={t.id}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={t.label}
                    onPress={() => setType(t.id)}
                    style={{
                      flex: 1,
                      height: 96,
                      borderRadius: radius.card,
                      borderWidth: on ? 2 : 1,
                      borderColor: on ? colors.primary : colors.border,
                      backgroundColor: on ? colors.primarySoft : colors.surface,
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                    }}
                  >
                    <Icon name={t.icon} size={30} color={on ? colors.primaryText : colors.text} strokeWidth={1.9} />
                    <Text style={{ fontFamily: fonts.bodyBold, fontSize: 16, color: on ? colors.primaryText : colors.text }}>{t.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={{ padding: 14, borderRadius: radius.md, backgroundColor: colors.bg, gap: 6 }}>
              <Txt variant="body" style={{ fontSize: 15 }}>{selected.desc}</Txt>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
                <Icon name="hex" size={18} color={colors.primaryText} />
                <Txt variant="bodySm" muted style={{ flex: 1 }}>
                  İçinden geçtiğin her hücre senin olur; başladığın yere dönersen çevrelediğin hücreler de. En az{' '}
                  {RULES.minClaimDistanceM} m gerekir.
                </Txt>
              </View>
            </View>
          </View>

          <View style={{ gap: 10 }}>
            <Txt variant="label" muted>Hazırlık</Txt>
            {!hasLocation ? (
              <Banner tone="warning" title="Konum izni gerekli" action={{ label: 'Ayarları aç', onPress: openAppSettings }}>
                Rotanı kaydedebilmek için konum iznine ihtiyaç var.
              </Banner>
            ) : weak ? (
              <View accessibilityRole="alert" style={{ flexDirection: 'row', gap: 12, padding: 14, borderRadius: radius.md, backgroundColor: colors.warnSoft, borderWidth: 1, borderColor: colors.warn }}>
                <View accessible accessibilityLabel={`GPS sinyali 4 üzerinden ${gps.level}`}>
                  <SignalBars level={gps.level} color={colors.warn} />
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <Txt variant="body" style={{ fontFamily: fonts.bodyBold }}>{gps.accuracy == null ? 'GPS sinyali aranıyor' : 'GPS sinyali zayıf'}</Txt>
                  <Txt variant="bodySm" muted>Açık bir alana geçmeyi dene. Sinyal güçlenene kadar mesafe daha az doğru ölçülebilir.</Txt>
                </View>
              </View>
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 }}>
                <View accessible accessibilityLabel={`GPS sinyali 4 üzerinden ${gps.level}`}>
                  <SignalBars level={gps.level} color={colors.ok} />
                </View>
                <Txt variant="body" style={{ fontFamily: fonts.bodySemi }}>{gps.level === 4 ? 'GPS sinyali güçlü' : 'GPS sinyali iyi'}</Txt>
              </View>
            )}
            {hasLocation ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 }}>
                <Icon name="checkCircle" size={24} color={colors.ok} strokeWidth={2.2} />
                <Txt variant="body" style={{ fontFamily: fonts.bodySemi }}>Konum izni açık</Txt>
                <Txt variant="bodySm" muted style={{ marginLeft: 'auto' }}>{access === 'background' ? 'Her zaman' : 'Kullanırken'}</Txt>
              </View>
            ) : null}
            {access === 'foreground' && Platform.OS === 'android' ? (
              <Banner
                tone="info"
                title="Ekran kilitliyken kayıt"
                action={{ label: 'Her zaman izni ver', onPress: async () => setAccess(await requestBackgroundLocation()) }}
              >
                Android’de ekran kilitliyken kaydın kesilmemesi için “Her zaman izin ver” seçeneği gerekir.
              </Banner>
            ) : null}
            {battery ? (
              <Banner tone="info" title="Pil optimizasyonu açık" action={{ label: 'Pil ayarlarını aç', onPress: () => void openBatterySettings() }}>
                {`Uzun aktivitelerde telefon Runner’ı durdurabilir. Listede Runner’ı “Optimize etme” olarak işaretle.${battery.vendorSteps ? `\n\nBu telefonda ayrıca: ${battery.vendorSteps}` : ''}`}
              </Banner>
            ) : null}
          </View>

          <Segmented
            label="Bu aktiviteyi kimler görebilir?"
            value={visibility}
            onChange={setVisibility}
            options={[
              { value: 'private', label: 'Sadece ben', icon: 'lock' },
              { value: 'followers', label: 'Takipçiler', icon: 'users' },
              { value: 'public', label: 'Herkes', icon: 'globe' },
            ]}
          />
          <Txt variant="caption" muted>
            Paylaşılan rotalarda başlangıç ve bitişin ilk {RULES.publicRouteTrimM} m’si ile gizli bölgelerin görünmez.
          </Txt>

          {rec.error ? <Banner tone="danger">{START_ERROR[rec.error] ?? `Kayıt başlatılamadı: ${rec.error}`}</Banner> : null}

          <Button
            label={weak ? 'Yine de başlat' : 'Başlat'}
            size="lg"
            icon="play"
            disabled={!hasLocation}
            loading={rec.status === 'starting'}
            onPress={() => void start()}
            style={{ marginTop: spacing(1) }}
          />
        </ScrollView>
      </View>
    </View>
  );
}
