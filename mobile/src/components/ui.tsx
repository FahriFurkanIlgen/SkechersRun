/** Runner design-system components (see the "Tasarım sistemi" board). */
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { fonts, radius, spacing, useTheme } from '../theme/theme';
import { Icon, type IconName } from './Icon';

// ---- Layout -------------------------------------------------------------------

export function Screen({
  children,
  scroll = true,
  edges = ['top'],
  background = 'bg',
  contentStyle,
}: {
  children: ReactNode;
  scroll?: boolean;
  edges?: Edge[];
  background?: 'bg' | 'surface';
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: colors[background] }}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={[{ padding: spacing(4), paddingBottom: spacing(8), gap: spacing(4) }, contentStyle]}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, contentStyle]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: radius.card,
          padding: spacing(4),
          gap: spacing(3),
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

// ---- Typography ---------------------------------------------------------------

type Variant = 'logo' | 'metricXL' | 'metricL' | 'metricM' | 'title' | 'heading' | 'body' | 'bodySm' | 'caption' | 'label';

const VARIANT: Record<Variant, TextStyle> = {
  logo: { fontFamily: fonts.logo, fontSize: 26, letterSpacing: -0.3 },
  metricXL: { fontFamily: fonts.display, fontSize: 64, lineHeight: 68, fontVariant: ['tabular-nums'] },
  metricL: { fontFamily: fonts.display, fontSize: 32, lineHeight: 38, fontVariant: ['tabular-nums'] },
  metricM: { fontFamily: fonts.display, fontSize: 28, lineHeight: 34, fontVariant: ['tabular-nums'] },
  title: { fontFamily: fonts.display, fontSize: 28, lineHeight: 32 },
  heading: { fontFamily: fonts.bodyBold, fontSize: 18, lineHeight: 24 },
  body: { fontFamily: fonts.body, fontSize: 16, lineHeight: 23 },
  bodySm: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20 },
  caption: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18 },
  label: { fontFamily: fonts.bodySemi, fontSize: 14, lineHeight: 19 },
};

export function Txt({
  variant = 'body',
  color,
  muted,
  style,
  children,
  ...rest
}: {
  variant?: Variant;
  color?: string;
  muted?: boolean;
  style?: StyleProp<TextStyle>;
  children: ReactNode;
} & React.ComponentProps<typeof Text>) {
  const { colors } = useTheme();
  const isHeader = variant === 'title' || variant === 'heading';
  return (
    <Text
      accessibilityRole={isHeader ? 'header' : undefined}
      style={[VARIANT[variant], { color: color ?? (muted ? colors.text2 : colors.text) }, style]}
      {...rest}
    >
      {children}
    </Text>
  );
}

/** Metric value with a smaller unit, e.g. "4,12 km". */
export function Metric({
  value,
  unit,
  size = 'L',
  color,
}: {
  value: string;
  unit?: string;
  size?: 'XL' | 'L' | 'M';
  color?: string;
}) {
  const unitSize = size === 'XL' ? 22 : 16;
  return (
    <Txt variant={size === 'XL' ? 'metricXL' : size === 'L' ? 'metricL' : 'metricM'} color={color} numberOfLines={1} adjustsFontSizeToFit>
      {value}
      {unit ? <Text style={{ fontFamily: fonts.displaySemi, fontSize: unitSize }}> {unit}</Text> : null}
    </Txt>
  );
}

