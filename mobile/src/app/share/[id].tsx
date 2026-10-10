import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../../components/Icon';
import { Button, Segmented, Txt } from '../../components/ui';
import { activityRepo } from '../../data/local/activityRepo';
import { privacyZoneRepo } from '../../data/local/privacyZoneRepo';
import { haversineM } from '../../domain/geo';
import { suggestPrivacyZones } from '../../domain/privacy';
import { RULES } from '../../domain/rules';
import type { RouteShare, Visibility } from '../../domain/types';
import { activityActions } from '../../features/activity/activityActions';
import { fonts, radius, useTheme } from '../../theme/theme';

const OPTIONS: { id: RouteShare; label: string; sub: string }[] = [
  { id: 'trimmed', label: 'Başlangıç ve bitişi gizle', sub: `Önerilen · İlk ve son ${RULES.publicRouteTrimM} m görünmez` },
  { id: 'stats_only', label: 'Sadece istatistikleri paylaş', sub: 'Harita ve rota gösterilmez' },
  { id: 'full', label: 'Rotayı olduğu gibi paylaş', sub: 'Tüm rota görünür; gizli bölgelerin yine gizlenir' },
];

/** 08b Paylaşım gizlilik uyarısı */
export default function ShareSheet() {
  const { id, title } = useLocalSearchParams<{ id: string; title?: string }>();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<RouteShare>('trimmed');
  const [visibility, setVisibility] = useState<Exclude<Visibility, 'private'>>('followers');
  const [nearFrequent, setNearFrequent] = useState(false);
  const [busy, setBusy] = useState(false);

  // Warn when the route starts or ends near a place the user often starts from.
  useEffect(() => {
    (async () => {
      const points = await activityRepo.getPoints(id);
      if (points.length < 2) return;
      const ends = [points[0], points[points.length - 1]];
      const zones = await privacyZoneRepo.list();
      const clusters = suggestPrivacyZones(await activityRepo.listEndpoints(), zones, 150, 2);
      setNearFrequent(ends.some((e) => clusters.some((c) => haversineM(e, c.center) < 300)));
    })().catch(() => undefined);
  }, [id]);

  const share = async () => {
    setBusy(true);
    try {
      await activityActions.save(id, (title ?? '').trim(), visibility, mode);
      router.back();
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <Pressable accessibilityLabel="Vazgeç" style={{ flex: 1, backgroundColor: colors.scrim }} onPress={() => router.back()} />
      <View
        accessibilityViewIsModal
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '90%', backgroundColor: colors.surface, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet }}
      >
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: insets.bottom + 16, gap: 16 }}>
          <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: colors.border }} />
          <View style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-start' }}>
            <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: colors.warnSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="shield" size={26} color={colors.warn} />
            </View>
            <View style={{ flex: 1, gap: 6 }}>
              <Txt variant="title" style={{ fontSize: 22, lineHeight: 26 }}>Rotanı paylaşmadan önce</Txt>
              <Txt variant="bodySm" muted>
                {nearFrequent
                  ? 'Rotanın başlangıcı ya da bitişi sık kullandığın bir konuma yakın. Bu bölgeyi gizlemeni öneririz.'
                  : 'Rotalar evini veya işini ele verebilir. Nasıl paylaşılacağını seç.'}
              </Txt>
            </View>
          </View>

          <View accessibilityRole="radiogroup" accessibilityLabel="Nasıl paylaşılsın?" style={{ gap: 10 }}>
            <Txt variant="label" muted>Nasıl paylaşılsın?</Txt>
            {OPTIONS.map((o) => {
              const on = o.id === mode;
              return (
                <Pressable
                  key={o.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`${o.label}. ${o.sub}`}
                  onPress={() => setMode(o.id)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 14,
                    padding: 14,
                    minHeight: 64,
                    borderRadius: radius.md,
                    borderWidth: on ? 2 : 1,
                    borderColor: on ? colors.primary : colors.border,
                    backgroundColor: on ? colors.primarySoft : colors.surface,
                  }}
                >
                  <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: on ? colors.primary : colors.text2, alignItems: 'center', justifyContent: 'center' }}>
                    {on ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary }} /> : null}
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ fontFamily: fonts.bodyBold, fontSize: 16, color: colors.text }}>{o.label}</Text>
                    <Text style={{ fontFamily: fonts.body, fontSize: 13, color: colors.text2 }}>{o.sub}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>

          <Segmented
            label="Görünürlük"
            value={visibility}
            onChange={setVisibility}
            options={[
              { value: 'followers', label: 'Takipçiler', icon: 'users' },
              { value: 'public', label: 'Herkes', icon: 'globe' },
            ]}
          />

          <View style={{ gap: 4 }}>
            <Button label="Paylaş ve kaydet" size="lg" loading={busy} onPress={() => void share()} />
            <Button label="Vazgeç" variant="text" onPress={() => router.back()} />
          </View>
        </ScrollView>
      </View>
    </View>
  );
}
