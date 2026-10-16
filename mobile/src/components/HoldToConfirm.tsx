import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Pressable, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useTheme } from '../theme/theme';
import { Txt } from './ui';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/**
 * Round button that must be held for `holdMs`: a ring fills around it while
 * held and the action runs when it is full. Releasing early drains the ring
 * and highlights the hint. Screen-reader users can activate it directly.
 */
export function HoldToConfirm({
  onConfirm,
  label,
  hint,
  onEarlyRelease,
  accessibilityLabel,
  size = 88,
  holdMs = 1200,
  children,
}: {
  onConfirm: () => void;
  label: string;
  /** Spoken by screen readers; also shown by the caller under the button. */
  hint: string;
  /** Let go before the ring was full (the caller can emphasise its hint). */
  onEarlyRelease?: () => void;
  accessibilityLabel: string;
  size?: number;
  holdMs?: number;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  const [progress] = useState(() => new Animated.Value(0));
  const [holding, setHolding] = useState(false);
  const done = useRef(false);

  const stroke = 5;
  const ring = size + 16;
  const r = (ring - stroke) / 2;
  const circumference = 2 * Math.PI * r;

  useEffect(() => () => progress.stopAnimation(), [progress]);

  const start = () => {
    if (done.current) return;
    setHolding(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    progress.stopAnimation();
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: holdMs,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (!finished || done.current) return;
      done.current = true;
      setHolding(false);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      onConfirm();
    });
  };

  const cancel = () => {
    if (done.current) return;
    setHolding(false);
    progress.stopAnimation();
    Animated.timing(progress, { toValue: 0, duration: 200, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
    onEarlyRelease?.();
  };

  const dashOffset = progress.interpolate({ inputRange: [0, 1], outputRange: [circumference, 0] });
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] });

  return (
    <View style={{ alignItems: 'center', gap: 8 }}>
      <View style={{ width: ring, height: ring, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={ring} height={ring} style={{ position: 'absolute' }} pointerEvents="none">
          <Circle cx={ring / 2} cy={ring / 2} r={r} stroke={colors.surface2} strokeWidth={stroke} fill="none" />
          <AnimatedCircle
            cx={ring / 2}
            cy={ring / 2}
            r={r}
            stroke={colors.danger}
            strokeWidth={stroke}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={dashOffset}
            transform={`rotate(-90 ${ring / 2} ${ring / 2})`}
          />
        </Svg>
        <Animated.View style={{ transform: [{ scale }] }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            accessibilityHint={hint}
            accessibilityActions={[{ name: 'activate', label }]}
            onAccessibilityAction={() => {
              if (done.current) return;
              done.current = true;
              onConfirm();
            }}
            onPressIn={start}
            onPressOut={cancel}
            style={{
              width: size,
              height: size,
              borderRadius: size / 2,
              borderWidth: 2,
              borderColor: holding ? colors.danger : colors.text,
              backgroundColor: holding ? colors.dangerSoft : colors.surface,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {children}
          </Pressable>
        </Animated.View>
      </View>
      <Txt variant="label">{label}</Txt>
    </View>
  );
}

/** Caption under the hold buttons; emphasised after an early release. */
export function HoldHint({ text, emphasised }: { text: string; emphasised: boolean }) {
  const { colors } = useTheme();
  return (
    <Txt
      variant="caption"
      accessibilityLiveRegion="polite"
      style={emphasised ? { color: colors.danger, fontWeight: '600' } : undefined}
      muted={!emphasised}
    >
      {text}
    </Txt>
  );
}
