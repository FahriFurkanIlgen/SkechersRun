import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ConnectionBanner } from '../../components/StatusBanners';
import { Icon } from '../../components/Icon';
import { Avatar, Button, EmptyState, Loading, Screen, Segmented, Txt } from '../../components/ui';
import {
  fetchClubLeaderboard,
  fetchDistrictBattle,
  fetchDistrictLeaderboard,
  fetchLeaderboard,
  type ClubRankRow,
  type DistrictBattleRow,
  type LeaderboardMetric,
  type LeaderboardRow,
} from '../../data/remote/socialApi';
import { areaAt, type Area } from '../../services/area';
import { formatCells } from '../../domain/format';
import { useRemoteList } from '../../features/social/useRemoteList';
import { useSettings } from '../../state/settingsStore';
import { fonts, radius, useTheme } from '../../theme/theme';

type Scope = 'near' | 'district' | 'city' | 'global';
type Mode = 'players' | 'districts' | 'clubs';

async function currentPosition() {
  return (
    (await Location.getLastKnownPositionAsync({ maxAge: 10 * 60_000 })) ??
    (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }).catch(() => null))
  );
}
type Who = 'all' | 'friends';

const SUBTITLE: Record<LeaderboardMetric, string> = {
  weekly_gain: 'Bu hafta kazanılan hücre · Her pazartesi yeniden başlar',
  area: 'Şu an sahip olunan hücre',
  active_days: 'Son 28 günde en az 1 km hareket edilen gün sayısı',
  season: 'Bu ayın sezon puanı · kazanılan + alınan hücreler + kale bonusu',
};

