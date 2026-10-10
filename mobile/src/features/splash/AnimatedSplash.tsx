import { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, useWindowDimensions, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Pattern, Rect } from 'react-native-svg';
import { fonts, useTheme } from '../../theme/theme';

/**
 * Opening animation from the design ("Açılış ekranı" + "Açılış animasyonu" boards):
 * city fades in → the "r" route draws inside the hexagon → location dot pops →
 * four surrounding cells turn into your pattern → name and tagline slide up.
 *
 * Frame 0 equals the native splash (symbol only, centred, 132 pt), so there is
 * no jump when the native splash hides. Plays once. With "reduce motion" the
 * final frame is shown directly. It never loops: if the app is still loading
 * when the timeline ends, the last frame stays until `ready`.
 */

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedG = Animated.createAnimatedComponent(G);
// Measured length of ROUTE in the 100×100 symbol box (20 + ≈26.5 + 4).
const ROUTE_LEN = 52;

const TIMELINE_MS = 2520;
const ENTER = Easing.bezier(0.2, 0.8, 0.2, 1);
const DRAW = Easing.bezier(0.65, 0, 0.35, 1);

const HEX = 'M50,6 88.1,28 88.1,72 50,94 11.9,72 11.9,28Z';
const ROUTE = 'M31,72 V52 C31,41 39,34 50,34 H54';
// Design-space cells (390×844 frame, symbol centred at 195,340).
const EMPTY_CELLS =
  'M80.7,80.0 134.4,111.0 134.4,173.0 80.7,204.0 27.0,173.0 27.0,111.0ZM195.0,80.0 248.7,111.0 248.7,173.0 195.0,204.0 141.3,173.0 141.3,111.0ZM23.6,179.0 77.2,210.0 77.2,272.0 23.6,303.0 -30.1,272.0 -30.1,210.0ZM366.4,179.0 420.1,210.0 420.1,272.0 366.4,303.0 312.8,272.0 312.8,210.0ZM-33.6,278.0 20.1,309.0 20.1,371.0 -33.6,402.0 -87.3,371.0 -87.3,309.0ZM423.6,278.0 477.3,309.0 477.3,371.0 423.6,402.0 369.9,371.0 369.9,309.0ZM80.7,278.0 134.4,309.0 134.4,371.0 80.7,402.0 27.0,371.0 27.0,309.0ZM137.8,179.0 191.5,210.0 191.5,272.0 137.8,303.0 84.2,272.0 84.2,210.0ZM252.2,179.0 305.8,210.0 305.8,272.0 252.2,303.0 198.5,272.0 198.5,210.0ZM309.3,278.0 363.0,309.0 363.0,371.0 309.3,402.0 255.6,371.0 255.6,309.0Z';
const RIVAL_CELL = 'M309.3,80.0 363.0,111.0 363.0,173.0 309.3,204.0 255.6,173.0 255.6,111.0Z';
const OWN_CELLS = [
  'M80.7,278.0 134.4,309.0 134.4,371.0 80.7,402.0 27.0,371.0 27.0,309.0Z',
  'M137.8,179.0 191.5,210.0 191.5,272.0 137.8,303.0 84.2,272.0 84.2,210.0Z',
  'M252.2,179.0 305.8,210.0 305.8,272.0 252.2,303.0 198.5,272.0 198.5,210.0Z',
  'M309.3,278.0 363.0,309.0 363.0,371.0 309.3,402.0 255.6,371.0 255.6,309.0Z',
];

const PALETTE = {
  light: {
    bg: '#FFFFFF', hex: '#1F4FD1', mark: '#FFFFFF', text: '#121619', text2: '#4A535B', street: '#F0F2EE',
    empty: 'rgba(18,22,25,0.16)', own: '#1F4FD1', ownFill: 'rgba(31,79,209,0.10)', ownLine: 'rgba(31,79,209,0.38)',
    rival: '#B04408', rivalFill: 'rgba(176,68,8,0.08)', rivalDot: 'rgba(176,68,8,0.6)',
  },
  dark: {
    bg: '#0E1113', hex: '#7FA3FF', mark: '#0A1330', text: '#F0F2F3', text2: '#AEB6BD', street: '#181D21',
    empty: 'rgba(220,226,230,0.18)', own: '#8DAEFF', ownFill: 'rgba(127,163,255,0.14)', ownLine: 'rgba(141,174,255,0.5)',
    rival: '#FF9A5C', rivalFill: 'rgba(255,154,92,0.10)', rivalDot: 'rgba(255,154,92,0.7)',
  },
};

/** Value that eases from `from` to `to` between t0 and t1 (ms on the design timeline). */
function seg(t: Animated.Value, t0: number, t1: number, from: number, to: number, easing = ENTER) {
  return t.interpolate({ inputRange: [t0, t1], outputRange: [from, to], easing, extrapolate: 'clamp' });
}

