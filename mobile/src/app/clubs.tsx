import { useCallback, useState } from 'react';
import { Share } from 'react-native';
import { ConnectionBanner } from '../components/StatusBanners';
import { Banner, Button, Card, EmptyState, Field, Group, Loading, NavRow, Screen, Segmented, Txt } from '../components/ui';
import { createClub, fetchClubs, joinClub, leaveClub } from '../data/remote/socialApi';
import type { Club } from '../domain/types';
import { useRemoteList } from '../features/social/useRemoteList';
import { useAuth } from '../state/authStore';

export default function Clubs() {
  const myId = useAuth((s) => s.session?.user.id);
  const loader = useCallback(() => fetchClubs(), []);
  const { items, loading, error, available, reload } = useRemoteList<Club>(loader);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [privacy, setPrivacy] = useState<'public' | 'private'>('private');
  const [code, setCode] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const act = async (fn: () => Promise<unknown>) => {
    setActionError(null);
    try {
      await fn();
      await reload();
      return true;
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
      return false;
    }
  };

  return (
    <Screen edges={[]}>
      <ConnectionBanner feature="Kulüpler" />
      {!available ? null : (
        <>
          {actionError ? <Banner tone="danger">{actionError}</Banner> : null}
          <Group title="Kulüplerin ve açık kulüpler">
            {loading && !items.length ? (
              <Loading />
            ) : error ? (
              <EmptyState icon="alert" title="Kulüpler yüklenemedi" message={error} action={{ label: 'Tekrar dene', onPress: reload }} />
            ) : items.length === 0 ? (
              <NavRow label="Henüz kulüp yok" sub="Aşağıdan ilk kulübü kur" last />
            ) : (
              items.map((c, i) => (
                <NavRow
                  key={c.id}
                  label={c.name}
                  sub={`${c.memberCount} üye${c.isMember && c.inviteCode ? ` · Kod: ${c.inviteCode}` : ''}${c.description ? ` · ${c.description}` : ''}`}
                  last={i === items.length - 1}
                  right={
                    c.isMember ? (
                      c.ownerId === myId ? (
                        <Button
                          label="Davet et"
                          variant="secondary"
                          size="sm"
                          onPress={() => void Share.share({ message: `Runner'da "${c.name}" kulübüne katıl. Davet kodu: ${c.inviteCode}` })}
                        />
                      ) : (
                        <Button label="Ayrıl" variant="danger" size="sm" onPress={() => void act(() => leaveClub(c.id))} />
                      )
                    ) : (
                      <Button label="Katıl" variant="secondary" size="sm" onPress={() => void act(() => joinClub({ clubId: c.id }))} />
                    )
                  }
                />
              ))
            )}
          </Group>

          <Card>
            <Txt variant="heading">Davet koduyla katıl</Txt>
            <Field label="Davet kodu" value={code} onChangeText={setCode} autoCapitalize="characters" maxLength={8} />
            <Button label="Katıl" variant="secondary" disabled={code.trim().length < 4} onPress={async () => (await act(() => joinClub({ code }))) && setCode('')} />
          </Card>

          <Card>
            <Txt variant="heading">Kulüp kur</Txt>
            <Field label="Kulüp adı" value={name} onChangeText={setName} maxLength={48} />
            <Field label="Açıklama (isteğe bağlı)" value={description} onChangeText={setDescription} maxLength={280} />
            <Segmented
              label="Kimler görebilir?"
              value={privacy}
              onChange={setPrivacy}
              options={[
                { value: 'private', label: 'Yalnızca davetle' },
                { value: 'public', label: 'Herkes' },
              ]}
            />
            <Button
              label="Kulübü kur"
              disabled={name.trim().length < 3}
              onPress={async () => {
                if (await act(() => createClub(name.trim(), description.trim(), privacy === 'private'))) {
                  setName('');
                  setDescription('');
                }
              }}
            />
          </Card>
          <Txt variant="caption" muted>Takım yarışmaları ve kulüp bölgeleri sonraki sürümde gelecek.</Txt>
        </>
      )}
    </Screen>
  );
}
