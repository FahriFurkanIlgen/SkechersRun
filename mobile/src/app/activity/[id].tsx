import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';
import { RouteMap } from '../../components/RouteMap';
import { Banner, Button, Card, EmptyState, Field, Loading, Screen, Segmented, Stat, StatGrid, Txt } from '../../components/ui';
import { ACTIVITY_LABEL, durationLabel, formatCells, formatDistance, formatDuration, formatPaceOrSpeed } from '../../domain/format';
import type { RouteShare, Visibility } from '../../domain/types';
import { activityActions } from '../../features/activity/activityActions';
import { estimateExplanation, reasonTexts, syncStateText } from '../../features/activity/claimText';
import { useActivity } from '../../features/activity/hooks';
import { VISIBILITY_OPTIONS, visibilitySentence } from '../../features/activity/visibility';
import { syncPending } from '../../services/syncService';
import { useSettings } from '../../state/settingsStore';
import { radius } from '../../theme/theme';

function split(text: string) {
  const i = text.lastIndexOf(' ');
  return i > 0 ? { value: text.slice(0, i), unit: text.slice(i + 1) } : { value: text, unit: undefined };
}

export default function ActivityDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, loading, error, reload } = useActivity(id);
  const units = useSettings((s) => s.units);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('private');
  const [routeShare, setRouteShare] = useState<RouteShare>('trimmed');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (loading && !data) return <Loading />;
  if (error || !data) return <EmptyState icon="alert" title="Aktivite bulunamadı" message={error ?? undefined} />;

  const { activity, points, estimate, avgSpeedMps } = data;
  const claim = activity.claim;
  const avg = formatPaceOrSpeed(avgSpeedMps, activity.type, units);
  const dist = split(formatDistance(activity.distanceM, units));
  const accepted = claim?.status === 'accepted';
  const cellCount = accepted ? claim!.netGainCells : estimate.cells;

  const saveEdit = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await activityActions.update(activity.id, title.trim(), visibility, routeShare);
      setEditing(false);
      await reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = () =>
    Alert.alert(
      'Aktivite silinsin mi?',
      'Rota ve istatistikler silinir. Daha önce kazanılan alan geri alınmaz (o alan el değiştirmiş olabilir).',
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Sil',
          style: 'destructive',
          onPress: async () => {
            try {
              await activityActions.remove(activity.id);
              router.back();
            } catch (e) {
              setActionError(e instanceof Error ? e.message : String(e));
            }
          },
        },
      ],
    );

  return (
    <Screen edges={[]}>
      <View style={{ gap: 4 }}>
        <Txt variant="title" style={{ fontSize: 26 }}>{activity.title || ACTIVITY_LABEL[activity.type]}</Txt>
        <Txt variant="bodySm" muted>
          {ACTIVITY_LABEL[activity.type]} · {new Date(activity.startedAt).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' })}
        </Txt>
      </View>
      {points.length > 1 ? (
        <RouteMap points={points} cells={estimate.cellList} style={{ height: 240, borderRadius: radius.card, overflow: 'hidden' }} accessibilityLabel="Aktivite rotası ve hücreleri" />
      ) : (
        <Txt variant="bodySm" muted>Rota verisi yok (silinmiş veya kaydedilmemiş).</Txt>
      )}
      <StatGrid>
        <Stat label="Mesafe" value={dist.value} unit={dist.unit} />
        <Stat label="Süre" value={formatDuration(activity.movingTimeS)} accessibilityValue={durationLabel(activity.movingTimeS)} />
        <Stat label={activity.type === 'ride' ? 'Ortalama hız' : 'Ortalama tempo'} value={avg.value} unit={avg.unit} />
        <Stat label={accepted ? 'Kazanılan hücre' : 'Tahmini hücre'} value={`+${cellCount}`} unit="hücre" />
      </StatGrid>

      <Card>
        <Txt variant="heading">Hücreler</Txt>
        <Txt variant="bodySm">{syncStateText(activity)}</Txt>
        {claim ? (
          <>
            {accepted ? (
              <Txt variant="bodySm">
                Sahiplenilen: {formatCells(claim.claimedCells)} · Yeni: {formatCells(claim.netGainCells)}
                {claim.capturedCells > 0 ? ` · ${claim.capturedFromUsers} oyuncudan ${formatCells(claim.capturedCells)} ele geçirildi` : ''}
              </Txt>
            ) : null}
            {reasonTexts(claim.reasons).map((r) => (
              <Txt key={r} variant="caption" muted>• {r}</Txt>
            ))}
          </>
        ) : (
          <Txt variant="caption" muted>{estimateExplanation(estimate, units)}</Txt>
        )}
        {activity.syncState === 'pending_upload' ? (
          <Button label="Şimdi yüklemeyi dene" variant="secondary" size="sm" onPress={() => void syncPending().then(reload)} />
        ) : null}
      </Card>

      {actionError ? <Banner tone="danger">{actionError}</Banner> : null}
      {editing ? (
        <Card>
          <Field label="Başlık" value={title} onChangeText={setTitle} maxLength={80} />
          <Segmented label="Kimler görebilir?" value={visibility} onChange={setVisibility} options={VISIBILITY_OPTIONS} />
          {visibility !== 'private' ? (
            <Segmented
              label="Rota nasıl görünsün?"
              value={routeShare}
              onChange={setRouteShare}
              options={[
                { value: 'trimmed', label: 'Uçlar gizli' },
                { value: 'stats_only', label: 'Rota gizli' },
                { value: 'full', label: 'Tüm rota' },
              ]}
            />
          ) : null}
          <Button label="Değişiklikleri kaydet" loading={busy} onPress={() => void saveEdit()} />
          <Button label="Vazgeç" variant="text" onPress={() => setEditing(false)} />
        </Card>
      ) : (
        <>
          <Txt variant="bodySm" muted>{visibilitySentence(activity.visibility, activity.routeShare)}</Txt>
          <Button
            label="Düzenle"
            variant="secondary"
            onPress={() => {
              setTitle(activity.title);
              setVisibility(activity.visibility);
              setRouteShare(activity.routeShare);
              setEditing(true);
            }}
          />
          <Button label="Aktiviteyi sil" variant="danger" onPress={remove} />
        </>
      )}
    </Screen>
  );
}
