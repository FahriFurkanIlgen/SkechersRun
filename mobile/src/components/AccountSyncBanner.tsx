import { ActivityIndicator, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAccountSync } from '../state/accountSyncStore';
import { fonts, radius, useTheme } from '../theme/theme';

/**
 * Small, non-blocking pill at the top while the signed-in account's data is
 * loaded onto this device (profile, privacy zones, activities and routes).
 */
export function AccountSyncBanner() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const busy = useAccountSync((s) => s.busy);
  const message = useAccountSync((s) => s.message);
  if (!busy) return null;
  return (
    <View
      pointerEvents="none"
      accessibilityRole="progressbar"
      accessibilityLabel={message ?? 'Yükleniyor'}
      style={{ position: 'absolute', top: insets.top + 6, left: 0, right: 0, alignItems: 'center' }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingVertical: 9,
          paddingHorizontal: 16,
          borderRadius: radius.pill,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
          shadowColor: '#000',
          shadowOpacity: 0.12,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 3 },
          elevation: 4,
        }}
      >
        <ActivityIndicator size="small" color={colors.primary} />
        <Text style={{ fontFamily: fonts.bodySemi, fontSize: 14, color: colors.text }}>{message ?? 'Yükleniyor'}</Text>
      </View>
    </View>
  );
}