/** 07 Sıralamalar ve kulüpler */
export default function Leaderboard() {
  const { colors } = useTheme();
  const level = useSettings((s) => s.level);
  const homeCity = useSettings((s) => s.homeCity);
  const homeDistrict = useSettings((s) => s.homeDistrict);
  const [mode, setMode] = useState<Mode>('players');
  const [area, setArea] = useState<Area | null>(null);
  const [scope, setScope] = useState<Scope>('near');
  const [metric, setMetric] = useState<LeaderboardMetric>('weekly_gain');
  const [who, setWho] = useState<Who>('all');
  const [similar, setSimilar] = useState(true);

  const loader = useCallback(async (): Promise<LeaderboardRow[]> => {
    if (mode === 'districts') return [];
    let center: { latitude: number; longitude: number } | undefined;
    if (scope !== 'global') {
      const pos = await currentPosition();
      if (!pos) throw new Error('Yakın çevre sıralaması için konum gerekli. Genel sıralamayı seçebilirsin.');
      center = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
    }
    if (scope === 'district') {
      const here = await areaAt(center!);
      setArea(here);
      if (!here) throw new Error('Bulunduğun ilçe belirlenemedi. Yakın çevre sıralamasını kullanabilirsin.');
      const rows = await fetchDistrictLeaderboard(here.city, here.district, metric === 'area' ? 'area' : 'weekly_gain');
      return rows.map((r) => ({ ...r, weeklyActivities: -1 }));
    }
    return fetchLeaderboard({
      scope: scope === 'global' ? 'global' : 'nearby',
      metric,
      level: similar ? level : null,
      center,
      radiusKm: scope === 'near' ? 5 : 25,
      who,
    });
  }, [mode, scope, metric, who, similar, level]);
  const board = useRemoteList<LeaderboardRow>(loader);

  // District battle: the player's home city, otherwise the city they are in now.
  const battleLoader = useCallback(async (): Promise<DistrictBattleRow[]> => {
    if (mode !== 'districts') return [];
    let city = homeCity;
    if (!city) {
      const pos = await currentPosition();
      const here = pos ? await areaAt({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }) : null;
      setArea(here);
      city = here?.city ?? null;
    }
    if (!city) throw new Error('Şehrin belirlenemedi. Konum iznini aç ya da ilçe takımını seç.');
    return fetchDistrictBattle(city);
  }, [mode, homeCity]);
  const battle = useRemoteList<DistrictBattleRow>(battleLoader);
  const clubsLoader = useCallback(async (): Promise<ClubRankRow[]> => (mode === 'clubs' ? fetchClubLeaderboard() : []), [mode]);
  const clubs = useRemoteList<ClubRankRow>(clubsLoader);

  const valueText = (v: number) => (metric === 'active_days' ? `${v} gün` : metric === 'season' ? `${v} puan` : formatCells(v));

  return (
    <Screen>
      <View style={{ gap: 2 }}>
        <Txt variant="title">Sıralama</Txt>
        <Txt variant="bodySm" muted>{SUBTITLE[metric]}</Txt>
      </View>
      <ConnectionBanner feature="Sıralamalar" />

      <Segmented
        label=""
        value={mode}
        onChange={setMode}
        options={[
          { value: 'players', label: 'Oyuncular' },
          { value: 'districts', label: 'İlçeler' },
          { value: 'clubs', label: 'Kulüpler' },
        ]}
      />

      {mode === 'clubs' ? (
        <ClubRanking rows={clubs.items} loading={clubs.loading} error={clubs.error} available={clubs.available} reload={clubs.reload} />
      ) : mode === 'districts' ? (
        <DistrictBattle
          rows={battle.items}
          loading={battle.loading}
          error={battle.error}
          available={battle.available}
          reload={battle.reload}
          city={homeCity ?? area?.city ?? null}
          homeDistrict={homeDistrict}
        />
      ) : (
      <>
      <Segmented
        label=""
        value={scope}
        onChange={setScope}
        options={[
          { value: 'near', label: 'Yakın' },
          { value: 'district', label: 'İlçe' },
          { value: 'city', label: 'Şehir' },
          { value: 'global', label: 'Genel' },
        ]}
      />
      {scope === 'district' && area ? (
        <Txt variant="caption" muted>{`${area.district} · ${area.city} — bu ilçede kazanılan hücreler`}</Txt>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {(
          [
            { id: 'all', label: 'Herkes' },
            { id: 'friends', label: 'Arkadaşlar' },
          ] as const
        ).map((c) => (
          <Chip key={c.id} label={c.label} selected={who === c.id} onPress={() => setWho(c.id)} />
        ))}
        <Chip label="Benzer seviyedekiler" icon selected={similar} onPress={() => setSimilar((v) => !v)} />
      </View>
      <Segmented
        label="Ölçüt"
        value={metric}
        onChange={setMetric}
        options={[
          { value: 'weekly_gain', label: 'Haftalık' },
          { value: 'season', label: 'Sezon' },
          { value: 'area', label: 'Toplam' },
          { value: 'active_days', label: 'Tutarlılık' },
        ]}
      />

      {!board.available ? null : board.loading && board.items.length === 0 ? (
        <Loading />
      ) : board.error ? (
        <EmptyState icon="alert" title="Sıralama yüklenemedi" message={board.error} action={{ label: 'Tekrar dene', onPress: board.reload }} />
      ) : board.items.length === 0 ? (
        <EmptyState icon="rank" title="Henüz kimse yok" message="Bu filtrede sıralamaya giren ilk kişi sen olabilirsin." />
      ) : (
        <View accessibilityRole="list" style={{ gap: 6 }}>
          {board.items.map((r) => (
            <View
              key={r.userId}
              accessible
              accessibilityLabel={`${r.rank}. sıra, ${r.isMe ? 'sen' : r.username}, ${valueText(r.value)}, bu hafta ${r.weeklyActivities} aktivite`}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                minHeight: 60,
                paddingHorizontal: 12,
                borderRadius: radius.md,
                borderWidth: 2,
                borderColor: r.isMe ? colors.primary : 'transparent',
                backgroundColor: r.isMe ? colors.primarySoft : 'transparent',
              }}
            >
              <Text style={{ width: 32, fontFamily: fonts.display, fontSize: 18, color: r.isMe ? colors.primaryText : colors.text, textAlign: 'center' }}>{r.rank}</Text>
              <Avatar name={r.username} size={36} highlight={r.isMe} />
              <View style={{ flex: 1, gap: 2 }}>
                <Txt variant="body" style={{ fontFamily: r.isMe ? fonts.bodyBold : fonts.bodySemi }} numberOfLines={1}>{r.isMe ? 'Sen' : r.username}</Txt>
                {r.weeklyActivities >= 0 ? <Txt variant="caption" muted>Bu hafta {r.weeklyActivities} aktivite</Txt> : null}
              </View>
              <Text style={{ fontFamily: fonts.display, fontSize: 18, color: colors.text, fontVariant: ['tabular-nums'] }}>{valueText(r.value)}</Text>
            </View>
          ))}
        </View>
      )}
      {board.available ? <Txt variant="caption" muted>Gizli profiller ve sıralamada görünmek istemeyenler listelenmez.</Txt> : null}
      </>
      )}

    </Screen>
  );
}

function Chip({ label, selected, onPress, icon }: { label: string; selected: boolean; onPress: () => void; icon?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        height: 40,
        paddingHorizontal: 14,
        borderRadius: 20,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: selected ? colors.text : colors.surface,
        borderWidth: 1,
        borderColor: selected ? colors.text : colors.border,
      }}
    >
      {icon && selected ? <Icon name="check" size={16} color={colors.bg} strokeWidth={2.4} /> : null}
      <Text style={{ fontSize: 14, fontFamily: fonts.bodyBold, color: selected ? colors.bg : colors.text }}>{label}</Text>
    </Pressable>
  );
}

