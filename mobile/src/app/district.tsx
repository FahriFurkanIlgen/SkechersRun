import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Icon } from '../components/Icon';
import { Banner, Button, Loading, Screen, Txt } from '../components/ui';
import { fetchMyDistricts } from '../data/remote/socialApi';
import { profileActions } from '../features/profile/profileActions';
import { areaAt, type Area } from '../services/area';
import { useSettings } from '../state/settingsStore';
import { fonts, radius, useTheme } from '../theme/theme';

interface Option extends Area {
  note: string;
}

/**
 * "İlçe takımı": the district the player competes for in the weekly district
 * battle. Suggestions: where the player is now and where they have run.
 */
export default function DistrictPicker() {
  const { colors } = useTheme();
  const homeCity = useSettings((s) => s.homeCity);
  const homeDistrict = useSettings((s) => s.homeDistrict);
  const [options, setOptions] = useState<Option[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const list: Option[] = [];
      const pos =
        (await Location.getLastKnownPositionAsync({ maxAge: 10 * 60_000 }).catch(() => null)) ??
        (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }).catch(() => null));
      const here = pos ? await areaAt({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }) : null;
      if (here) list.push({ ...here, note: 'Şu an buradasın' });
      const mine = await fetchMyDistricts().catch(() => []);
      for (const d of mine) {
        const existing = list.find((o) => o.city === d.city && o.district === d.district);
        const note = `${d.activities} aktivite`;
        if (existing) existing.note = `${existing.note} · ${note}`;
        else list.push({ city: d.city, district: d.district, note });
      }
      if (!cancelled) setOptions(list);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const choose = async (area: Area | null) => {
    setBusy(true);
    setError(null);
    try {
      await profileActions.save({ homeCity: area?.city ?? null, homeDistrict: area?.district ?? null });
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={[]}>
      <Txt variant="bodySm" muted>
        Seçtiğin ilçenin takımında yarışırsın: bu hafta kazandığın hücreler ilçenin puanına eklenir. Hangi ilçede koştuğun fark
        etmez; takımını istediğin zaman değiştirebilirsin.
      </Txt>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {options === null ? (
        <Loading label="İlçeler bulunuyor" />
      ) : options.length === 0 ? (
        <Banner tone="info" title="İlçe bulunamadı">
          Konum iznini açtığında ya da ilk aktiviteni kaydettiğinde ilçen burada çıkar.
        </Banner>
      ) : (
        <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, borderWidth: 1, borderColor: colors.border }}>
          {options.map((o, i) => {
            const selected = o.city === homeCity && o.district === homeDistrict;
            return (
              <Pressable
                key={`${o.city}/${o.district}`}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected, disabled: busy }}
                disabled={busy}
                onPress={() => void choose(o)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.border }}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt variant="body" style={{ fontFamily: fonts.bodySemi }}>{o.district}</Txt>
                  <Txt variant="caption" muted>{`${o.city} · ${o.note}`}</Txt>
                </View>
                {selected ? <Icon name="checkCircle" size={24} color={colors.primary} /> : null}
              </Pressable>
            );
          })}
        </View>
      )}
      {homeDistrict ? <Button label="Takımdan ayrıl" variant="text" disabled={busy} onPress={() => void choose(null)} /> : null}
    </Screen>
  );
}
