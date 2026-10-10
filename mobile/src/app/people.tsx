import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { ConnectionBanner } from '../components/StatusBanners';
import { Avatar, Banner, Button, EmptyState, Field, Group, Loading, NavRow, Screen, Txt } from '../components/ui';
import {
  fetchFollowGraph,
  followUser,
  respondFollow,
  searchUsers,
  unfollowUser,
  type PersonRow,
} from '../data/remote/socialApi';
import { useRemoteList } from '../features/social/useRemoteList';
import { useAuth } from '../state/authStore';

type Graph = { followers: PersonRow[]; following: PersonRow[] };

export default function People() {
  const myId = useAuth((s) => s.session?.user.id);
  const loader = useCallback(async () => (myId ? [await fetchFollowGraph(myId)] : []), [myId]);
  const { items, loading, error, available, reload } = useRemoteList<Graph>(loader);
  const graph = items[0];
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PersonRow[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!available) return;
    const t = setTimeout(() => void searchUsers(query).then(setResults).catch(() => setResults([])), 300);
    return () => clearTimeout(t);
  }, [query, available]);

  const act = async (fn: () => Promise<unknown>) => {
    setActionError(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  };

  const followingIds = new Set(graph?.following.map((p) => p.id));
  const found = results.filter((p) => p.id !== myId);

  return (
    <Screen edges={[]}>
      <ConnectionBanner feature="Arkadaş bulma" />
      {!available ? null : (
        <>
          <Field label="Kullanıcı ara" value={query} onChangeText={setQuery} autoCapitalize="none" autoCorrect={false} placeholder="kullanıcı adı" />
          {actionError ? <Banner tone="danger">{actionError}</Banner> : null}
          {found.length > 0 ? (
            <Group>
              {found.map((p, i) => (
                <NavRow
                  key={p.id}
                  label={p.username}
                  last={i === found.length - 1}
                  right={
                    followingIds.has(p.id) ? (
                      <Txt variant="caption" muted>Takip ediliyor</Txt>
                    ) : (
                      <Button label="Takip et" variant="secondary" size="sm" onPress={() => void act(() => followUser(p.id))} />
                    )
                  }
                />
              ))}
            </Group>
          ) : null}
          {loading && !graph ? <Loading /> : null}
          {error ? <EmptyState icon="alert" title="Liste yüklenemedi" message={error} action={{ label: 'Tekrar dene', onPress: reload }} /> : null}
          {graph ? (
            <>
              <Group title={`Takipçiler (${graph.followers.filter((f) => f.status === 'accepted').length})`}>
                {graph.followers.length === 0 ? <NavRow label="Henüz takipçin yok" last /> : null}
                {graph.followers.map((p, i) => (
                  <NavRow
                    key={p.id}
                    label={p.username}
                    sub={p.status === 'pending' ? 'Takip isteği' : undefined}
                    last={i === graph.followers.length - 1}
                    right={
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Avatar name={p.username} size={28} />
                        {p.status === 'pending' ? (
                          <Button label="Onayla" variant="secondary" size="sm" onPress={() => void act(() => respondFollow(p.id, true))} />
                        ) : (
                          <Button label="Çıkar" variant="danger" size="sm" onPress={() => void act(() => respondFollow(p.id, false))} />
                        )}
                      </View>
                    }
                  />
                ))}
              </Group>
              <Group title={`Takip edilenler (${graph.following.length})`}>
                {graph.following.length === 0 ? <NavRow label="Kimseyi takip etmiyorsun" last /> : null}
                {graph.following.map((p, i) => (
                  <NavRow
                    key={p.id}
                    label={p.username}
                    sub={p.status === 'pending' ? 'İstek gönderildi' : undefined}
                    last={i === graph.following.length - 1}
                    right={<Button label="Bırak" variant="secondary" size="sm" onPress={() => void act(() => unfollowUser(p.id))} />}
                  />
                ))}
              </Group>
            </>
          ) : null}
        </>
      )}
    </Screen>
  );
}
