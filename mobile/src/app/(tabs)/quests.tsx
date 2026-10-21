import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Icon } from '../../components/Icon';
import { Button, Card, ProgressBar, ProgressRing, Screen, Segmented, Txt } from '../../components/ui';
import { daysLeftInWeek, defaultWeeklyGoalKm, defaultWeeklyGoalMinutes, formatGoalMinutes, weeklyGoals } from '../../domain/goals';
import { useActivityHistory } from '../../features/activity/hooks';
import { useWeeklyGoal } from '../../features/profile/hooks';
import { useSettings } from '../../state/settingsStore';
import { FEATURES } from '../../domain/features';
import { fonts, radius, useTheme } from '../../theme/theme';

const GOAL_STEPS = [5, 10, 15, 20, 25, 30, 40, 50, 75, 100];
const MINUTE_STEPS = [30, 45, 60, 90, 120, 150, 180, 240, 300, 420];

function step(steps: number[], current: number, dir: 1 | -1): number {
  const i = steps.findIndex((g) => g >= current);
  return steps[Math.max(0, Math.min(steps.length - 1, (i === -1 ? steps.length - 1 : i) + dir))];
}

/** 09 Görevler ve iş ortaklığı alanı */
export default function Quests() {
  const { colors } = useTheme();
  const { activities } = useActivityHistory();
  const goal = useWeeklyGoal(activities);
  const level = useSettings((s) => s.level);
  const goalKm = useSettings((s) => s.weeklyGoalKm) ?? defaultWeeklyGoalKm(level);
  const goalMinutes = useSettings((s) => s.weeklyGoalMinutes) ?? defaultWeeklyGoalMinutes(level);
  const partnerContent = useSettings((s) => s.partnerContent) && FEATURES.partnerContent;
  const set = useSettings((s) => s.set);
  const [editing, setEditing] = useState(false);
  const quests = useMemo(() => weeklyGoals(activities, level), [activities, level]);
  const pct = Math.round(Math.min(goal.ratio, 1) * 100);
  const days = daysLeftInWeek();

  const stepGoal = (dir: 1 | -1) =>
    goal.kind === 'minutes'
      ? set({ weeklyGoalMinutes: step(MINUTE_STEPS, goalMinutes, dir) })
      : set({ weeklyGoalKm: step(GOAL_STEPS, goalKm, dir) });

  return (
    <Screen>
      <View style={{ gap: 2 }}>
        <Txt variant="title">Görevler</Txt>
        <Txt variant="bodySm" muted>Bu hafta · {days === 1 ? 'son gün' : `${days} gün kaldı`}</Txt>
      </View>

      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
        <ProgressRing value={goal.ratio} size={72} stroke={8} label={`Haftalık ${goal.kind === 'minutes' ? 'hareket süresi' : 'mesafe'} hedefinin yüzde ${pct}’i tamam`}>
          <Text style={{ fontFamily: fonts.display, fontSize: 16, color: colors.text }}>%{pct}</Text>
        </ProgressRing>
        <View style={{ flex: 1, gap: 4 }}>
          <Txt variant="heading">Haftalık hedef</Txt>
          <Txt variant="bodySm" muted>
            {goal.format(goal.done)} / {goal.format(goal.target)}
          </Txt>
          {editing ? (
            <Segmented
              label=""
              value={goal.kind}
              onChange={(v) => set({ weeklyGoalType: v })}
              options={[
                { value: 'distance', label: 'Mesafe' },
                { value: 'minutes', label: 'Hareket süresi' },
              ]}
            />
          ) : null}
          {editing ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 }}>
              <Pressable accessibilityRole="button" accessibilityLabel="Hedefi azalt" onPress={() => stepGoal(-1)} style={stepper(colors.border)}>
                <Icon name="minus" size={20} color={colors.text} />
              </Pressable>
              <Text accessibilityLiveRegion="polite" style={{ fontFamily: fonts.display, fontSize: 20, color: colors.text, minWidth: 64, textAlign: 'center' }}>
                {goal.kind === 'minutes' ? formatGoalMinutes(goalMinutes) : `${goalKm} km`}
              </Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Hedefi artır" onPress={() => stepGoal(1)} style={stepper(colors.border)}>
                <Icon name="plus" size={20} color={colors.text} />
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => setEditing(false)} style={{ padding: 8 }}>
                <Text style={{ fontFamily: fonts.bodyBold, color: colors.primaryText }}>Tamam</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable accessibilityRole="button" onPress={() => setEditing(true)} style={{ paddingVertical: 6, alignSelf: 'flex-start' }}>
              <Text style={{ fontFamily: fonts.bodyBold, fontSize: 15, color: colors.primaryText }}>Hedefi düzenle</Text>
            </Pressable>
          )}
        </View>
      </Card>

      <View style={{ gap: 10 }}>
        <Txt variant="heading">Kişisel görevler</Txt>
        <Txt variant="bodySm" muted>Tempo değil, düzen ödüllendirilir. Yürüyüş de sayılır.</Txt>
        <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, borderWidth: 1, borderColor: colors.border }}>
          {quests.map((q, i) => (
            <View key={q.id} style={{ padding: 16, gap: 8, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.border }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
                <Txt variant="body" style={{ fontFamily: fonts.bodySemi, flex: 1 }}>
                  {q.done ? '✓ ' : ''}
                  {q.title}
                </Txt>
                <Txt variant="bodySm" muted>{q.progress} / {q.target}</Txt>
              </View>
              <ProgressBar value={q.progress} max={q.target} label={q.title} />
              <Txt variant="caption" muted>{q.description}</Txt>
            </View>
          ))}
        </View>
      </View>

      {partnerContent ? (
        <View style={{ gap: 10, padding: 16, borderRadius: radius.card, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.switchOff }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ height: 26, paddingHorizontal: 10, borderRadius: 13, backgroundColor: colors.text, justifyContent: 'center' }}>
              <Text style={{ fontFamily: fonts.bodyBold, fontSize: 12, color: colors.bg }}>Sponsorlu</Text>
            </View>
            <Txt variant="caption" muted style={{ fontFamily: fonts.bodySemi }}>İş ortaklığı alanı</Txt>
          </View>
          <Txt variant="body" style={{ fontFamily: fonts.bodySemi }}>Şu an yayında bir iş ortaklığı görevi yok.</Txt>
          <Txt variant="bodySm" muted>
            Onaylanmış bir kampanya olduğunda burada etiketli olarak görünür. Katılım isteğe bağlıdır; ödül veya ürün önerisi
            yalnızca sen istersen gösterilir.
          </Txt>
        </View>
      ) : null}

      {FEATURES.partnerContent ? (
        <Txt variant="caption" muted>
          İş ortaklığı içeriği {partnerContent ? 'açık' : 'kapalı'}.{' '}
          <Text style={{ fontFamily: fonts.bodyBold, color: colors.primaryText }} onPress={() => router.push('/settings')}>
            Ayarlar
          </Text>
          ’dan değiştirebilirsin.
        </Txt>
      ) : null}
      <Button label="Oyun kuralları" variant="text" onPress={() => router.push('/how-it-works')} />
    </Screen>
  );
}

const stepper = (border: string) =>
  ({ width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: border, alignItems: 'center', justifyContent: 'center' }) as const;
