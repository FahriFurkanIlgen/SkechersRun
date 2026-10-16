import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Icon } from '../components/Icon';
import { Banner, EmptyState, Loading, Screen, SwitchRow, Txt } from '../components/ui';
import { fetchLiveShareCandidates, type LiveShareCandidate } from '../services/liveShare';
import { useSettings } from '../state/settingsStore';
import { fonts, radius, useTheme } from '../theme/theme';

/** Who may follow your position live while you record (accepted followers only). */
export default function LiveContacts() {
  const { colors } = useTheme();
  const enabled = useSettings((s) => s.liveShareEnabled);
  const selected = useSettings((s) => s.liveShareContactIds);
  const set = useSettings((s) => s.set);
  const [candidates, setCandidates] = useState<LiveShareCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchLiveShareCandidates()
      .then(setCandidates)
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setCandidates([]);
      });
  }, []);

  const toggle = (id: string) =>
    set({ liveShareContactIds: selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id].slice(0, 20) });

  return (
    <Screen edges={[]}>
      <Txt variant="bodySm" muted>
        Kayıt sırasında seçtiğin kişiler konumunu canlı görür. Yalnızca son konumun paylaşılır, rota geçmişin değil; aktivite bitince
        konum silinir. Paylaşım en fazla 8 saat sürer.
      </Txt>
      <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 16 }}>
        <SwitchRow
          label="Kayıt sırasında canlı konum paylaş"
          value={enabled}
          onChange={(v) => set({ liveShareEnabled: v })}
          last
        />
      </View>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {candidates === null ? (
        <Loading label="Takipçiler yükleniyor" />
      ) : candidates.length === 0 ? (
        <EmptyState icon="users" title="Henüz seçebileceğin kimse yok" message="Konumunu yalnızca takip isteğini onayladığın kişilerle paylaşabilirsin." />
      ) : (
        <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, borderWidth: 1, borderColor: colors.border, opacity: enabled ? 1 : 0.5 }}>
          {candidates.map((c, i) => {
            const on = selected.includes(c.userId);
            return (
              <Pressable
                key={c.userId}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on, disabled: !enabled }}
                disabled={!enabled}
                onPress={() => toggle(c.userId)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.border }}
              >
                <Txt variant="body" style={{ flex: 1, fontFamily: fonts.bodySemi }}>{c.username}</Txt>
                <Icon name={on ? 'checkCircle' : 'plus'} size={22} color={on ? colors.primary : colors.text2} />
              </Pressable>
            );
          })}
        </View>
      )}
    </Screen>
  );
}
