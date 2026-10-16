import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../../components/Icon';
import { RouteMap } from '../../components/RouteMap';
import { Banner, Button, EmptyState, IconButton, Loading, ProgressBar, Segmented, Stat, StatGrid, Txt } from '../../components/ui';
import { backendConfigured } from '../../data/remote/supabase';
import { ACTIVITY_LABEL, durationLabel, formatDistance, formatDuration, formatGoalDistance, formatPaceOrSpeed, sourceLabel } from '../../domain/format';
import type { ActivityType, Visibility } from '../../domain/types';
import { activityActions } from '../../features/activity/activityActions';
import { estimateExplanation, reasonTexts } from '../../features/activity/claimText';
import { useActivity, useActivityHistory } from '../../features/activity/hooks';
import { VISIBILITY_ICON, VISIBILITY_OPTIONS, visibilitySentence } from '../../features/activity/visibility';
import { useWeeklyGoal } from '../../features/profile/hooks';
import { syncPending } from '../../services/syncService';
import { useAuth } from '../../state/authStore';
import { useSettings } from '../../state/settingsStore';
import { fonts, radius, useTheme } from '../../theme/theme';

const TITLE_NOUN: Record<ActivityType, string> = { walk: 'yürüyüşü', run: 'koşusu', ride: 'bisiklet turu', wheelchair: 'sandalye turu' };

function suggestedTitle(startedAt: number, type: ActivityType): string {
  const hour = new Date(startedAt).getHours();
  const part = hour >= 5 && hour < 12 ? 'Sabah' : hour < 17 && hour >= 12 ? 'Öğle' : hour >= 17 && hour < 22 ? 'Akşam' : 'Gece';
  return `${part} ${TITLE_NOUN[type]}`;
}

/** "2,46 km²" → value + unit for the metric typography. */
function splitValue(text: string): { value: string; unit?: string } {
  const i = text.lastIndexOf(' ');
  return i > 0 ? { value: text.slice(0, i), unit: text.slice(i + 1) } : { value: text };
}