export function AnimatedSplash({
  ready,
  speed = 1,
  fontsLoaded,
  onDone,
}: {
  /** App finished bootstrapping; the overlay may leave once the timeline has played. */
  ready: boolean;
  /** 1 = design timing (2.5 s); 0.5 plays twice as fast. */
  speed?: number;
  fontsLoaded: boolean;
  onDone: () => void;
}) {
  const { dark } = useTheme();
  const c = dark ? PALETTE.dark : PALETTE.light;
  const { width, height } = useWindowDimensions();
  // Animated values are created once; useState keeps them stable without reading refs in render.
  const [t] = useState(() => new Animated.Value(0));
  const [fade] = useState(() => new Animated.Value(1));
  const [played, setPlayed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (cancelled) return;
      if (reduce) {
        t.setValue(TIMELINE_MS);
        setPlayed(true);
        return;
      }
      Animated.timing(t, {
        toValue: TIMELINE_MS,
        duration: TIMELINE_MS * speed,
        easing: Easing.linear,
        useNativeDriver: false,
      }).start(() => setPlayed(true));
    });
    return () => {
      cancelled = true;
    };
  }, [t, speed]);

  // Leave with a 250 ms cross-fade once both the timeline and the app are done.
  useEffect(() => {
    if (!played || !ready) return;
    Animated.timing(fade, { toValue: 0, duration: 250, useNativeDriver: true }).start(() => onDone());
  }, [played, ready, fade, onDone]);

  const a = useMemo(
    () => ({
      city: seg(t, 170, 710, 0, 1),
      hexScale: t.interpolate({ inputRange: [0, 290, 630, 920], outputRange: [1, 0.94, 1.03, 1], extrapolate: 'clamp' }),
      route: seg(t, 420, 1260, ROUTE_LEN, 0, DRAW),
      routeOpacity: seg(t, 410, 420, 0, 1),
      dotR: t.interpolate({ inputRange: [1180, 1430, 1680], outputRange: [0, 7.5 * 1.35, 7.5], extrapolate: 'clamp' }),
      ringR: seg(t, 1390, 2180, 7.5, 21),
      ringOpacity: t.interpolate({ inputRange: [1380, 1470, 2180], outputRange: [0, 0.7, 0], extrapolate: 'clamp' }),
      cells: OWN_CELLS.map((_, i) => seg(t, 1430 + i * 120, 1810 + i * 120, 0, 1)),
      word: seg(t, 1680, 2180, 0, 1),
      wordY: seg(t, 1680, 2180, 14, 0),
      tag: seg(t, 1970, 2520, 0, 1),
      tagY: seg(t, 1970, 2520, 8, 0),
    }),
    [t],
  );

  // Symbol centred like the native splash; the rest of the design frame hangs off it.
  const cx = width / 2;
  const cy = height / 2;
  const symbol = 132;

  return (
    <Animated.View
      accessible
      accessibilityLabel="Runner açılıyor. Şehrin senin oyun alanın."
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: c.bg, opacity: fade, zIndex: 10 }]}
    >
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Pattern id="spOwn" width={9} height={9} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <Rect width={9} height={9} fill={c.ownFill} />
          <Line x1={0} y1={0} x2={0} y2={9} stroke={c.ownLine} strokeWidth={2.5} />
        </Pattern>
        <Pattern id="spRival" width={10} height={10} patternUnits="userSpaceOnUse">
          <Rect width={10} height={10} fill={c.rivalFill} />
          <Circle cx={5} cy={5} r={1.6} fill={c.rivalDot} />
        </Pattern>
        <G transform={`translate(${cx - 195} ${cy - 340})`}>
          <AnimatedG opacity={a.city}>
            <G stroke={c.street} strokeLinecap="round" fill="none">
              <Path d="M-200,620 L600,520" strokeWidth={22} />
              <Path d="M-200,150 H600 M-200,445 H600 M-200,740 H600 M64,-300 V1200 M326,-300 V1200 M195,520 V1200" strokeWidth={12} />
            </G>
            <Path d={EMPTY_CELLS} fill="none" stroke={c.empty} strokeWidth={1.5} strokeDasharray="4 5" strokeLinejoin="round" />
            <Path d={RIVAL_CELL} fill="url(#spRival)" stroke={c.rival} strokeWidth={2} strokeDasharray="7 5" strokeLinejoin="round" />
          </AnimatedG>
          {OWN_CELLS.map((d, i) => (
            <AnimatedPath key={d} d={d} opacity={a.cells[i]} fill="url(#spOwn)" stroke={c.own} strokeWidth={2.5} strokeLinejoin="round" />
          ))}
        </G>
      </Svg>

      <Animated.View
        style={{ position: 'absolute', left: cx - symbol / 2, top: cy - symbol / 2, width: symbol, height: symbol, transform: [{ scale: a.hexScale }] }}
      >
        <Svg width={symbol} height={symbol} viewBox="0 0 100 100">
          <Path d={HEX} fill={c.hex} stroke={c.hex} strokeWidth={8} strokeLinejoin="round" />
          <AnimatedPath
            d={ROUTE}
            fill="none"
            stroke={c.mark}
            strokeWidth={11}
            strokeLinecap="round"
            strokeLinejoin="round"
            // Gap longer than the path so no second dash (and its round cap) appears at the end.
            strokeDasharray={`${ROUTE_LEN} ${ROUTE_LEN * 3}`}
            strokeDashoffset={a.route}
            opacity={a.routeOpacity}
          />
          <AnimatedCircle cx={66} cy={34} r={a.ringR} fill="none" stroke={c.mark} strokeWidth={2.5} opacity={a.ringOpacity} />
          <AnimatedCircle cx={66} cy={34} r={a.dotR} fill={c.mark} />
        </Svg>
      </Animated.View>

      {fontsLoaded ? (
        <View style={{ position: 'absolute', left: 0, right: 0, top: cy + 106, alignItems: 'center', gap: 12 }}>
          <Animated.Text
            style={{
              fontFamily: fonts.logo,
              fontSize: 64,
              lineHeight: 68,
              letterSpacing: -1.2,
              color: c.text,
              opacity: a.word,
              transform: [{ translateY: a.wordY }],
            }}
          >
            Runner
          </Animated.Text>
          <Animated.Text
            style={{ fontFamily: fonts.bodySemi, fontSize: 19, color: c.text2, opacity: a.tag, transform: [{ translateY: a.tagY }] }}
          >
            Şehrin senin oyun alanın.
          </Animated.Text>
        </View>
      ) : null}
    </Animated.View>
  );
}

