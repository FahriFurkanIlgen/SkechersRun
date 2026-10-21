import { router } from 'expo-router';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, StepDots, Txt } from '../../components/ui';
import { backendConfigured } from '../../data/remote/supabase';
import { MapIllustration } from '../../features/onboarding/MapIllustration';
import { spacing, useTheme } from '../../theme/theme';

/** 01a Açılış */
export default function Welcome() {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ height: '48%' }}>
        <MapIllustration height={430} />
      </View>
      <SafeAreaView edges={['bottom']} style={{ position: 'absolute', top: 0, left: 0, right: 0 }}>
        <View style={{ marginTop: 60, marginLeft: 20, alignSelf: 'flex-start', backgroundColor: colors.surface, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 }}>
          <Txt variant="logo">Battle Run</Txt>
        </View>
      </SafeAreaView>
      <SafeAreaView edges={['bottom']} style={{ flex: 1, paddingHorizontal: 24, paddingTop: 28, paddingBottom: 16, gap: spacing(4) }}>
        <StepDots step={1} total={3} />
        <Txt variant="title" style={{ fontSize: 38, lineHeight: 40 }} accessibilityRole="header">
          Hareket et. Rotanı tamamla. Haritada alan kazan.
        </Txt>
        <Txt variant="body" muted style={{ fontSize: 17, lineHeight: 25 }}>
          Yürüdüğün, koştuğun ya da pedal çevirdiğin her yol haritada senin alanına dönüşür. Kendi temponda.
        </Txt>
        <View style={{ marginTop: 'auto', gap: spacing(2) }}>
          <Button label="Başlayalım" size="lg" onPress={() => router.push('/onboarding/location')} />
          {backendConfigured ? (
            <Button label="Zaten hesabım var" variant="text" onPress={() => router.push('/auth')} />
          ) : null}
        </View>
      </SafeAreaView>
    </View>
  );
}