// ---- Buttons ------------------------------------------------------------------

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  disabled,
  loading,
  accessibilityLabel,
  accessibilityHint,
  onLongPress,
  delayLongPress,
  style,
}: {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'text' | 'danger' | 'tonal';
  size?: 'lg' | 'md' | 'sm';
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  onLongPress?: () => void;
  delayLongPress?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const height = size === 'lg' ? 64 : size === 'md' ? 56 : 44;
  const fontSize = size === 'lg' ? 19 : size === 'md' ? 17 : 15;
  let bg = 'transparent';
  let fg = colors.primaryText;
  let borderColor = 'transparent';
  if (disabled) {
    bg = variant === 'text' ? 'transparent' : colors.disabled;
    fg = colors.onDisabled;
  } else if (variant === 'primary') {
    bg = colors.primary;
    fg = colors.onPrimary;
  } else if (variant === 'secondary') {
    fg = colors.text;
    borderColor = colors.text;
  } else if (variant === 'danger') {
    fg = colors.danger;
  } else if (variant === 'tonal') {
    bg = colors.primarySoft;
    fg = colors.primaryText;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled || !!loading, busy: !!loading }}
      disabled={disabled || loading}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={delayLongPress}
      style={({ pressed }) => [
        {
          minHeight: variant === 'text' ? 48 : height,
          borderRadius: radius.pill,
          backgroundColor: bg,
          borderWidth: variant === 'secondary' ? 2 : 0,
          borderColor,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: spacing(2),
          paddingHorizontal: spacing(5),
          opacity: pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon ? <Icon name={icon} size={size === 'lg' ? 22 : 20} color={fg} strokeWidth={2.2} /> : null}
          <Text style={{ color: fg, fontSize, fontFamily: fonts.bodyBold }}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

export function IconButton({
  icon,
  label,
  onPress,
  size = 44,
  style,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        {
          width: size,
          height: size,
          borderRadius: size >= 48 ? radius.md : size / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
          opacity: pressed ? 0.8 : 1,
        },
        style,
      ]}
    >
      <Icon name={icon} size={22} color={colors.text} />
    </Pressable>
  );
}

// ---- Selection controls -----------------------------------------------------------

export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; icon?: IconName }[];
  onChange: (v: T) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: spacing(2) }}>
      {label ? <Txt variant="label" muted>{label}</Txt> : null}
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={label}
        style={{ flexDirection: 'row', gap: 4, padding: 4, borderRadius: radius.md, backgroundColor: colors.surface2 }}
      >
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <Pressable
              key={String(o.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={o.label}
              onPress={() => onChange(o.value)}
              style={{
                flex: 1,
                minHeight: 44,
                flexDirection: 'row',
                gap: 6,
                alignItems: 'center',
                justifyContent: 'center',
                paddingHorizontal: 6,
                borderRadius: radius.sm,
                backgroundColor: selected ? colors.chip : 'transparent',
              }}
            >
              {o.icon ? <Icon name={o.icon} size={16} color={colors.text} /> : null}
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                style={{ color: colors.text, fontSize: 14, fontFamily: selected ? fonts.bodyBold : fonts.bodyMedium }}
              >
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function Chips<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; icon?: IconName }[];
  onChange: (v: T) => void;
}) {
  const { colors } = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityLabel={label}
      contentContainerStyle={{ gap: spacing(2) }}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onChange(o.value)}
            style={{
              height: 40,
              paddingHorizontal: 14,
              borderRadius: 20,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              backgroundColor: selected ? colors.text : colors.surface,
              borderWidth: 1,
              borderColor: selected ? colors.text : colors.border,
            }}
          >
            {o.icon ? <Icon name={o.icon} size={16} color={selected ? colors.bg : colors.text} /> : null}
            <Text style={{ fontSize: 14, fontFamily: fonts.bodyBold, color: selected ? colors.bg : colors.text }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function SwitchRow({
  label,
  sub,
  value,
  onChange,
  disabled,
  last,
}: {
  label: string;
  sub?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  last?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.row, { borderBottomColor: last ? 'transparent' : colors.border }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="body" style={{ fontFamily: fonts.bodySemi }}>{label}</Txt>
        {sub ? <Txt variant="caption" muted>{sub}</Txt> : null}
      </View>
      <Switch
        accessibilityLabel={label}
        accessibilityHint={sub}
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ true: colors.primary, false: colors.switchOff }}
        thumbColor="#FFFFFF"
        ios_backgroundColor={colors.switchOff}
      />
    </View>
  );
}

