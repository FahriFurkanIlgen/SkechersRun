import { useColorScheme } from 'react-native';
import { useSettings } from '../state/settingsStore';

/**
 * Runner design system v0.1 tokens. "primary" is the brand slot: it is a
 * neutral placeholder blue until an approved brand guide replaces it here.
 * All text pairs are WCAG AA; mine vs. others is encoded by hue, lightness
 * and line style (solid vs. dashed), never by color alone.
 */
const light = {
  bg: '#F3F4F1',
  surface: '#FFFFFF',
  surface2: '#E9ECE7',
  text: '#121619',
  text2: '#4A535B',
  border: '#D0D5CE',
  primary: '#1F4FD1',
  onPrimary: '#FFFFFF',
  primarySoft: '#E4EAFB',
  primaryText: '#1A43B5',
  rival: '#B04408',
  ok: '#1C7443',
  warn: '#7A5000',
  warnSoft: '#FFF2CF',
  danger: '#B3261E',
  dangerSoft: '#FCE8E6',
  disabled: '#E3E6E1',
  onDisabled: '#4A535B',
  switchOff: '#7D868E',
  scrim: 'rgba(18,22,25,0.48)',
  chip: '#FFFFFF',
  // Map layers
  mapLand: '#ECEEE9',
  mapRoad: '#FFFFFF',
  ownStroke: '#1F4FD1',
  ownFill: 'rgba(31,79,209,0.13)',
  rivalStroke: '#B04408',
  rivalFill: 'rgba(176,68,8,0.10)',
  emptyStroke: 'rgba(18,22,25,0.2)',
  route: '#1F4FD1',
  routeCasing: '#FFFFFF',
};

const dark: typeof light = {
  bg: '#0E1113',
  surface: '#171B1F',
  surface2: '#22282D',
  text: '#F0F2F3',
  text2: '#AEB6BD',
  border: '#323A41',
  primary: '#7FA3FF',
  onPrimary: '#0A1330',
  primarySoft: '#1C2848',
  primaryText: '#9DB8FF',
  rival: '#FF9A5C',
  ok: '#5BD08C',
  warn: '#F2C14E',
  warnSoft: '#3A2E10',
  danger: '#FF8A80',
  dangerSoft: '#3B1A18',
  disabled: '#2A3036',
  onDisabled: '#A3ACB4',
  switchOff: '#59626A',
  scrim: 'rgba(0,0,0,0.6)',
  chip: '#323A41',
  mapLand: '#1A1E22',
  mapRoad: '#353D45',
  ownStroke: '#8DAEFF',
  ownFill: 'rgba(127,163,255,0.16)',
  rivalStroke: '#FF9A5C',
  rivalFill: 'rgba(255,154,92,0.12)',
  emptyStroke: 'rgba(220,226,230,0.22)',
  route: '#8DAEFF',
  routeCasing: '#0E1113',
};

export type Theme = typeof light;

/** Archivo (Narrow) for metrics and headings, Instrument Sans for UI text. */
export const fonts = {
  logo: 'Archivo_800ExtraBold',
  display: 'ArchivoNarrow_700Bold',
  displaySemi: 'ArchivoNarrow_600SemiBold',
  body: 'InstrumentSans_400Regular',
  bodyMedium: 'InstrumentSans_500Medium',
  bodySemi: 'InstrumentSans_600SemiBold',
  bodyBold: 'InstrumentSans_700Bold',
} as const;

export const radius = { sm: 10, md: 14, card: 16, sheet: 24, pill: 999 } as const;

export function useTheme(): { colors: Theme; dark: boolean } {
  const system = useColorScheme();
  const pref = useSettings((s) => s.theme);
  const isDark = pref === 'dark' || (pref === 'system' && system === 'dark');
  return { colors: isDark ? dark : light, dark: isDark };
}

export const spacing = (n: number) => n * 4;
