import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import type MapView from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../../components/Icon';
import { BaseMap, CellLayer, MapLegend } from '../../components/RouteMap';
import { Button, IconButton, ProgressRing, Txt } from '../../components/ui';
import { formatCells, formatGoalDistance } from '../../domain/format';
import type { Region } from '../../domain/geo';
import { useActivityHistory } from '../../features/activity/hooks';
import { useCurrentLocation, useTerritories, type TerritoryStatus } from '../../features/map/hooks';
import { useRemoteStats, useWeeklyGoal } from '../../features/profile/hooks';
import { openAppSettings, requestForegroundLocation } from '../../services/location/permissions';
import { useIsOffline } from '../../services/useConnectivity';
import { useRecording } from '../../state/recordingStore';
import { useSettings } from '../../state/settingsStore';
import { fonts, radius, useTheme } from '../../theme/theme';

// Shown only until the device reports a position (or when location is off).
const FALLBACK_REGION: Region = { latitude: 41.015, longitude: 28.979, latitudeDelta: 0.08, longitudeDelta: 0.08 };

const TERRITORY_HINT: Partial<Record<TerritoryStatus, string>> = {
  zoom_in: 'Bölgeleri görmek için yakınlaştır',
  error: 'Bölgeler yüklenemedi · tekrar dene',
  signed_out: 'Bölgeleri görmek için giriş yap',
  backend_off: 'Sunucu bağlı değil · bölgeler gösterilemiyor',
};

