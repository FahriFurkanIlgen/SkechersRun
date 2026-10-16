import { useEffect, useMemo, useRef } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import MapView, { Marker, Polygon, Polyline, type MapViewProps } from 'react-native-maps';
import Svg, { Circle, Pattern, Polyline as SvgPolyline, Rect } from 'react-native-svg';
import { regionForPoints, type LatLng, type Region } from '../domain/geo';
import { cellCenter, cellKey, cellRing, cellsInBounds, type Cell } from '../domain/hex';
import { segments } from '../domain/metrics';
import type { Landmark, RoutePoint, TerritoryCell } from '../domain/types';
import { fonts, useTheme } from '../theme/theme';
import { Icon } from './Icon';
import { Txt } from './ui';

/** MapView with the design's muted base style and theme-aware appearance. */
export function BaseMap({ mapRef, ...props }: MapViewProps & { mapRef?: React.Ref<MapView> }) {
  const { dark } = useTheme();
  return (
    <MapView
      ref={mapRef}
      mapType={Platform.OS === 'ios' ? 'mutedStandard' : 'standard'}
      userInterfaceStyle={dark ? 'dark' : 'light'}
      showsPointsOfInterests={false}
      showsBuildings={false}
      pitchEnabled={false}
      toolbarEnabled={false}
      showsMyLocationButton={false}
      {...props}
    />
  );
}

/** Route polyline (white casing + brand line), split at pauses. */
export function RouteLines({ points }: { points: RoutePoint[] }) {
  const { colors } = useTheme();
  const parts = useMemo(() => segments(points), [points]);
  return (
    <>
      {parts.map((seg, i) => (
        <Polyline key={`c${i}`} coordinates={seg} strokeColor={colors.routeCasing} strokeWidth={9} lineCap="round" lineJoin="round" />
      ))}
      {parts.map((seg, i) => (
        <Polyline key={`r${i}`} coordinates={seg} strokeColor={colors.route} strokeWidth={5} lineCap="round" lineJoin="round" />
      ))}
    </>
  );
}

/** Route map; `follow` keeps the camera on the latest point, otherwise fits the route. */
export function RouteMap({
  points,
  follow = false,
  showsUserLocation = false,
  style,
  accessibilityLabel,
  edgePaddingBottom = 0,
  cells,
}: {
  /** Estimated cells to highlight on the route (summary / live screens). */
  cells?: Cell[];
  points: RoutePoint[];
  follow?: boolean;
  showsUserLocation?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel: string;
  edgePaddingBottom?: number;
}) {
  const ref = useRef<MapView>(null);
  const last = points[points.length - 1];

  useEffect(() => {
    if (follow && last) {
      ref.current?.animateCamera({ center: { latitude: last.latitude, longitude: last.longitude } }, { duration: 500 });
    }
  }, [follow, last]);

  useEffect(() => {
    if (!follow && points.length > 1) {
      ref.current?.fitToCoordinates(points, {
        edgePadding: { top: 60, right: 40, bottom: 40 + edgePaddingBottom, left: 40 },
        animated: false,
      });
    }
  }, [follow, points, edgePaddingBottom]);

  return (
    <View style={style ?? StyleSheet.absoluteFill} accessible accessibilityLabel={accessibilityLabel}>
      <BaseMap
        mapRef={ref}
        style={StyleSheet.absoluteFill}
        initialRegion={regionForPoints(points) ?? undefined}
        showsUserLocation={showsUserLocation}
      >
        {cells?.length ? <CellLayer cells={[]} highlight={cells} /> : null}
        <RouteLines points={points} />
      </BaseMap>
    </View>
  );
}

/** Above this zoom-out level the empty grid is not drawn (too many cells). */
const EMPTY_GRID_MAX_DELTA = 0.025;

/**
 * Hexagon cells per the design's map layer: mine = solid edge + stronger fill,
 * others = dashed edge + lighter fill, empty = thin dashed outline (only when
 * zoomed in). `highlight` marks cells won by the current activity (thicker edge).
 */
export function CellLayer({
  cells,
  region,
  highlight,
  opportunities,
}: {
  cells: TerritoryCell[];
  region?: Region | null;
  highlight?: Cell[];
  /** Unclaimed cells near the player, shown softly filled to invite a route. */
  opportunities?: Cell[];
}) {
  const { colors } = useTheme();
  const owned = useMemo(() => new Set(cells.map(cellKey)), [cells]);
  const empty = useMemo(() => {
    if (!region || region.latitudeDelta > EMPTY_GRID_MAX_DELTA) return [];
    const min = { latitude: region.latitude - region.latitudeDelta / 2, longitude: region.longitude - region.longitudeDelta / 2 };
    const max = { latitude: region.latitude + region.latitudeDelta / 2, longitude: region.longitude + region.longitudeDelta / 2 };
    return cellsInBounds(min, max).filter((c) => !owned.has(cellKey(c))).slice(0, 400);
  }, [region, owned]);
  return (
    <>
      {empty.map((c) => (
        <Polygon
          key={`e${cellKey(c)}`}
          coordinates={cellRing(c)}
          fillColor="transparent"
          strokeColor={colors.emptyStroke}
          strokeWidth={0.75}
          lineDashPattern={[2, 3]}
        />
      ))}
      {opportunities?.map((c) => (
        <Polygon
          key={`f${cellKey(c)}`}
          coordinates={cellRing(c)}
          fillColor={colors.primarySoft}
          strokeColor={colors.primary}
          strokeWidth={1}
          lineDashPattern={[3, 3]}
        />
      ))}
      {cells.map((c) => (
        <Polygon
          key={`o${cellKey(c)}${c.weak ? 'w' : ''}`}
          coordinates={cellRing(c)}
          // Weak (unvisited) cells fade: no fill, thinner dotted outline.
          fillColor={c.weak ? 'transparent' : c.isMine ? colors.ownFill : colors.rivalFill}
          strokeColor={c.isMine ? colors.ownStroke : colors.rivalStroke}
          strokeWidth={c.weak ? 1.5 : c.isMine ? 2.5 : 2}
          lineDashPattern={c.weak ? [2, 4] : c.isMine ? undefined : [6, 4]}
        />
      ))}
      {highlight?.map((c) => (
        <Polygon
          key={`h${cellKey(c)}`}
          coordinates={cellRing(c)}
          fillColor={colors.ownFill}
          strokeColor={colors.ownStroke}
          strokeWidth={3.5}
        />
      ))}
    </>
  );
}

