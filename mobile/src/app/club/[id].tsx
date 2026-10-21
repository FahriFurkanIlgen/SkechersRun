import { useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Share, Text, View } from 'react-native';
import { Avatar, Banner, Button, EmptyState, Loading, Screen, Txt } from '../../components/ui';
import { fetchClubDetail, joinClub, leaveClub, type ClubDetail } from '../../data/remote/socialApi';
import { formatCells } from '../../domain/format';
import { useRemoteList } from '../../features/social/useRemoteList';
import { fonts, radius, useTheme } from '../../theme/theme';

/** One club: its members ranked by this week's gains, and its total territory. */
export default function ClubScreen() {
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loader = useCallback(async (): Promise<ClubDetail[]> => {
    const d = id ? await fetchClubDetail(id) : null;
    return d ? [d] : [];
  }, [id]);
  const detail = useRemoteList<ClubDetail>(loader);
  const club = detail.items[0];

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      detail.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (detail.loading && !club) return <Screen edges={[]}><Loading /></Screen>;
  if (!club) {
    return (
      <Screen edges={[]}>
        <EmptyState icon="users" title="Kulüp bulunamadı" message={detail.error ?? 'Kulüp gizli olabilir; katılmak için davet kodu gerekir.'} />
      </Screen>
    );
  }

  const weekly = club.members.reduce((s, m) => s + m.weeklyGain, 0);
  const cells = club.members.reduce((s, m) => s + m.cells, 0);

  return (
    <Screen edges={[]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <Avatar name={club.name} size={56} />
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="title" style={{ fontSize: 26 }} numberOfLines={2}>{club.name}</Txt>
          <Txt variant="caption" muted>{`${club.members.length} üye${club.isPrivate ? ' · gizli kulüp' : ''}`}</Txt>
        </View>
      </View>
      {club.description ? <Txt variant="bodySm" muted>{club.description}</Txt> : null}
      {error ? <Banner tone="danger">{error}</Banner> : null}

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Stat label="Bu hafta" value={`+${weekly}`} />
        <Stat label="Haritada" value={formatCells(cells)} />
      </View>

      {club.isMember && club.inviteCode ? (
        <Button
          label={`Davet kodu: ${club.inviteCode} · paylaş`}
          variant="secondary"
          onPress={() =>
            void Share.share({
              message: `${club.name} kulübüne katıl: Battle Run'da Kulüpler → "Davet kodu" alanına ${club.inviteCode} yaz.`,
            })
          }
        />
      ) : null}

      <Txt variant="heading">Üyeler · bu hafta</Txt>
      <View accessibilityRole="list" style={{ gap: 6 }}>
        {club.members.map((m, i) => (
          <View
            key={m.userId}
            accessible
            accessibilityLabel={`${i + 1}. ${m.isMe ? 'sen' : m.username}${m.role === 'owner' ? ', kurucu' : ''}, bu hafta ${m.weeklyGain} hücre`}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              minHeight: 56,
              paddingHorizontal: 12,
              borderRadius: radius.md,
              borderWidth: 2,
              borderColor: m.isMe ? colors.primary : 'transparent',
              backgroundColor: m.isMe ? colors.primarySoft : 'transparent',
            }}
          >
            <Text style={{ width: 28, fontFamily: fonts.display, fontSize: 17, color: colors.text, textAlign: 'center' }}>{i + 1}</Text>
            <Avatar name={m.username} size={34} highlight={m.isMe} />
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="body" style={{ fontFamily: fonts.bodySemi }} numberOfLines={1}>{m.isMe ? 'Sen' : m.username}</Txt>
              <Txt variant="caption" muted>{`${m.role === 'owner' ? 'Kurucu · ' : ''}haritada ${formatCells(m.cells)}`}</Txt>
            </View>
            <Text style={{ fontFamily: fonts.display, fontSize: 17, color: colors.text, fontVariant: ['tabular-nums'] }}>{`+${m.weeklyGain}`}</Text>
          </View>
        ))}
      </View>

      {!club.isMember ? (
        <Button label="Kulübe katıl" loading={busy} onPress={() => void act(() => joinClub({ clubId: club.id }))} />
      ) : !club.isOwner ? (
        <Button label="Kulüpten ayrıl" variant="text" disabled={busy} onPress={() => void act(() => leaveClub(club.id))} />
      ) : null}
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, padding: 14, borderRadius: radius.card, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 4 }}>
      <Txt variant="caption" muted>{label}</Txt>
      <Text style={{ fontFamily: fonts.display, fontSize: 24, color: colors.text }}>{value}</Text>
    </View>
  );
}
