import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon, type IconName } from '../../components/Icon';
import { Button, StepDots, Txt } from '../../components/ui';
import { spacing, useTheme } from '../../theme/theme';

/** Shared frame for onboarding steps 01b–01d. */
export function OnboardingStep({
  step,
  total,
  icon,
  title,
  lead,
  children,
  footer,
  onSkip,
}: {
  step?: number;
  total?: number;
  icon: IconName;
  title: string;
  lead: string;
  children?: ReactNode;
  footer: ReactNode;
  onSkip?: () => void;
}) {
  const { colors } = useTheme();
  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 16, gap: 22 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }}>
          {step && total ? <StepDots step={step} total={total} /> : <View />}
          {onSkip ? <Button label="Atla" variant="text" size="sm" onPress={onSkip} style={{ paddingHorizontal: 4 }} /> : null}
        </View>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={{ width: 88, height: 88, borderRadius: 24, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name={icon} size={44} color={colors.primaryText} strokeWidth={1.8} />
        </View>
        <View style={{ gap: 10 }}>
          <Txt variant="title" style={{ fontSize: 32, lineHeight: 34 }}>{title}</Txt>
          <Txt variant="body" muted style={{ fontSize: 17, lineHeight: 25 }}>{lead}</Txt>
        </View>
        {children}
        <View style={{ marginTop: 'auto', gap: spacing(2) }}>{footer}</View>
      </ScrollView>
    </SafeAreaView>
  );
}

export function Bullet({ icon, children }: { icon: IconName; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-start' }}>
      <Icon name={icon} size={24} color={colors.primaryText} />
      <Txt variant="body" style={{ flex: 1 }}>{children}</Txt>
    </View>
  );
}