export function NavRow({
  label,
  sub,
  value,
  onPress,
  icon,
  danger,
  last,
  right,
}: {
  label: string;
  sub?: string;
  value?: string;
  onPress?: () => void;
  icon?: IconName;
  danger?: boolean;
  last?: boolean;
  right?: ReactNode;
}) {
  const { colors } = useTheme();
  const fg = danger ? colors.danger : colors.text;
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={[label, value, sub].filter(Boolean).join(', ')}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.row, { borderBottomColor: last ? 'transparent' : colors.border, opacity: pressed ? 0.7 : 1 }]}
    >
      {icon ? <Icon name={icon} size={22} color={fg} /> : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="body" color={fg} style={{ fontFamily: fonts.bodySemi }}>{label}</Txt>
        {sub ? <Txt variant="caption" muted>{sub}</Txt> : null}
      </View>
      {value ? <Txt variant="bodySm" muted>{value}</Txt> : null}
      {right}
      {onPress && !danger && !right ? <Icon name="chevronRight" size={20} color={colors.text2} /> : null}
    </Pressable>
  );
}

/** Grouped list container used by settings-style screens. */
export function Group({ title, children }: { title?: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: spacing(2) }}>
      {title ? <Txt variant="heading" style={{ fontSize: 17 }}>{title}</Txt> : null}
      <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing(4) }}>
        {children}
      </View>
    </View>
  );
}

// ---- Feedback -----------------------------------------------------------------

export function Banner({
  tone = 'info',
  title,
  children,
  action,
  icon,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'success';
  title?: string;
  children?: ReactNode;
  action?: { label: string; onPress: () => void };
  icon?: IconName;
}) {
  const { colors } = useTheme();
  const map = {
    info: { bg: colors.primarySoft, border: colors.primarySoft, icon: colors.primaryText, name: 'shield' as IconName },
    success: { bg: colors.primarySoft, border: colors.primarySoft, icon: colors.primaryText, name: 'check' as IconName },
    warning: { bg: colors.warnSoft, border: colors.warn, icon: colors.warn, name: 'alert' as IconName },
    danger: { bg: colors.dangerSoft, border: colors.danger, icon: colors.danger, name: 'alert' as IconName },
  }[tone];
  return (
    <View
      accessibilityRole={tone === 'danger' || tone === 'warning' ? 'alert' : undefined}
      style={{ backgroundColor: map.bg, borderColor: map.border, borderWidth: 1, borderRadius: radius.md, padding: 14, gap: 10 }}
    >
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
        <Icon name={icon ?? map.name} size={22} color={map.icon} />
        <View style={{ flex: 1, gap: 2 }}>
          {title ? <Txt variant="body" style={{ fontFamily: fonts.bodyBold, fontSize: 15 }}>{title}</Txt> : null}
          {children ? (
            typeof children === 'string' ? <Txt variant="bodySm" muted={!!title}>{children}</Txt> : children
          ) : null}
        </View>
      </View>
      {action ? <Button label={action.label} onPress={action.onPress} variant="secondary" size="sm" style={{ alignSelf: 'flex-start' }} /> : null}
    </View>
  );
}