/** Districts of a city competing this week; teams are players who chose the district as home. */
function DistrictBattle({
  rows,
  loading,
  error,
  available,
  reload,
  city,
  homeDistrict,
}: {
  rows: DistrictBattleRow[];
  loading: boolean;
  error: string | null;
  available: boolean;
  reload: () => void;
  city: string | null;
  homeDistrict: string | null;
}) {
  const { colors } = useTheme();
  if (!available) return null;
  return (
    <View style={{ gap: 10 }}>
      <Txt variant="bodySm" muted>
        {city ? `${city} · ` : ''}Takımların bu hafta kazandığı hücreler. Her pazartesi yeniden başlar.
      </Txt>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push('/district')}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radius.card, borderWidth: 1, borderColor: homeDistrict ? colors.border : colors.primary, backgroundColor: homeDistrict ? colors.surface : colors.primarySoft }}
      >
        <Icon name="shield" size={24} color={colors.primary} />
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="body" style={{ fontFamily: fonts.bodySemi }}>{homeDistrict ? `Takımın: ${homeDistrict}` : 'İlçe takımını seç'}</Txt>
          <Txt variant="caption" muted>{homeDistrict ? 'Değiştirmek için dokun' : 'Kazandığın hücreler ilçenin puanına eklensin'}</Txt>
        </View>
        <Icon name="chevronRight" size={20} color={colors.text2} />
      </Pressable>
      {loading && rows.length === 0 ? (
        <Loading />
      ) : error ? (
        <EmptyState icon="alert" title="İlçe savaşı yüklenemedi" message={error} action={{ label: 'Tekrar dene', onPress: reload }} />
      ) : rows.length === 0 ? (
        <EmptyState icon="rank" title="Henüz ilçe yok" message="Bu şehirde ilk hücreyi kazanan ilçeyi savaşa sokar." />
      ) : (
        <View accessibilityRole="list" style={{ gap: 6 }}>
          {rows.map((r) => (
            <View
              key={r.district}
              accessible
              accessibilityLabel={`${r.rank}. sıra, ${r.district}${r.isMine ? ', senin takımın' : ''}, bu hafta ${r.weeklyGain} hücre, ${r.teamSize} oyuncu`}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                minHeight: 60,
                paddingHorizontal: 12,
                borderRadius: radius.md,
                borderWidth: 2,
                borderColor: r.isMine ? colors.primary : 'transparent',
                backgroundColor: r.isMine ? colors.primarySoft : 'transparent',
              }}
            >
              <Text style={{ width: 32, fontFamily: fonts.display, fontSize: 18, color: r.isMine ? colors.primaryText : colors.text, textAlign: 'center' }}>{r.rank}</Text>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt variant="body" style={{ fontFamily: r.isMine ? fonts.bodyBold : fonts.bodySemi }} numberOfLines={1}>{r.district}</Txt>
                <Txt variant="caption" muted>{`${r.teamSize} oyuncu · haritada ${formatCells(r.cells)}`}</Txt>
              </View>
              <Text style={{ fontFamily: fonts.display, fontSize: 18, color: colors.text, fontVariant: ['tabular-nums'] }}>{`+${r.weeklyGain}`}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

/** Clubs ranked by what their members gained this week. */
function ClubRanking({
  rows,
  loading,
  error,
  available,
  reload,
}: {
  rows: ClubRankRow[];
  loading: boolean;
  error: string | null;
  available: boolean;
  reload: () => void;
}) {
  const { colors } = useTheme();
  if (!available) return null;
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Txt variant="bodySm" muted style={{ flex: 1 }}>Üyelerin bu hafta kazandığı hücreler. Her pazartesi yeniden başlar.</Txt>
        <Button label="Kur / katıl" variant="text" size="sm" onPress={() => router.push('/clubs')} />
      </View>
      {loading && rows.length === 0 ? (
        <Loading />
      ) : error ? (
        <EmptyState icon="alert" title="Kulüpler yüklenemedi" message={error} action={{ label: 'Tekrar dene', onPress: reload }} />
      ) : rows.length === 0 ? (
        <EmptyState icon="users" title="Henüz kulüp yok" message="İlk kulübü sen kur, arkadaşlarını davet kodu ile çağır." />
      ) : (
        <View accessibilityRole="list" style={{ gap: 6 }}>
          {rows.map((r) => (
            <Pressable
              key={r.clubId}
              accessibilityRole="button"
              accessibilityLabel={`${r.rank}. sıra, ${r.name}${r.isMember ? ', üyesin' : ''}, bu hafta ${r.weeklyGain} hücre, ${r.memberCount} üye`}
              onPress={() => router.push({ pathname: '/club/[id]', params: { id: r.clubId } })}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                minHeight: 60,
                paddingHorizontal: 12,
                borderRadius: radius.md,
                borderWidth: 2,
                borderColor: r.isMember ? colors.primary : 'transparent',
                backgroundColor: r.isMember ? colors.primarySoft : 'transparent',
              }}
            >
              <Text style={{ width: 32, fontFamily: fonts.display, fontSize: 18, color: r.isMember ? colors.primaryText : colors.text, textAlign: 'center' }}>{r.rank}</Text>
              <Avatar name={r.name} size={36} highlight={r.isMember} />
              <View style={{ flex: 1, gap: 2 }}>
                <Txt variant="body" style={{ fontFamily: fonts.bodySemi }} numberOfLines={1}>{r.name}</Txt>
                <Txt variant="caption" muted>{`${r.memberCount} üye · haritada ${formatCells(r.cells)}`}</Txt>
              </View>
              <Text style={{ fontFamily: fonts.display, fontSize: 18, color: colors.text, fontVariant: ['tabular-nums'] }}>{`+${r.weeklyGain}`}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}
