import { router } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Icon } from '../../components/Icon';
import { RoutePreview } from '../../components/RouteMap';
import { ConnectionBanner } from '../../components/StatusBanners';
import { Avatar, Button, EmptyState, IconButton, Loading, Screen, Txt } from '../../components/ui';
import { fetchFeed, toggleLike } from '../../data/remote/socialApi';
import { ACTIVITY_LABEL, formatCells, formatDistance, formatDuration, relativeTime } from '../../domain/format';
import type { FeedPost } from '../../domain/types';
import { useRemoteList } from '../../features/social/useRemoteList';
import { useSettings } from '../../state/settingsStore';
import { fonts, radius, useTheme } from '../../theme/theme';

/** 08a Sosyal akış (+ boş liste) */
export default function Feed() {
  const { colors } = useTheme();
  const units = useSettings((s) => s.units);
  const loader = useCallback(() => fetchFeed(), []);
  const { items, setItems, loading, error, available, reload } = useRemoteList<FeedPost>(loader);

  const like = async (post: FeedPost) => {
    const liked = await toggleLike(post.id);
    setItems((list) => list.map((p) => (p.id === post.id ? { ...p, likedByMe: liked, likeCount: p.likeCount + (liked ? 1 : -1) } : p)));
  };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ gap: 2 }}>
          <Txt variant="title">Akış</Txt>
          <Txt variant="bodySm" muted>Takip ettiklerin</Txt>
        </View>
        <IconButton icon="addUser" label="Arkadaş bul" onPress={() => router.push('/people')} />
      </View>
      <ConnectionBanner feature="Aktivite akışı" />

      {!available ? null : loading && items.length === 0 ? (
        <Loading />
      ) : error ? (
        <EmptyState icon="alert" title="Akış yüklenemedi" message={error} action={{ label: 'Tekrar dene', onPress: reload }} />
      ) : items.length === 0 ? (
        <EmptyState
          icon="users"
          title="Akışın henüz sessiz"
          message="Birilerini takip ettiğinde aktiviteleri burada görünür. Kendi aktivitelerin her zaman Profil’de."
          action={{ label: 'Arkadaş bul', onPress: () => router.push('/people') }}
          secondary={{ label: 'Kulüplere göz at', onPress: () => router.push('/clubs') }}
        />
      ) : (
        items.map((p) => (
          <View
            key={p.id}
            accessibilityLabel={`${p.username}, ${p.title || ACTIVITY_LABEL[p.activityType]}`}
            style={{ backgroundColor: colors.surface, borderRadius: radius.card, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 12 }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Avatar name={p.username} size={40} />
              <View style={{ flex: 1, gap: 2 }}>
                <Txt variant="body" style={{ fontFamily: fonts.bodyBold }}>{p.username}</Txt>
                <Txt variant="caption" muted>
                  {ACTIVITY_LABEL[p.activityType]} · {relativeTime(p.createdAt)}
                </Txt>
              </View>
            </View>
            <Txt variant="heading">{p.title || ACTIVITY_LABEL[p.activityType]}</Txt>
            {p.publicRoute && p.publicRoute.length > 1 ? (
              <RoutePreview
                coords={p.publicRoute.map(([lng, lat]) => ({ latitude: lat, longitude: lng }))}
                label="Rota önizlemesi, başlangıç ve bitiş noktaları gizli"
              />
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, backgroundColor: colors.bg }}>
                <Icon name="lock" size={18} color={colors.text2} />
                <Txt variant="bodySm" muted>Rota gizli · yalnızca istatistikler paylaşıldı</Txt>
              </View>
            )}
            <View style={{ flexDirection: 'row' }}>
              {[
                { label: 'Mesafe', value: formatDistance(p.distanceM, units) },
                { label: 'Süre', value: formatDuration(p.movingTimeS) },
                { label: 'Hücre', value: p.netGainCells > 0 ? `+${formatCells(p.netGainCells)}` : '—' },
              ].map((s) => (
                <View key={s.label} style={{ flex: 1, gap: 2 }} accessible accessibilityLabel={`${s.label}: ${s.value}`}>
                  <Txt variant="caption" muted>{s.label}</Txt>
                  <Text style={{ fontFamily: fonts.display, fontSize: 20, color: colors.text, fontVariant: ['tabular-nums'] }}>{s.value}</Text>
                </View>
              ))}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: p.likedByMe }}
              accessibilityLabel={`${p.likedByMe ? 'Beğenini geri al' : 'Beğen'}, ${p.likeCount} beğeni`}
              onPress={() => void like(p).catch(() => undefined)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', height: 44, paddingHorizontal: 14, borderRadius: 22, borderWidth: 1, borderColor: colors.border }}
            >
              <Icon name="heart" size={20} color={p.likedByMe ? colors.danger : colors.text2} fill={p.likedByMe ? colors.danger : 'none'} />
              <Text style={{ fontFamily: fonts.bodySemi, fontSize: 15, color: p.likedByMe ? colors.danger : colors.text2 }}>{p.likeCount}</Text>
            </Pressable>
          </View>
        ))
      )}
      {available && items.length > 0 ? (
        <Button label="Yenile" variant="text" onPress={reload} />
      ) : null}
    </Screen>
  );
}
