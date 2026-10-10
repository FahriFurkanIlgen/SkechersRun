import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Banner, Button, Card, Field, Group, NavRow, Screen, Segmented, Txt } from '../../components/ui';
import { activityRepo } from '../../data/local/activityRepo';
import { privacyZoneRepo } from '../../data/local/privacyZoneRepo';
import { syncPrivacyZones } from '../../data/remote/profileApi';
import type { LatLng } from '../../domain/geo';
import { suggestPrivacyZones, type PrivacyZone, type ZoneSuggestion } from '../../domain/privacy';
import { RULES } from '../../domain/rules';
import { useAuth } from '../../state/authStore';

const RADII = [200, 400, 800] as const;

export default function PrivacyZones() {
  const session = useAuth((s) => s.session);
  const [zones, setZones] = useState<PrivacyZone[]>([]);
  const [suggestions, setSuggestions] = useState<ZoneSuggestion[]>([]);
  const [label, setLabel] = useState('Ev');
  const [radius, setRadius] = useState<(typeof RADII)[number]>(400);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const list = await privacyZoneRepo.list();
    setZones(list);
    setSuggestions(suggestPrivacyZones(await activityRepo.listEndpoints(), list));
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const persist = async () => {
    await load();
    if (session) await syncPrivacyZones(await privacyZoneRepo.list());
  };

  const add = async (center: LatLng, name = label) => {
    setError(null);
    try {
      await privacyZoneRepo.add({ id: Crypto.randomUUID(), label: name.trim() || 'Gizli bölge', center, radiusM: radius });
      await persist();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const addHere = async () => {
    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      await add({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
    } catch {
      setError('Konum alınamadı. Konum iznini ve GPS sinyalini kontrol et.');
    }
  };

  return (
    <Screen edges={[]}>
      <Txt variant="body" muted>
        Gizli bölgelerin içindeki rota parçaları başkalarına gösterilmez. Sunucu, bölgenin merkezini rastgele kaydırır; böylece
        gizlenen kısım evinin tam yerini işaret etmez. Paylaşılan rotalarda ilk ve son {RULES.publicRouteTrimM} m de varsayılan olarak gizlidir.
      </Txt>
      {error ? <Banner tone="danger">{error}</Banner> : null}

      {suggestions.length > 0 ? (
        <Group title="Öneriler">
          {suggestions.map((s, i) => (
            <NavRow
              key={i}
              label={`Sık kullandığın nokta ${i + 1}`}
              sub={`${s.hits} aktivite burada başlıyor veya bitiyor · yalnızca cihazında hesaplandı`}
              last={i === suggestions.length - 1}
              right={<Button label="Gizle" variant="secondary" size="sm" onPress={() => void add(s.center, `Sık nokta ${i + 1}`)} />}
            />
          ))}
        </Group>
      ) : null}

      <Group title="Gizli bölgelerin">
        {zones.length === 0 ? <NavRow label="Henüz gizli bölgen yok" last /> : null}
        {zones.map((z, i) => (
          <NavRow
            key={z.id}
            label={z.label}
            sub={`${z.radiusM} m yarıçap`}
            last={i === zones.length - 1}
            right={
              <Button
                label="Kaldır"
                variant="danger"
                size="sm"
                onPress={async () => {
                  await privacyZoneRepo.remove(z.id);
                  await persist().catch((e) => setError(String(e)));
                }}
              />
            }
          />
        ))}
      </Group>

      <Card>
        <Txt variant="heading">Bulunduğun yeri gizle</Txt>
        <Field label="Ad" value={label} onChangeText={setLabel} maxLength={32} />
        <Segmented label="Yarıçap" value={radius} onChange={setRadius} options={RADII.map((r) => ({ value: r, label: `${r} m` }))} />
        <Button label="Bulunduğum yeri gizle" icon="pinOff" onPress={() => void addHere()} />
      </Card>
      {!session ? <Txt variant="caption" muted>Giriş yaptığında bölgelerin sunucuya da gönderilir.</Txt> : null}
    </Screen>
  );
}