/** 02 Ana harita */
export default function MapScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);
  const { access, position, refresh } = useCurrentLocation();
  const [region, setRegion] = useState<Region | null>(null);
  const [showTerritories, setShowTerritories] = useState(true);
  const [mapReady, setMapReady] = useState(false);
  const [mapTimedOut, setMapTimedOut] = useState(false);
  const { territories, status, retry } = useTerritories(region);
  const { activities } = useActivityHistory();
  const goal = useWeeklyGoal(activities);
  const { stats } = useRemoteStats();
  const units = useSettings((s) => s.units);
  const recordingStatus = useRecording((s) => s.status);
  const offline = useIsOffline();

  useEffect(() => {
    if (mapReady) return;
    const t = setTimeout(() => setMapTimedOut(true), 15_000);
    return () => clearTimeout(t);
  }, [mapReady]);

  // Center on the user once the first fix arrives.
  const centered = useRef(false);
  useEffect(() => {
    if (position && mapReady && !centered.current) {
      centered.current = true;
      mapRef.current?.animateToRegion({ ...position, latitudeDelta: 0.02, longitudeDelta: 0.02 }, 400);
    }
  }, [position, mapReady]);

  const noPermission = access === 'denied' || access === 'undetermined' || access === 'services_off';
  const loading = access === null || (!mapReady && !mapTimedOut);
  const isRecording = recordingStatus === 'recording' || recordingStatus === 'paused';
  const top = insets.top + 12;
  const tabGap = 16;
  const hint = TERRITORY_HINT[status];

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <BaseMap
        mapRef={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={position ? { ...position, latitudeDelta: 0.02, longitudeDelta: 0.02 } : FALLBACK_REGION}
        showsUserLocation={!noPermission}
        // Keep the Apple/Google legal attribution visible above the bottom controls.
        mapPadding={{ top: 0, right: 0, bottom: 140, left: 0 }}
        onMapReady={() => setMapReady(true)}
        onRegionChangeComplete={(r) => setRegion(r)}
        accessibilityLabel="Çevrendeki oyun alanları: senin bölgelerin düz kenarlı, diğer oyuncuların bölgeleri kesikli kenarlı."
      >
        {showTerritories ? <CellLayer cells={territories} region={region} /> : null}
      </BaseMap>

      {/* Weekly summary card */}
      <View style={[styles.summary, { top, backgroundColor: colors.surface, borderColor: colors.border }]}>
        {loading ? (
          <View accessibilityElementsHidden style={{ flexDirection: 'row', gap: 12, alignItems: 'center', flex: 1 }}>
            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface2 }} />
            <View style={{ flex: 1, gap: 8 }}>
              <View style={{ width: '50%', height: 10, borderRadius: 5, backgroundColor: colors.surface2 }} />
              <View style={{ width: '80%', height: 14, borderRadius: 7, backgroundColor: colors.surface2 }} />
            </View>
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityHint="Görevler ve haftalık hedef ekranını açar"
            onPress={() => router.navigate('/(tabs)/quests')}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}
          >
            <ProgressRing value={goal.ratio} label={`Haftalık hedefin yüzde ${Math.round(Math.min(goal.ratio, 1) * 100)}’i tamam`} />
            <View style={{ gap: 2, flexShrink: 1 }}>
              <Txt variant="caption" muted>Bu hafta</Txt>
              <Txt variant="heading" style={{ fontFamily: fonts.display, fontVariant: ['tabular-nums'] }} numberOfLines={1}>
                {formatGoalDistance(goal.doneM, units)} / {formatGoalDistance(goal.targetM, units)}
              </Txt>
            </View>
            <View style={{ width: 1, alignSelf: 'stretch', backgroundColor: colors.border }} />
            <View style={{ gap: 2, flexShrink: 1 }}>
              <Txt variant="caption" muted>Alanın</Txt>
              <Txt variant="heading" style={{ fontFamily: fonts.display, fontVariant: ['tabular-nums'] }} numberOfLines={1}>
                {stats ? formatCells(stats.territoryCells) : '—'}
              </Txt>
            </View>
          </Pressable>
        )}
      </View>

      {/* Map controls */}
      <View style={{ position: 'absolute', top, right: 16, gap: 8 }}>
        <IconButton
          icon="layers"
          size={48}
          label={showTerritories ? 'Bölgeleri gizle' : 'Bölgeleri göster'}
          onPress={() => setShowTerritories((v) => !v)}
        />
        {!noPermission ? (
          <IconButton
            icon="locate"
            size={48}
            label="Konumuma odaklan"
            onPress={() => position && mapRef.current?.animateToRegion({ ...position, latitudeDelta: 0.012, longitudeDelta: 0.012 }, 400)}
          />
        ) : null}
      </View>

      {/* Status messages under the card */}
      <View style={{ position: 'absolute', top: top + 76, left: 16, right: 16, gap: 8 }} pointerEvents="box-none">
        {offline ? (
          <View accessibilityRole="alert" style={[styles.banner, { backgroundColor: colors.warnSoft, borderColor: colors.warn }]}>
            <Icon name="offline" size={22} color={colors.warn} />
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="body" style={{ fontFamily: fonts.bodyBold, fontSize: 15 }}>Çevrimdışısın</Txt>
              <Txt variant="bodySm" muted>Aktiviten yine de kaydedilir. Bağlantı gelince alanın ve sıralaman güncellenir.</Txt>
            </View>
          </View>
        ) : null}
        {mapTimedOut && !mapReady ? (
          <View accessibilityRole="alert" style={[styles.banner, { backgroundColor: colors.dangerSoft, borderColor: colors.danger }]}>
            <Icon name="alert" size={22} color={colors.danger} />
            <Txt variant="bodySm" style={{ flex: 1 }}>Harita yüklenemedi. Aktivite kaydı haritasız da çalışır.</Txt>
          </View>
        ) : null}
        {!offline && hint && showTerritories && !loading ? (
          <Pressable
            accessibilityRole={status === 'error' ? 'button' : 'text'}
            onPress={status === 'error' ? () => void retry() : status === 'signed_out' ? () => router.push('/auth') : undefined}
            style={[styles.chip, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <Txt variant="bodySm" style={{ fontFamily: fonts.bodySemi }}>{hint}</Txt>
          </Pressable>
        ) : null}
      </View>

      {loading ? (
        <View accessibilityRole="progressbar" style={[styles.loading, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <ActivityIndicator color={colors.primary} />
          <Txt variant="body" style={{ fontFamily: fonts.bodySemi }}>Harita yükleniyor…</Txt>
        </View>
      ) : null}

      {/* Bottom stack: permission card / legend / start */}
      <View style={{ position: 'absolute', left: 16, right: 16, bottom: tabGap, gap: 12 }} pointerEvents="box-none">
        {noPermission && !loading ? (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
              <Icon name="pinOff" size={26} color={colors.text} />
              <View style={{ flex: 1, gap: 4 }}>
                <Txt variant="heading" style={{ fontSize: 17 }}>
                  {access === 'services_off' ? 'Konum servisleri kapalı' : 'Konum izni kapalı'}
                </Txt>
                <Txt variant="bodySm" muted>
                  Rotanı çizmek ve kazandığın alanı hesaplamak için konumuna ihtiyacımız var. Konum yalnızca aktivite sırasında kullanılır.
                </Txt>
              </View>
            </View>
            <Button
              label={access === 'undetermined' ? 'Konum izni ver' : 'Ayarları aç'}
              variant="tonal"
              size="sm"
              onPress={async () => {
                if (access === 'undetermined') {
                  await requestForegroundLocation();
                  await refresh();
                } else {
                  await openAppSettings();
                }
              }}
            />
          </View>
        ) : null}
        {!noPermission && !loading && showTerritories ? <MapLegend /> : null}
        {isRecording ? (
          <Button label="Devam eden aktiviteye dön" size="lg" icon="play" onPress={() => router.push('/record')} />
        ) : (
          <Button
            label={noPermission ? 'Başlatmak için konum izni gerekli' : 'Aktiviteyi başlat'}
            size="lg"
            icon={noPermission ? undefined : 'play'}
            disabled={noPermission}
            accessibilityHint="Aktivite türünü seçip kaydı başlatacağın ekranı açar"
            onPress={() => router.push('/start')}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  summary: {
    position: 'absolute',
    left: 16,
    right: 80,
    height: 64,
    paddingHorizontal: 14,
    borderRadius: radius.card,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  banner: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', padding: 12, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1 },
  chip: { alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1 },
  loading: {
    position: 'absolute',
    top: '46%',
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  card: { padding: 18, gap: 12, borderRadius: 18, borderWidth: 1 },
});
