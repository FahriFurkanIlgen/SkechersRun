import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Animated, Pressable, StyleSheet, View } from 'react-native';
import type MapView from 'react-native-maps';
import { Polyline } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../../components/Icon';
import { BaseMap, CellLayer, LandmarkMarkers, MapLegend } from '../../components/RouteMap';
import { Button, IconButton, ProgressRing, Txt } from '../../components/ui';
import { formatCells, formatDistance } from '../../domain/format';
import type { LatLng, Region } from '../../domain/geo';
import { cellKey, emptyCellsNear } from '../../domain/hex';
import { compassName, type RouteSuggestion } from '../../domain/routeSuggest';
import { useActivityHistory } from '../../features/activity/hooks';
import { useCurrentLocation, useTerritories, type TerritoryStatus } from '../../features/map/hooks';
import { useRemoteStats, useWeeklyGoal } from '../../features/profile/hooks';
import { openAppSettings, requestForegroundLocation } from '../../services/location/permissions';
import { smartRoutes } from '../../services/smartRoute';
import { useIsOffline } from '../../services/useConnectivity';
import { useRecording } from '../../state/recordingStore';
import { useSettings } from '../../state/settingsStore';
import { fonts, radius, useTheme } from '../../theme/theme';

/** Radius for the "boş hücre" suggestion around the player. */
const OPPORTUNITY_RADIUS_M = 1000;

// Shown only until the device reports a position (or when location is off).
const FALLBACK_REGION: Region = { latitude: 41.015, longitude: 28.979, latitudeDelta: 0.08, longitudeDelta: 0.08 };

