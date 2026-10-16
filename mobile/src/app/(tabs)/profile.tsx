import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { Icon } from '../../components/Icon';
import { Avatar, Banner, Button, Card, Chips, EmptyState, Group, IconButton, Loading, Metric, NavRow, Screen, Txt } from '../../components/ui';
import { activityRepo } from '../../data/local/activityRepo';
import { backendConfigured } from '../../data/remote/supabase';
import { formatDistance, formatDuration, sourceLabel } from '../../domain/format';
import type { Activity, ActivityType } from '../../domain/types';
import { computeLocalStats, useActivityHistory } from '../../features/activity/hooks';
import { VISIBILITY_ICON, VISIBILITY_LABEL } from '../../features/activity/visibility';
import { useMySeason, useRemoteStats } from '../../features/profile/hooks';
import { seasonDaysLeft, seasonRank } from '../../domain/season';
import type { MySeason } from '../../data/remote/socialApi';
import { health } from '../../services/health';
import { useAccountSync } from '../../state/accountSyncStore';
import { useAuth } from '../../state/authStore';
import { useSettings } from '../../state/settingsStore';
import { stravaConfigured } from '../../services/strava';
import { fonts, radius, useTheme } from '../../theme/theme';

type Filter = 'all' | ActivityType;

function split(text: string) {
  const i = text.lastIndexOf(' ');
  return i > 0 ? { value: text.slice(0, i), unit: text.slice(i + 1) } : { value: text, unit: undefined };
}

