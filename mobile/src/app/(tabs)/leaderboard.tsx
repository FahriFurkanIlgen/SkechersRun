import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ConnectionBanner } from '../../components/StatusBanners';
import { Icon } from '../../components/Icon';
import { Avatar, Button, EmptyState, Loading, Screen, Segmented, Txt } from '../../components/ui';
import {
  fetchClubs,
  fetchLeaderboard,
  joinClub,
  type LeaderboardMetric,
  type LeaderboardRow,
} from '../../data/remote/socialApi';
import { formatCells } from '../../domain/format';
import type { Club } from '../../domain/types';
import { useRemoteList } from '../../features/social/useRemoteList';
import { useSettings } from '../../state/settingsStore';
import { fonts, radius, useTheme } from '../../theme/theme';

type Scope = 'near' | 'city' | 'global';
type Who = 'all' | 'friends';

const SUBTITLE: Record<LeaderboardMetric, string> = {
  weekly_gain: 'Bu hafta kazanılan hücre · Her pazartesi yeniden başlar',
  area: 'Şu an sahip olunan hücre',
  active_days: 'Son 28 günde en az 1 km hareket edilen gün sayısı',
};

/** 07 Sıralamalar ve kulüpler */
export default function Leaderboard() {
  const { colors } = useTheme();
  const level = useSettings((s) => s.level);
  const [scope, setScope] = useState<Scope>('near');
  const [metric, setMetric] = useState<LeaderboardMetric>('weekly_gain');
  const [who, setWho] = useState<Who>('all');
  const [similar, setSimilar] = useState(true);

  const loader = useCallback(async () => {
    let center: { latitude: number; longitude: number } | undefined;
    if (scope !== 'global') {
      const pos =
        (await Location.getLastKnownPositionAsync({ maxAge: 10 * 60_000 })) ??
        (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }).catch(() => null));
      if (!pos) throw new Error('Yakın çevre sıralaması için konum gerekli. Genel sıralamayı seçebilirsin.');
      center = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
    }
    return fetchLeaderboard({
      scope: scope === 'global' ? 'global' : 'nearby',
      metric,
      level: similar ? level : null,
      center,
      radiusKm: scope === 'near' ? 5 : 25,
      who,
    });
  }, [scope, metric, who, similar, level]);
  const board = useRemoteList<LeaderboardRow>(loader);
  const clubsLoader = useCallback(() => fetchClubs(), []);
  const clubs = useRemoteList<Club>(clubsLoader);

  const valueText = (v: number) => (metric === 'active_days' ? `${v} gün` : formatCells(v));

  return (
    <Screen>
      <View style={{ gap: 2 }}>
        <Txt variant="title">Sıralama</Txt>
        <Txt variant="bodySm" muted>{SUBTITLE[metric]}</Txt>
      </View>
      <ConnectionBanner feature="Sıralamalar" />

      <Segmented
        label=""
        value={scope}
        onChange={setScope}
        options={[
          { value: 'near', label: 'Yakın · 5 km' },
          { value: 'city', label: 'Şehir · 25 km' },
          { value: 'global', label: 'Genel' },
        ]}
      />
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
          { value: 'weekly_gain', label: 'Haftalık hücre' },
          { value: 'area', label: 'Toplam hücre' },
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
                <Txt variant="caption" muted>Bu hafta {r.weeklyActivities} aktivite</Txt>
              </View>
              <Text style={{ fontFamily: fonts.display, fontSize: 18, color: colors.text, fontVariant: ['tabular-nums'] }}>{valueText(r.value)}</Text>
            </View>
          ))}
        </View>
      )}
      {board.available ? <Txt variant="caption" muted>Gizli profiller ve sıralamada görünmek istemeyenler listelenmez.</Txt> : null}

      {clubs.available ? (
        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Txt variant="heading">Kulüpler</Txt>
            <Button label="Tümü" variant="text" size="sm" onPress={() => router.push('/clubs')} />
          </View>
          {clubs.items.length === 0 && !clubs.loading ? (
            <Txt variant="bodySm" muted>Henüz kulüp yok. İlk kulübü sen kur.</Txt>
          ) : null}
          {clubs.items.slice(0, 3).map((c) => (
            <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radius.card, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
              <Avatar name={c.name} size={44} />
              <View style={{ flex: 1, gap: 2 }}>
                <Txt variant="body" style={{ fontFamily: fonts.bodySemi }} numberOfLines={1}>{c.name}</Txt>
                <Txt variant="caption" muted>{c.memberCount} üye{c.description ? ` · ${c.description}` : ''}</Txt>
              </View>
              {c.isMember ? (
                <Txt variant="caption" muted>Üyesin</Txt>
              ) : (
                <Button label="Katıl" variant="secondary" size="sm" onPress={() => void joinClub({ clubId: c.id }).then(clubs.reload)} />
              )}
            </View>
          ))}
        </View>
      ) : null}
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