/** Legend swatches encode ownership by pattern and edge style, not only color. */
/** Landmark ("kale") cells: a flag pin; filled when it is yours. */
export function LandmarkMarkers({ landmarks }: { landmarks: Landmark[] }) {
  const { colors } = useTheme();
  return (
    <>
      {landmarks.map((l) => (
        <Marker
          key={`l${l.q}:${l.r}:${l.isMine ? 1 : 0}`}
          coordinate={cellCenter(l)}
          tracksViewChanges={false}
          anchor={{ x: 0.5, y: 0.5 }}
          title={l.name}
          description={l.isMine ? 'Senin kalen · +5 sezon puanı' : l.ownerUsername ? `Sahibi: ${l.ownerUsername}` : 'Boş kale · alırsan +5 sezon puanı'}
          accessibilityLabel={`Kale: ${l.name}${l.isMine ? ', senin' : l.ownerUsername ? `, sahibi ${l.ownerUsername}` : ', boş'}`}
        >
          <View
            style={{
              width: 30,
              height: 30,
              borderRadius: 15,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: l.isMine ? colors.primary : colors.surface,
              borderWidth: 2,
              borderColor: l.isMine ? colors.surface : l.ownerUsername ? colors.rivalStroke : colors.primary,
            }}
          >
            <Icon name="quests" size={16} color={l.isMine ? colors.onPrimary : colors.text} />
          </View>
        </Marker>
      ))}
    </>
  );
}

export function MapLegend() {
  const { colors } = useTheme();
  const item = (swatch: React.ReactNode, label: string) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      {swatch}
      <Txt variant="caption" style={{ fontFamily: fonts.bodySemi }}>{label}</Txt>
    </View>
  );
  return (
    <View
      accessible
      accessibilityLabel="Harita göstergesi: senin bölgen çizgili ve düz kenarlı, diğer oyuncuların bölgeleri noktalı ve kesikli kenarlı, renksiz alanlar boş."
      style={[styles.legend, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      {item(
        <Svg width={18} height={18} viewBox="0 0 18 18">
          <Pattern id="lgOwn" width={5} height={5} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <Rect x={0} y={0} width={2} height={5} fill={colors.ownStroke} />
          </Pattern>
          <Rect x={1} y={1} width={16} height={16} rx={3} fill="url(#lgOwn)" stroke={colors.ownStroke} strokeWidth={2} />
        </Svg>,
        'Senin',
      )}
      {item(
        <Svg width={18} height={18} viewBox="0 0 18 18">
          <Rect x={1} y={1} width={16} height={16} rx={3} fill="none" stroke={colors.rivalStroke} strokeWidth={2} strokeDasharray="4 2.5" />
          <Circle cx={6} cy={6} r={1.5} fill={colors.rivalStroke} />
          <Circle cx={12} cy={6} r={1.5} fill={colors.rivalStroke} />
          <Circle cx={6} cy={12} r={1.5} fill={colors.rivalStroke} />
          <Circle cx={12} cy={12} r={1.5} fill={colors.rivalStroke} />
        </Svg>,
        'Diğerleri',
      )}
      {item(
        <Svg width={18} height={18} viewBox="0 0 18 18">
          <Rect x={1} y={1} width={16} height={16} rx={3} fill="none" stroke={colors.text2} strokeWidth={1.5} strokeDasharray="2.5 2.5" />
        </Svg>,
        'Boş',
      )}
    </View>
  );
}

/**
 * Lightweight route drawing without map tiles, for feed cards and lists.
 * Receives an already privacy-trimmed route.
 */
export function RoutePreview({ coords, height = 128, label }: { coords: LatLng[]; height?: number; label: string }) {
  const { colors } = useTheme();
  const width = 330;
  const pts = useMemo(() => {
    if (coords.length < 2) return '';
    const lats = coords.map((c) => c.latitude);
    const lngs = coords.map((c) => c.longitude);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const k = Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180));
    const spanX = Math.max((maxLng - minLng) * k, 1e-6);
    const spanY = Math.max(maxLat - minLat, 1e-6);
    const pad = 14;
    const scale = Math.min((width - 2 * pad) / spanX, (height - 2 * pad) / spanY);
    const offX = (width - spanX * scale) / 2;
    const offY = (height - spanY * scale) / 2;
    return coords
      .map((c) => `${(offX + (c.longitude - minLng) * k * scale).toFixed(1)},${(offY + (maxLat - c.latitude) * scale).toFixed(1)}`)
      .join(' ');
  }, [coords, height]);
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} style={{ height, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.mapLand }}>
      <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
        <SvgPolyline points={pts} fill="none" stroke={colors.routeCasing} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" />
        <SvgPolyline points={pts} fill="none" stroke={colors.route} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  legend: {
    flexDirection: 'row',
    gap: 14,
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
});