function hoursMinutes(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h} sa ${m} dk` : `${m} dk`;
}

/** 06 Profil ve geçmiş */
export default function Profile() {
  const { colors } = useTheme();
  const settings = useSettings();
  const session = useAuth((s) => s.session);
  const { activities, loading } = useActivityHistory();
  const syncing = useAccountSync((s) => s.busy);
  const homeDistrict = useSettings((s) => s.homeDistrict);
  const season = useMySeason();
  const { stats } = useRemoteStats();
  const [filter, setFilter] = useState<Filter>('all');
  const [unsaved, setUnsaved] = useState<Activity | null>(null);
  const units = settings.units;

  useFocusEffect(
    useCallback(() => {
      void activityRepo.findUnsavedFinished().then(setUnsaved);
    }, []),
  );

  const local = useMemo(() => computeLocalStats(activities), [activities]);
  const list = activities.filter((a) => filter === 'all' || a.type === filter);
  const since = local.firstAt ? new Date(local.firstAt).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' }) : null;
  const dist = split(formatDistance(local.distanceM, units));
  const cellCount = stats ? stats.territoryCells : local.claimedCells;

  const tile = (label: string, value: string, unit?: string) => (
    <View accessible accessibilityLabel={`${label}: ${value} ${unit ?? ''}`} style={{ flexBasis: '45%', flexGrow: 1, gap: 2 }}>
      <Metric value={value} unit={unit} size="L" />
      <Txt variant="caption" muted style={{ fontFamily: fonts.bodySemi }}>{label}</Txt>
    </View>
  );

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        {settings.avatarUri ? (
          <Image source={{ uri: settings.avatarUri }} style={{ width: 64, height: 64, borderRadius: 32 }} accessibilityLabel="Profil fotoğrafı" />
        ) : (
          <Avatar name={settings.username || 'R'} size={64} highlight />
        )}
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="title" style={{ fontSize: 26 }} numberOfLines={1}>{settings.username || 'Profil'}</Txt>
          <Txt variant="bodySm" muted>
            {since ? `${since}’ten beri` : session ? session.user.email : backendConfigured ? 'Giriş yapılmadı' : 'Yalnızca bu cihaz'}
          </Txt>
        </View>
        <IconButton icon="settings" label="Ayarlar ve gizlilik" onPress={() => router.push('/settings')} />
      </View>

      {!session && backendConfigured ? (
        <Banner tone="info" title="Alan kazanmak için giriş yap" action={{ label: 'Giriş yap / kayıt ol', onPress: () => router.push('/auth') }}>
          Aktivitelerin şu an yalnızca bu cihazda. Giriş yaptığında sunucuya yüklenir ve hücreler hesaplanır.
        </Banner>
      ) : null}
      {unsaved ? (
        <Banner
          tone="warning"
          title="Kaydedilmemiş bir aktiviten var"
          action={{ label: 'Özeti aç', onPress: () => router.push({ pathname: '/summary/[id]', params: { id: unsaved.id } }) }}
        >
          {formatDistance(unsaved.distanceM, units)} · {formatDuration(unsaved.movingTimeS)}
        </Banner>
      ) : null}

      <Card>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 16, columnGap: 12 }}>
          {tile('Toplam mesafe', dist.value, dist.unit)}
          {tile('Aktivite', String(local.count))}
          {tile('Toplam süre', hoursMinutes(local.timeS))}
          {stats || local.claimedCells > 0 ? tile(stats ? 'Sahip olduğun hücre' : 'Kazanılan hücre', String(cellCount), 'hücre') : tile('Kazanılan hücre', '—')}
        </View>
      </Card>

      {season ? <SeasonCard season={season} /> : null}

      <View style={{ gap: 10 }}>
        <Txt variant="heading">Kişisel rekorlar</Txt>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {[
            { label: '5 km', value: local.best5kS != null ? formatDuration(local.best5kS) : '—' },
            { label: '10 km', value: local.best10kS != null ? formatDuration(local.best10kS) : '—' },
            { label: 'En uzun', value: local.longestM ? formatDistance(local.longestM, units) : '—' },
          ].map((r) => (
            <View key={r.label} accessible accessibilityLabel={`${r.label}: ${r.value}`} style={{ flex: 1, padding: 12, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 4 }}>
              <Txt variant="caption" muted style={{ fontFamily: fonts.bodySemi }}>{r.label}</Txt>
              <Text style={{ fontFamily: fonts.display, fontSize: 22, color: colors.text, fontVariant: ['tabular-nums'] }} numberOfLines={1} adjustsFontSizeToFit>
                {r.value}
              </Text>
            </View>
          ))}
        </View>
      </View>

      <View style={{ gap: 10 }}>
        <Txt variant="heading">Aktivite geçmişi</Txt>
        <Chips
          label="Aktivite türüne göre filtrele"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'Tümü' },
            { value: 'run', label: 'Koşu' },
            { value: 'walk', label: 'Yürüyüş' },
            { value: 'ride', label: 'Bisiklet' },
            { value: 'wheelchair', label: 'Sandalye' },
          ]}
        />
        {loading || (syncing && activities.length === 0) ? (
          <Loading label={syncing ? 'Aktivitelerin yükleniyor' : undefined} />
        ) : list.length === 0 ? (
          <EmptyState
            icon="route"
            title={activities.length === 0 ? 'Henüz aktivite yok' : 'Bu türde aktivite yok'}
            message={activities.length === 0 ? 'Haritadan ilk aktiviteni başlat; yürüyüş de sayılır.' : undefined}
          />
        ) : (
          <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, borderWidth: 1, borderColor: colors.border }}>
            {list.map((a, i) => (
              <Pressable
                key={a.id}
                accessibilityRole="button"
                accessibilityLabel={`${a.title || 'Aktivite'}, ${formatDistance(a.distanceM, units)}, ${formatDuration(a.movingTimeS)}, görünürlük ${VISIBILITY_LABEL[a.visibility]}`}
                onPress={() => router.push({ pathname: '/activity/[id]', params: { id: a.id } })}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  padding: 14,
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: colors.border,
                }}
              >
                <Icon name={a.type} size={26} color={colors.text} strokeWidth={1.9} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt variant="body" style={{ fontFamily: fonts.bodySemi }} numberOfLines={1}>{a.title || 'Aktivite'}</Txt>
                  <Txt variant="caption" muted>
                    {new Date(a.startedAt).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })} · {formatDistance(a.distanceM, units)} ·{' '}
                    {formatDuration(a.movingTimeS)}
                    {sourceLabel(a) ? ` · ${sourceLabel(a)}` : ''}
                    {a.syncState === 'pending_upload' ? ' · yükleme bekliyor' : a.syncState === 'rejected' ? ' · doğrulanmadı' : ''}
                  </Txt>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 10, borderRadius: 16, backgroundColor: colors.bg }}>
                  <Icon name={VISIBILITY_ICON[a.visibility]} size={14} color={colors.text2} />
                  <Text style={{ fontFamily: fonts.bodySemi, fontSize: 12, color: colors.text2 }}>{VISIBILITY_LABEL[a.visibility]}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}
      </View>

      <Group>
        {health ? (
          <NavRow icon="heart" label="Saat antrenmanlarını aktar" sub={health.watches} onPress={() => router.push('/import-health')} />
        ) : null}
        {session && stravaConfigured ? (
          <NavRow icon="route" label="Strava’dan aktar" sub="Garmin, Coros, Suunto" onPress={() => router.push('/import-strava')} />
        ) : null}
        {session ? (
          <NavRow icon="shield" label="İlçe takımın" value={homeDistrict ?? 'Seç'} onPress={() => router.push('/district')} />
        ) : null}
        <NavRow icon="users" label="Takip ve takipçiler" onPress={() => router.push('/people')} />
        <NavRow icon="rank" label="Kulüpler" onPress={() => router.push('/clubs')} />
        <NavRow icon="bell" label="Bildirimler" onPress={() => router.push('/inbox')} last />
      </Group>
      <Button label="Oyun kuralları" variant="text" onPress={() => router.push('/how-it-works')} />
    </Screen>
  );
}

const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

/** Monthly season: rank, progress to the next rank, and cells about to decay. */
function SeasonCard({ season }: { season: MySeason }) {
  const { colors } = useTheme();
  const rank = seasonRank(season.points);
  const days = seasonDaysLeft(season.seasonEnd);
  const month = MONTHS[new Date(season.seasonStart).getMonth()];
  return (
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ gap: 2 }}>
          <Txt variant="caption" muted>{`${month} sezonu · ${days} gün kaldı`}</Txt>
          <Text style={{ fontFamily: fonts.display, fontSize: 28, color: colors.text }}>{rank.tier}</Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          <Text style={{ fontFamily: fonts.display, fontSize: 22, color: colors.primaryText }}>{`${Math.round(season.points)} puan`}</Text>
          <Txt variant="caption" muted>{`Genel #${season.position}`}</Txt>
        </View>
      </View>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={rank.next ? `${rank.next.tier} rütbesine ${rank.next.remaining} puan kaldı` : 'En üst rütbedesin'}
        style={{ height: 8, borderRadius: 4, backgroundColor: colors.surface2, overflow: 'hidden' }}
      >
        <View style={{ width: `${Math.round(rank.progress * 100)}%`, height: 8, backgroundColor: colors.primary }} />
      </View>
      <Txt variant="caption" muted>
        {rank.next ? `${rank.next.tier} için ${rank.next.remaining} puan` : 'En üst rütbedesin'}
        {season.landmarks > 0 ? ` · ${season.landmarks} kale senin` : ''}
        {' · Puan: kazandığın + aldığın hücreler, kale +5'}
      </Txt>
      {season.weakCells > 0 ? (
        <Banner tone="warning" title={`${season.weakCells} hücren zayıfladı`} action={{ label: 'Haritada gör', onPress: () => router.push('/(tabs)') }}>
          3 haftadır üzerinden geçmedin. 6 haftayı doldurursa boşalır; üzerinden geçmen yeterli.
        </Banner>
      ) : null}
    </Card>
  );
}