/** Durations offered for a suggested loop, minutes. */
const ROUTE_MINUTES = [20, 30, 45, 60];

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
  // Region the map starts at. It is used as soon as the map is ready because
  // react-native-maps reports a region only after the camera moves.
  const [initialRegion] = useState<Region>(() =>
    position ? { ...position, latitudeDelta: 0.02, longitudeDelta: 0.02 } : FALLBACK_REGION,
  );
  const [showTerritories, setShowTerritories] = useState(true);
  const [mapReady, setMapReady] = useState(false);
  const [mapTimedOut, setMapTimedOut] = useState(false);
  // Tiles drawn (onMapLoaded). onMapReady fires earlier, while the map is still blank.
  const [mapLoaded, setMapLoaded] = useState(false);
  const [coverOpacity] = useState(() => new Animated.Value(1));
  const [coverGone, setCoverGone] = useState(false);
  const { territories, landmarks, status, retry } = useTerritories(region);
  // Unclaimed cells within 1 km: a nudge towards where a run would gain the most.
  const [showOpportunities, setShowOpportunities] = useState(false);
  const opportunities = useMemo(
    () =>
      status === 'ready' && position ? emptyCellsNear(position, OPPORTUNITY_RADIUS_M, new Set(territories.map(cellKey))) : [],
    [status, position, territories],
  );
  // Smart route: null = closed; otherwise the chosen duration and which option is shown.
  const [routeMinutes, setRouteMinutes] = useState<number | null>(null);
  const [routeIndex, setRouteIndex] = useState(0);
  // Fixed when the card opens so GPS updates don't reshuffle the options.
  const [routeStart, setRouteStart] = useState<LatLng | null>(null);
  const activityType = useSettings((s) => s.preferredActivity);
  // Cells as of when the request was made: the map refetches while it frames the loop,
  // and recomputing then would reshuffle the options.
  const routeInputs = useRef({ territories, landmarks });
  useEffect(() => {
    routeInputs.current = { territories, landmarks };
  }, [territories, landmarks]);
  const routeKey = routeMinutes !== null && routeStart ? `${routeMinutes}:${routeStart.latitude}:${routeStart.longitude}:${activityType}` : null;
  const [routeResult, setRouteResult] = useState<{ key: string; list: RouteSuggestion[] } | null>(null);
  useEffect(() => {
    if (!routeKey || !routeStart || routeMinutes === null) return;
    let cancelled = false;
    void smartRoutes({ start: routeStart, minutes: routeMinutes, type: activityType, ...routeInputs.current })
      .catch(() => [])
      .then((list) => {
        if (!cancelled) setRouteResult({ key: routeKey, list });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- routeKey covers start, minutes and type
  }, [routeKey]);
  const routeLoading = routeKey !== null && routeResult?.key !== routeKey;
  const suggestions = !routeLoading && routeResult ? routeResult.list : [];
  const suggestion = suggestions.length > 0 ? suggestions[routeIndex % suggestions.length] : null;
  // Frame the loop when a different one is shown. Keyed on the loop itself: re-framing on every
  // recompute would move the map, refetch cells and recompute again.
  const fitKey = suggestion ? `${routeMinutes}:${suggestion.bearing}:${suggestion.points.length}:${suggestion.points[1].latitude}` : null;
  const fitPoints = suggestion?.points;
  useEffect(() => {
    if (fitKey && fitPoints) mapRef.current?.fitToCoordinates(fitPoints, { edgePadding: { top: 160, right: 40, bottom: 340, left: 40 }, animated: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fitPoints changes with fitKey
  }, [fitKey]);
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

  // Some devices never report onMapLoaded (e.g. tiles cached); don't cover the map forever.
  useEffect(() => {
    if (!mapReady || mapLoaded) return;
    const t = setTimeout(() => setMapLoaded(true), 4_000);
    return () => clearTimeout(t);
  }, [mapReady, mapLoaded]);

  // Fade the cover out once the map is drawn (instantly with Reduce Motion).
  useEffect(() => {
    if (!(mapLoaded || mapTimedOut) || coverGone) return;
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (cancelled) return;
      Animated.timing(coverOpacity, { toValue: 0, duration: reduce ? 0 : 250, useNativeDriver: true }).start(() => setCoverGone(true));
    });
    return () => {
      cancelled = true;
    };
  }, [mapLoaded, mapTimedOut, coverGone, coverOpacity]);

  // Center on the user once the first fix arrives.
  const centered = useRef(false);
  useEffect(() => {
    if (position && mapReady && !centered.current) {
      centered.current = true;
      const target = { ...position, latitudeDelta: 0.02, longitudeDelta: 0.02 };
      mapRef.current?.animateToRegion(target, 400);
      // No change event comes if the camera is already there; load cells for it now.
      setRegion(target);
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
        initialRegion={initialRegion}
        showsUserLocation={!noPermission}
        // Keep the Apple/Google legal attribution visible above the bottom controls.
        mapPadding={{ top: 0, right: 0, bottom: 140, left: 0 }}
        onMapReady={() => {
          setMapReady(true);
          setRegion((r) => r ?? initialRegion);
        }}
        onMapLoaded={() => setMapLoaded(true)}
        onRegionChangeComplete={(r) => setRegion(r)}
        accessibilityLabel="Çevrendeki oyun alanları: senin bölgelerin düz kenarlı, diğer oyuncuların bölgeleri kesikli kenarlı."
      >
        {showTerritories ? (
          <CellLayer
            cells={territories}
            region={region}
            opportunities={suggestion ? suggestion.targets : showOpportunities ? opportunities : undefined}
          />
        ) : null}
        {suggestion ? (
          <Polyline
            coordinates={suggestion.points}
            strokeColor={colors.primary}
            strokeWidth={suggestion.snapped ? 5 : 4}
            lineDashPattern={suggestion.snapped ? undefined : [10, 8]}
            lineCap="round"
            lineJoin="round"
          />
        ) : null}
        {showTerritories ? <LandmarkMarkers landmarks={landmarks} /> : null}
      </BaseMap>

      {/* Light veil over the map until its tiles are drawn: the map stays visible and usable. */}
      {!coverGone ? (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: coverOpacity, alignItems: 'center', justifyContent: 'center' }]}>
          <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg, opacity: 0.45 }]} />
          <View
            accessibilityRole="progressbar"
            accessibilityLabel="Harita yükleniyor"
            style={[styles.chip, { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 16, backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <ActivityIndicator color={colors.primary} />
            <Txt variant="body" style={{ fontFamily: fonts.bodySemi }}>Harita yükleniyor…</Txt>
          </View>
        </Animated.View>
      ) : null}

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
                {goal.format(goal.done)} / {goal.format(goal.target)}
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
        {coverGone && showTerritories && status === 'loading' && territories.length === 0 && !offline ? (
          <View accessibilityRole="progressbar" style={[styles.chip, { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface, borderColor: colors.border }]}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Txt variant="bodySm" style={{ fontFamily: fonts.bodySemi }}>Hücreler yükleniyor…</Txt>
          </View>
        ) : null}
        {coverGone && showTerritories && opportunities.length > 0 && !offline ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: showOpportunities }}
            accessibilityLabel={`Yakınında ${opportunities.length} boş hücre. ${showOpportunities ? 'Gizlemek' : 'Haritada göstermek'} için dokun.`}
            onPress={() => setShowOpportunities((v) => !v)}
            style={[
              styles.chip,
              {
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                backgroundColor: showOpportunities ? colors.primarySoft : colors.surface,
                borderColor: showOpportunities ? colors.primary : colors.border,
              },
            ]}
          >
            <Icon name="hex" size={18} color={colors.primary} />
            <Txt variant="bodySm" style={{ fontFamily: fonts.bodySemi }}>
              {`Yakınında ${opportunities.length} boş hücre${showOpportunities ? ' · gizle' : ' · göster'}`}
            </Txt>
          </Pressable>
        ) : null}
        {coverGone && showTerritories && status === 'ready' && position && routeMinutes === null && !isRecording && !offline ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Akıllı rota öner: çevrende en çok hücre kazandıracak turu göster"
            onPress={() => {
              setRouteIndex(0);
              setRouteStart(position);
              setRouteMinutes(30);
            }}
            style={[styles.chip, { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <Icon name="route" size={18} color={colors.primary} />
            <Txt variant="bodySm" style={{ fontFamily: fonts.bodySemi }}>Rota öner</Txt>
          </Pressable>
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
        {routeMinutes !== null ? (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Icon name="route" size={22} color={colors.primary} />
              <Txt variant="heading" style={{ flex: 1, fontSize: 17 }}>Akıllı rota</Txt>
              <IconButton icon="close" size={40} label="Rota önerisini kapat" onPress={() => setRouteMinutes(null)} />
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {ROUTE_MINUTES.map((m) => {
                const on = m === routeMinutes;
                return (
                  <Pressable
                    key={m}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={`${m} dakikalık tur`}
                    onPress={() => {
                      setRouteIndex(0);
                      setRouteMinutes(m);
                    }}
                    style={{
                      flex: 1,
                      height: 40,
                      borderRadius: 12,
                      borderWidth: 1,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderColor: on ? colors.primary : colors.border,
                      backgroundColor: on ? colors.primarySoft : colors.surface,
                    }}
                  >
                    <Txt variant="bodySm" style={{ fontFamily: fonts.bodySemi }}>{`${m} dk`}</Txt>
                  </Pressable>
                );
              })}
            </View>
            {routeLoading ? (
              <View accessibilityRole="progressbar" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <ActivityIndicator color={colors.primary} />
                <Txt variant="bodySm" muted>Sokaklara göre rota hazırlanıyor…</Txt>
              </View>
            ) : suggestion ? (
              <View accessible accessibilityLiveRegion="polite" style={{ gap: 4 }}>
                <Txt variant="body" style={{ fontFamily: fonts.bodySemi }}>
                  {`${formatDistance(suggestion.distanceM, units)} · ${compassName(suggestion.bearing)} yönüne tur · tahmini +${suggestion.targets.length} hücre`}
                </Txt>
                <Txt variant="caption" muted>
                  {[
                    suggestion.steals > 0 ? `${suggestion.steals} hücre rakipten` : null,
                    suggestion.landmarks > 0 ? `${suggestion.landmarks} kale` : null,
                    suggestion.snapped
                      ? 'Yürüyüş yollarına göre çizildi; trafiğe ve çevrene dikkat et. Başladığın yere dönersen içerisi de senin.'
                      : 'Kuş uçuşu bir yön önerisi: kesikli çizgiye yakın, güvenli yolları kullan. Başladığın yere dönersen içerisi de senin.',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Txt>
              </View>
            ) : (
              <Txt variant="bodySm" muted>Bu sürede kazanılacak yeni hücre bulunamadı; başka bir süre dene.</Txt>
            )}
            {suggestions.length > 1 ? (
              <Button label={`Başka rota (${(routeIndex % suggestions.length) + 1}/${suggestions.length})`} variant="secondary" size="sm" onPress={() => setRouteIndex((i) => i + 1)} />
            ) : null}
          </View>
        ) : null}
        {!noPermission && !loading && showTerritories && routeMinutes === null ? <MapLegend /> : null}
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

  card: { padding: 18, gap: 12, borderRadius: 18, borderWidth: 1 },
});