/** 05 Aktivite özeti (+ kayıt hatası durumu) */
export default function Summary() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, loading, error, reload } = useActivity(id);
  const { activities } = useActivityHistory();
  const goal = useWeeklyGoal(activities);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const units = useSettings((s) => s.units);
  const session = useAuth((s) => s.session);
  const [editedTitle, setTitle] = useState<string | null>(null);
  const [editedVisibility, setVisibility] = useState<Visibility | null>(null);
  const [pickVisibility, setPickVisibility] = useState(false);
  const [busy, setBusy] = useState(false);

  if (loading && !data) return <Loading />;
  if (error || !data) {
    return (
      <EmptyState
        icon="alert"
        title="Aktivite bulunamadı"
        message={error ?? undefined}
        action={{ label: 'Haritaya dön', onPress: () => router.replace('/(tabs)') }}
      />
    );
  }

  const { activity, points, estimate, avgSpeedMps, saved, records } = data;
  const title = editedTitle ?? (activity.title || suggestedTitle(activity.startedAt, activity.type));
  const visibility = editedVisibility ?? activity.visibility;
  const avg = formatPaceOrSpeed(avgSpeedMps, activity.type, units);
  const accepted = activity.claim?.status === 'accepted';
  const noArea = estimate.shape === 'too_short' && !accepted;
  const cellCount = accepted ? activity.claim!.netGainCells : estimate.cells;
  const dist = splitValue(formatDistance(activity.distanceM, units));
  const syncFailed = saved && activity.syncState === 'pending_upload' && !!activity.lastSyncError;
  const weekDone = goal.done + (saved ? 0 : goal.amountOf(activity));
  const date = new Date(activity.startedAt);
  const dateText = `${date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' })} · ${date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })} · ${ACTIVITY_LABEL[activity.type]}${sourceLabel(activity) ? ` · ${sourceLabel(activity)}` : ''}`;

  const save = async () => {
    setBusy(true);
    try {
      await activityActions.save(activity.id, title.trim(), visibility, 'trimmed');
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const discard = () =>
    Alert.alert('Aktivite silinsin mi?', 'Rota ve süre kalıcı olarak silinir.', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Sil',
        style: 'destructive',
        onPress: async () => {
          await activityActions.discard(activity.id);
          router.replace('/(tabs)');
        },
      },
    ]);

  const back = () => {
    if (saved) return router.replace('/(tabs)');
    Alert.alert('Aktivite kaydedilmedi', 'Haritaya dönmeden önce kaydetmek ister misin?', [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Sil', style: 'destructive', onPress: discard },
      { text: 'Kaydet', onPress: () => void save().then(() => router.replace('/(tabs)')) },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ height: 280 }}>
        {points.length > 1 ? (
          <RouteMap points={points} cells={estimate.cellList} edgePaddingBottom={24} accessibilityLabel={`Tamamlanan rota haritası. Kazanılan ${estimate.cells} hücre vurgulu.`} />
        ) : (
          <View style={{ flex: 1, backgroundColor: colors.mapLand, alignItems: 'center', justifyContent: 'center' }}>
            <Txt variant="bodySm" muted>Bu aktivitede kullanılabilir GPS noktası yok.</Txt>
          </View>
        )}
      </View>
      <IconButton icon="back" label="Haritaya dön" onPress={back} style={{ position: 'absolute', top: insets.top + 8, left: 16 }} />

      <ScrollView
        style={{ flex: 1, marginTop: -12, backgroundColor: colors.surface, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 18, paddingBottom: insets.bottom + 20, gap: 12 }}
      >
        <View style={{ gap: 4 }}>
          {saved ? (
            <Txt variant="title" style={{ fontSize: 26 }}>{title}</Txt>
          ) : (
            <TextInput
              accessibilityLabel="Aktivite başlığı"
              accessibilityHint="Düzenlemek için dokun"
              value={title}
              onChangeText={setTitle}
              maxLength={80}
              style={{ fontFamily: fonts.display, fontSize: 26, color: colors.text, padding: 0 }}
            />
          )}
          <Txt variant="bodySm" muted>{dateText}</Txt>
        </View>

        {records.length > 0 && !syncFailed ? (
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center', padding: 12, paddingHorizontal: 14, borderRadius: radius.md, backgroundColor: colors.primarySoft }}>
            <Icon name="medal" size={28} color={colors.primaryText} strokeWidth={1.9} />
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="body" style={{ fontFamily: fonts.bodyBold, fontSize: 15 }}>Yeni kişisel rekor: {records[0].label}</Txt>
              <Txt variant="bodySm" muted>
                {records[0].improvementS != null
                  ? `Önceki en iyi sürenden ${Math.round(records[0].improvementS)} sn daha hızlı.`
                  : `İlk kaydın: ${formatDuration(records[0].timeS)}.`}
              </Txt>
            </View>
          </View>
        ) : null}

        {syncFailed ? (
          <Banner tone="danger" title="Aktivite henüz kaydedilemedi" action={{ label: 'Tekrar dene', onPress: () => void syncPending().then(reload) }}>
            Verilerin cihazında güvende. Bağlantı gelince otomatik olarak yeniden deneyeceğiz.
          </Banner>
        ) : null}
        {activity.claim?.status === 'rejected' ? (
          <Banner tone="warning" title="Sunucu doğrulaması başarısız; hücre verilmedi">
            {reasonTexts(activity.claim.reasons).join(' ')}
          </Banner>
        ) : null}

        <StatGrid>
          <Stat label="Süre" value={formatDuration(activity.movingTimeS)} accessibilityValue={durationLabel(activity.movingTimeS)} />
          <Stat label="Mesafe" value={dist.value} unit={dist.unit} />
          <Stat label={activity.type === 'ride' ? 'Ortalama hız' : 'Ortalama tempo'} value={avg.value} unit={avg.unit} />
          <Stat
            label={accepted ? 'Kazanılan hücre' : 'Tahmini hücre'}
            value={noArea ? '—' : `+${cellCount}`}
            unit={noArea ? undefined : 'hücre'}
            color={colors.primaryText}
          />
        </StatGrid>
        <Txt variant="caption" muted>
          {accepted
            ? 'Hücreler sunucuda doğrulandı.'
            : `${estimateExplanation(estimate, units)} ${
                !backendConfigured
                  ? 'Sunucu bağlı olmadığı için hücreler sahiplenilmez.'
                  : !session
                    ? 'Giriş yaptığında aktivite yüklenir ve hücreler hesaplanır.'
                    : 'Kesin hücre sayısı kaydettiğinde sunucuda hesaplanır.'
              }`}
        </Txt>

        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Txt variant="bodySm" style={{ fontFamily: fonts.bodySemi }}>Haftalık hedef</Txt>
            <Txt variant="bodySm" muted>
              {goal.format(weekDone)} / {goal.format(goal.target)}
            </Txt>
          </View>
          <ProgressBar value={weekDone} max={goal.target} label="Haftalık hedef" />
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }}>
          <Icon name={VISIBILITY_ICON[visibility]} size={18} color={colors.text} />
          <Txt variant="bodySm" style={{ flex: 1 }}>{visibilitySentence(visibility, activity.routeShare)}</Txt>
          {!saved ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Görünürlüğü değiştir" onPress={() => setPickVisibility((v) => !v)} style={{ padding: 10 }}>
              <Txt variant="bodySm" color={colors.primaryText} style={{ fontFamily: fonts.bodyBold }}>Değiştir</Txt>
            </Pressable>
          ) : null}
        </View>
        {pickVisibility && !saved ? (
          <Segmented label="" value={visibility} onChange={(v) => setVisibility(v)} options={VISIBILITY_OPTIONS} />
        ) : null}

        {!saved ? (
          <>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Button
                label="Paylaş"
                icon="share"
                variant="secondary"
                style={{ flex: 1 }}
                onPress={() => router.push({ pathname: '/share/[id]', params: { id: activity.id, title } })}
              />
              <Button label="Kaydet" icon="check" style={{ flex: 1 }} loading={busy} onPress={() => void save()} />
            </View>
            <Button label="Kaydetmeden sil" variant="danger" onPress={discard} />
          </>
        ) : (
          <>
            <Banner tone={syncFailed ? 'warning' : 'success'}>
              {activity.syncState === 'uploaded'
                ? 'Kaydedildi ve sunucuda doğrulandı.'
                : activity.syncState === 'rejected'
                  ? 'Kaydedildi; sunucu doğrulamasından geçmedi.'
                  : activity.syncState === 'local_only'
                    ? 'Bu cihaza kaydedildi.'
                    : 'Kaydedildi; sunucuya yükleniyor.'}
            </Banner>
            <Button label="Haritaya dön" variant="text" onPress={() => router.replace('/(tabs)')} />
          </>
        )}
      </ScrollView>
    </View>
  );
}
