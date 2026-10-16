import { router } from 'expo-router';
import { useCallback } from 'react';
import { ConnectionBanner } from '../components/StatusBanners';
import { Button, EmptyState, Group, Loading, NavRow, Screen } from '../components/ui';
import { fetchNotifications, joinClub, markNotificationsRead, respondFollow } from '../data/remote/socialApi';
import { formatCells } from '../domain/format';
import type { AppNotification } from '../domain/types';
import { useRemoteList } from '../features/social/useRemoteList';

function describe(n: AppNotification): string {
  const cells = typeof n.payload.cells === 'number' ? formatCells(n.payload.cells) : '';
  switch (n.kind) {
    case 'activity_completed':
      return 'Aktiviten işlendi';
    case 'territory_gained':
      return `+${cells} kazandın`;
    case 'territory_lost':
      return n.payload.reason === 'decay'
        ? `${cells} uzun süre uğramadığın için boşaldı`
        : `${cells} başka bir oyuncuya geçti`;
    case 'follow_request':
      return 'Yeni takip isteği';
    case 'new_follower':
      return 'Yeni bir takipçin var';
    case 'live_share':
      return `${String(n.payload.username ?? 'Bir arkadaşın')} canlı konumunu seninle paylaşıyor`;
    case 'club_invite':
      return `“${String(n.payload.club_name ?? '')}” kulübüne davet edildin`;
  }
}

export default function Inbox() {
  const loader = useCallback(async () => {
    const list = await fetchNotifications();
    await markNotificationsRead(list.filter((n) => !n.readAt).map((n) => n.id)).catch(() => undefined);
    return list;
  }, []);
  const { items, loading, error, available, reload } = useRemoteList<AppNotification>(loader);

  return (
    <Screen edges={[]}>
      <ConnectionBanner feature="Bildirimler" />
      {!available ? null : loading && !items.length ? (
        <Loading />
      ) : error ? (
        <EmptyState icon="alert" title="Bildirimler yüklenemedi" message={error} action={{ label: 'Tekrar dene', onPress: reload }} />
      ) : items.length === 0 ? (
        <EmptyState icon="bell" title="Bildirim yok" message="Bölge değişiklikleri, takip istekleri ve kulüp davetleri burada görünür." />
      ) : (
        <Group>
          {items.map((n, i) => (
            <NavRow
              key={n.id}
              label={`${n.readAt ? '' : '● '}${describe(n)}`}
              sub={new Date(n.createdAt).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' })}
              last={i === items.length - 1}
              right={
                n.kind === 'follow_request' ? (
                  <Button label="Onayla" variant="secondary" size="sm" onPress={() => void respondFollow(String(n.payload.user_id), true).then(reload)} />
                ) : n.kind === 'live_share' && n.payload.share_id ? (
                  <Button label="Gör" variant="secondary" size="sm" onPress={() => router.push({ pathname: '/live/[id]', params: { id: String(n.payload.share_id) } })} />
                ) : n.kind === 'club_invite' ? (
                  <Button label="Katıl" variant="secondary" size="sm" onPress={() => void joinClub({ code: String(n.payload.invite_code) }).then(reload)} />
                ) : undefined
              }
            />
          ))}
        </Group>
      )}
    </Screen>
  );
}
