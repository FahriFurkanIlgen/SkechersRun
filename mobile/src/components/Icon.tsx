import Svg, { Circle, Path, Rect } from 'react-native-svg';

/** Stroke icons from the Runner design system (24 px grid, round caps). */
const PATHS = {
  map: 'M9 4 3 6.5V20l6-2.5 6 2.5 6-2.5V4l-6 2.5L9 4zM9 4v13.5M15 6.5V20',
  feed: 'M4 6h16M4 12h10M4 18h13',
  quests: 'M5 21V4M5 4h11l-2 4 2 4H5',
  rank: 'M9 20V9h6v11M3 20v-6h6M15 20v-8h6v8M2 20h20',
  profile: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5',
  layers: 'M12 3 2 8.5 12 14l10-5.5L12 3zM2 13.5 12 19l10-5.5',
  locateRays: 'M12 1v3M12 20v3M1 12h3M20 12h3',
  offline:
    'M2 2l20 20M8.5 16.5a5 5 0 0 1 7 0M5 12.5a10 10 0 0 1 4.5-2.6M19 12.5a10 10 0 0 0-2.2-1.6M2 8.8a15 15 0 0 1 4.2-2.6M22 8.8A15 15 0 0 0 11 5',
  pin: 'M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z',
  pinOff: 'M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12zM4 4l16 16',
  close: 'M6 6l12 12M18 6 6 18',
  hex: 'M20 8.5v7L12 20l-8-4.5v-7L12 4z',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  checkCircle: 'm7.5 12.5 3 3 6-6.5',
  walk: 'M13 4.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM10 22l2-7-2.5-3 1-4.5 3 3 3 1M12 15l3 7M9.5 8.5 7 13',
  run: 'M15 4.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM5 21l4-6 3.5 2.5V22M7 11l3-3.5 4 1 2.5 3H20M12.5 17.5 10.5 13l2-4.5',
  ride: 'M5.5 20a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM18.5 20a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM5.5 16.5 9 9h6l3.5 7.5M9 9l3 7.5h-6.5M13.5 6H16',
  lock: 'M6 11V8a6 6 0 0 1 12 0v3M5 11h14v10H5z',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c0-3.3 2.9-5.5 6.5-5.5s6.5 2.2 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14.8c2 .6 3.5 2.4 3.5 5.2',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z',
  sound: 'M4 9v6h4l5 4V5L8 9H4zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12',
  vibrate: 'M8 3h8v18H8zM4 8v8M20 8v8M1.5 10v4M22.5 10v4',
  back: 'M15 5l-7 7 7 7',
  chevronRight: 'm9 5 7 7-7 7',
  chevronDown: 'm6 9 6 6 6-6',
  medal: 'M8.5 3h7L13 9.2M8.5 3 11 9.2M12 12.5v5M10.5 13.5 12 12.5M12 21a6 6 0 1 0 0-12 6 6 0 0 0 0 12z',
  alert: 'M12 3 2 20h20L12 3zM12 10v4.5M12 17.5v.01',
  share: 'M12 15V3M7.5 7.5 12 3l4.5 4.5M5 12v8h14v-8',
  settings: 'M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  shoe: 'M3 17h13l5-2v-2l-6-1-3-5H8L6 12H3z',
  addUser: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c0-3.3 2.9-5.5 6.5-5.5s6.5 2.2 6.5 5.5M19 8v6M16 11h6',
  heart: 'M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 7.5 2.8C19.5 15.4 12 20 12 20z',
  shield: 'M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6l-8-3zM12 8.5v4.5M12 16v.01',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  route: 'M4 19c4 0 3-7 8-7s4-7 8-7',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4l2-2zM10 21h4',
  arrowUp: 'M12 19V5M6 11l6-6 6 6',
  arrowDown: 'M12 5v14M6 13l6 6 6-6',
  minus: 'M5 12h14',
  plus: 'M12 5v14M5 12h14',
  download: 'M12 3v12M7.5 10.5 12 15l4.5-4.5M5 20h14',
} as const;

export type IconName = keyof typeof PATHS | 'play' | 'pause' | 'stop' | 'locate';

export function Icon({
  name,
  size = 24,
  color,
  strokeWidth = 2,
  fill = 'none',
}: {
  name: IconName;
  size?: number;
  color: string;
  strokeWidth?: number;
  fill?: string;
}) {
  if (name === 'play') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z" fill={color} />
      </Svg>
    );
  }
  if (name === 'pause') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Rect x={5} y={4} width={5} height={16} rx={1.5} fill={color} />
        <Rect x={14} y={4} width={5} height={16} rx={1.5} fill={color} />
      </Svg>
    );
  }
  if (name === 'stop') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Rect x={5} y={5} width={14} height={14} rx={2.5} fill={color} />
      </Svg>
    );
  }
  if (name === 'locate') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round">
        <Circle cx={12} cy={12} r={7} />
        <Circle cx={12} cy={12} r={2.5} fill={color} />
        <Path d={PATHS.locateRays} />
      </Svg>
    );
  }
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d={PATHS[name]} />
    </Svg>
  );
}

/** GPS strength as 4 bars; unfilled bars are outlined so the level does not rely on color. */
export function SignalBars({ level, color, size = 22 }: { level: 0 | 1 | 2 | 3 | 4; color: string; size?: number }) {
  const bars = [
    { x: 1, y: 15, h: 6 },
    { x: 8, y: 10, h: 11 },
    { x: 15, y: 5, h: 16 },
    { x: 22, y: 0, h: 21 },
  ];
  return (
    <Svg width={(size * 26) / 22} height={size} viewBox="0 0 26 22">
      {bars.map((b, i) => (
        <Rect
          key={i}
          x={b.x}
          y={b.y}
          width={4}
          height={b.h}
          rx={1}
          fill={i < level ? color : 'none'}
          stroke={i < level ? undefined : color}
          strokeWidth={i < level ? 0 : 1.5}
        />
      ))}
    </Svg>
  );
}
