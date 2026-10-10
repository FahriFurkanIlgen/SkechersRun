import { router } from 'expo-router';
import { View } from 'react-native';
import { Button, SwitchRow } from '../../components/ui';
import type { NotificationPrefs } from '../../domain/types';
import { OnboardingStep } from '../../features/onboarding/OnboardingStep';
import { requestNotificationPermission } from '../../services/notifications';
import { useSettings } from '../../state/settingsStore';
import { useTheme } from '../../theme/theme';

const ROWS: { key: keyof NotificationPrefs; label: string; sub: string }[] = [
  { key: 'movementReminders', label: 'Hareket hatırlatmaları', sub: 'En fazla günde bir, akşam 18:00’de' },
  { key: 'territoryChanges', label: 'Alanında değişiklik', sub: 'Bölge kazandığında ya da bir bölgen el değiştirdiğinde' },
  { key: 'weeklySummary', label: 'Haftalık özet', sub: 'Pazar akşamı, kısa bir hatırlatma' },
];

/** 01c Bildirim izni */
export default function NotificationsStep() {
  const { colors } = useTheme();
  const prefs = useSettings((s) => s.notificationPrefs);
  const set = useSettings((s) => s.set);
  const next = () => router.push('/onboarding/profile');

  return (
    <OnboardingStep
      step={3}
      total={3}
      icon="bell"
      title="Sadece işine yarayan bildirimler"
      lead="Neyi duymak istediğini sen seç. İş ortağı ve pazarlama bildirimi gönderilmez."
      onSkip={next}
      footer={
        <>
          <Button
            label="Bildirimlere izin ver"
            size="lg"
            onPress={async () => {
              await requestNotificationPermission();
              next();
            }}
          />
          <Button label="Şimdi değil" variant="text" onPress={next} />
        </>
      }
    >
      <View style={{ borderTopWidth: 1, borderTopColor: colors.border }}>
        {ROWS.map((r) => (
          <SwitchRow
            key={r.key}
            label={r.label}
            sub={r.sub}
            value={prefs[r.key]}
            onChange={(v) => set({ notificationPrefs: { ...prefs, [r.key]: v } })}
          />
        ))}
      </View>
    </OnboardingStep>
  );
}
