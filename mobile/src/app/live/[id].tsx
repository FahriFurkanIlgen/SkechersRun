import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type MapView from 'react-native-maps';
import { Marker } from 'react-native-maps';
import { BaseMap } from '../../components/RouteMap';
import { Banner, EmptyState, Loading, Txt } from '../../components/ui';
import { ACTIVITY_LABEL, relativeTime } from '../../domain/format';
import { fetchLiveShare, type LiveShareView } from '../../services/liveShare';
import { fonts, radius, useTheme } from '../../theme/theme';

const POLL_MS = 20_000;

/** A friend's live position during their activity (they chose you as a viewer). */
export default function LiveShareScreen() {
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const mapRef = useRef<MapView>(null);
  const [view, setView] = useState<LiveShareView | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const v = await fetchLiveShare(id);
      setView(v);
      setError(null);
      if (v?.position) mapRef.current?.animateToRegion({ ...v.position, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 400);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [id]);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const t = setInterval(() => void load(), POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [load]);

  if (view === undefined) return <Loading label="Konum alınıyor" />;
  if (view === null) {
    return <EmptyState icon="lock" title="Paylaşım bulunamadı" message="Bu canlı konum seninle paylaşılmamış ya da artık yok." />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <BaseMap
        mapRef={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={view.position ? { ...view.position, latitudeDelta: 0.01, longitudeDelta: 0.01 } : undefined}
        accessibilityLabel={`${view.username} adlı kullanıcının canlı konumu`}
      >
        {view.position ? (
          <Marker coordinate={view.position} title={view.username} tracksViewChanges={false}>
            <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: colors.primary, borderWidth: 3, borderColor: colors.surface }} />
          </Marker>
        ) : null}
      </BaseMap>
      <View style={{ position: 'absolute', left: 16, right: 16, bottom: 32, gap: 8 }}>
        {error ? <Banner tone="warning">{error}</Banner> : null}
        <View style={{ padding: 16, gap: 4, borderRadius: radius.card, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
          <Txt variant="body" style={{ fontFamily: fonts.bodySemi }}>{`${view.username} · ${ACTIVITY_LABEL[view.activityType]}`}</Txt>
          <Txt variant="caption" muted>
            {!view.active
              ? 'Aktivite bitti; konum artık paylaşılmıyor.'
              : view.lastAt
                ? `Son konum ${relativeTime(new Date(view.lastAt).toISOString())} · her 20 sn yenilenir`
                : 'Henüz konum gelmedi; GPS bekleniyor.'}
          </Txt>
        </View>
      </View>
    </View>
  );
}
