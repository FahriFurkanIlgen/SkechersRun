import type { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fonts, useTheme } from '../theme/theme';
import { Icon, type IconName } from './Icon';

type BottomTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

const ICONS: Record<string, IconName> = {
  index: 'map',
  feed: 'feed',
  quests: 'quests',
  leaderboard: 'rank',
  profile: 'profile',
};

/** Bottom navigation per design: heavier stroke + bold label when selected; Android adds a pill. */
export function TabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const android = Platform.OS === 'android';
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: 'row',
        backgroundColor: colors.surface,
        borderTopWidth: 1,
        borderTopColor: colors.border,
        paddingTop: android ? 12 : 8,
        paddingBottom: Math.max(insets.bottom, 8),
        paddingHorizontal: 4,
      }}
    >
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const { options } = descriptors[route.key];
        const label = (options.title ?? route.name) as string;
        const color = focused ? colors.primaryText : colors.text2;
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected: focused }}
            onPress={() => {
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
            }}
            style={{ flex: 1, alignItems: 'center', gap: 4, minHeight: 48 }}
          >
            <View
              style={{
                width: android ? 56 : 32,
                height: 32,
                borderRadius: 16,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: focused && android ? colors.primarySoft : 'transparent',
              }}
            >
              <Icon name={ICONS[route.name] ?? 'map'} size={24} color={color} strokeWidth={focused ? 2.4 : 1.8} />
            </View>
            <Text style={{ fontSize: 12, fontFamily: focused ? fonts.bodyBold : fonts.bodyMedium, color }}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