export function EmptyState({
  icon = 'route',
  title,
  message,
  action,
  secondary,
}: {
  icon?: IconName;
  title: string;
  message?: string;
  action?: { label: string; onPress: () => void };
  secondary?: { label: string; onPress: () => void };
}) {
  const { colors } = useTheme();
  return (
    <View style={{ alignItems: 'center', gap: spacing(3), paddingVertical: spacing(8), paddingHorizontal: spacing(4) }}>
      <View style={{ width: 88, height: 88, borderRadius: 24, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={44} color={colors.primaryText} strokeWidth={1.8} />
      </View>
      <Txt variant="title" style={{ textAlign: 'center' }}>{title}</Txt>
      {message ? <Txt variant="body" muted style={{ textAlign: 'center' }}>{message}</Txt> : null}
      {action ? <Button label={action.label} onPress={action.onPress} style={{ alignSelf: 'stretch' }} /> : null}
      {secondary ? <Button label={secondary.label} onPress={secondary.onPress} variant="text" /> : null}
    </View>
  );
}

export function Loading({ label = 'Yükleniyor' }: { label?: string }) {
  const { colors } = useTheme();
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={label} style={{ padding: spacing(8), alignItems: 'center', gap: spacing(3) }}>
      <ActivityIndicator color={colors.primary} />
      <Txt variant="bodySm" muted>{label}…</Txt>
    </View>
  );
}

// ---- Data display --------------------------------------------------------------

export function Stat({
  label,
  value,
  unit,
  accessibilityValue,
  color,
}: {
  label: string;
  value: string;
  unit?: string;
  accessibilityValue?: string;
  color?: string;
}) {
  const { colors } = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${accessibilityValue ?? `${value} ${unit ?? ''}`}`}
      style={{ flexBasis: '45%', flexGrow: 1, paddingVertical: 10, paddingHorizontal: 14, backgroundColor: colors.bg, borderRadius: 12, gap: 2 }}
    >
      <Metric value={value} unit={unit} size="L" color={color} />
      <Txt variant="caption" muted style={{ fontFamily: fonts.bodySemi }}>{label}</Txt>
    </View>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing(2) }}>{children}</View>;
}

export function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  const { colors } = useTheme();
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: Math.round(max * 10) / 10, now: Math.round(value * 10) / 10 }}
      style={{ height: 10, borderRadius: 5, backgroundColor: colors.surface2, overflow: 'hidden' }}
    >
      <View style={{ width: `${pct * 100}%`, height: '100%', borderRadius: 5, backgroundColor: colors.primary }} />
    </View>
  );
}

export function ProgressRing({
  value,
  size = 40,
  stroke = 5,
  label,
  children,
}: {
  value: number;
  size?: number;
  stroke?: number;
  label: string;
  children?: ReactNode;
}) {
  const { colors } = useTheme();
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value));
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.surface2} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={colors.primary}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      {children}
    </View>
  );
}

export function Avatar({ name, size = 40, highlight }: { name: string; size?: number; highlight?: boolean }) {
  const { colors } = useTheme();
  const initials = name
    .replace(/[_.]/g, ' ')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toLocaleUpperCase('tr-TR'))
    .join('');
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: highlight ? colors.primary : colors.surface2,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ fontFamily: fonts.bodyBold, fontSize: size * 0.36, color: highlight ? colors.onPrimary : colors.text }}>{initials || '?'}</Text>
    </View>
  );
}

export function Field(props: TextInputProps & { label: string; hint?: string }) {
  const { colors } = useTheme();
  const { label, hint, style, ...rest } = props;
  return (
    <View style={{ gap: spacing(1) }}>
      <Txt variant="label" muted>{label}</Txt>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={hint}
        placeholderTextColor={colors.text2}
        style={[
          {
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.surface,
            borderRadius: radius.md,
            paddingHorizontal: spacing(4),
            fontSize: 16,
            fontFamily: fonts.body,
            color: colors.text,
            minHeight: 52,
          },
          style,
        ]}
        {...rest}
      />
      {hint ? <Txt variant="caption" muted>{hint}</Txt> : null}
    </View>
  );
}

export function StepDots({ step, total }: { step: number; total: number }) {
  const { colors } = useTheme();
  return (
    <View accessible accessibilityLabel={`Adım ${step} / ${total}`} style={{ flexDirection: 'row', gap: 6 }}>
      {Array.from({ length: total }, (_, i) => (
        <View
          key={i}
          style={{ width: i + 1 === step ? 24 : 6, height: 6, borderRadius: 3, backgroundColor: i + 1 === step ? colors.primary : colors.border }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(3),
    minHeight: 60,
    paddingVertical: spacing(2),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
