import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Platform, View } from 'react-native';
import { Icon } from '../../components/Icon';
import { Banner, Button, Group, IconButton, NavRow, Screen, Segmented, SwitchRow, Txt } from '../../components/ui';
import { privacyZoneRepo } from '../../data/local/privacyZoneRepo';
import { saveRemoteNotificationPrefs } from '../../data/remote/socialApi';
import { backendConfigured } from '../../data/remote/supabase';
import type { NotificationPrefs } from '../../domain/types';
import { VISIBILITY_OPTIONS } from '../../features/activity/visibility';
import { exportLocalData } from '../../features/profile/exportData';
import { profileActions } from '../../features/profile/profileActions';
import { getBatteryAdvice, openBatterySettings } from '../../services/batteryGuidance';
import { health } from '../../services/health';
import { getLocationAccess, openAppSettings, type LocationAccess } from '../../services/location/permissions';
import { useAuth } from '../../state/authStore';
import { useSettings } from '../../state/settingsStore';
import { fonts, useTheme } from '../../theme/theme';

const ACCESS_TEXT: Record<LocationAccess, string> = {
  services_off: 'Konum servisleri kapalı',
  denied: 'Kapalı',
  undetermined: 'Sorulmadı',
  foreground: 'Kullanırken',
  background: 'Her zaman',
};

/** 10 Ayarlar ve gizlilik */
export default function Settings() {
  const { colors } = useTheme();
  const s = useSettings();
  const session = useAuth((st) => st.session);
  const [access, setAccess] = useState<LocationAccess | null>(null);
  const [zoneCount, setZoneCount] = useState(0);
  const [batteryOptimized, setBatteryOptimized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      void getLocationAccess().then(setAccess);
      void privacyZoneRepo.list().then((z) => setZoneCount(z.length));
      void getBatteryAdvice().then((a) => setBatteryOptimized(a !== null));
    }, []),
  );

  const run = (fn: () => Promise<void>) => {
    setError(null);
    fn().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };

  const setNotif = (patch: Partial<NotificationPrefs>) => {
    const next = { ...s.notificationPrefs, ...patch };
    s.set({ notificationPrefs: next });
    if (session) void saveRemoteNotificationPrefs(session.user.id, next, null).catch(() => undefined);
  };

  const confirm = (title: string, message: string, action: () => Promise<void>) =>
    Alert.alert(title, message, [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Sil', style: 'destructive', onPress: () => run(action) },
    ]);

  const n = s.notificationPrefs;

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <IconButton icon="back" label="Profile dön" onPress={() => router.back()} />
        <Txt variant="title" style={{ fontSize: 26 }}>Ayarlar ve gizlilik</Txt>
      </View>
      {error ? <Banner tone="danger">{error}</Banner> : null}

      <Group title="Aktivite ve gizlilik">
        <View style={{ paddingVertical: 12, gap: 12, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <Segmented
            label="Yeni aktivitelerin varsayılan görünürlüğü"
            value={s.defaultActivityVisibility}
            onChange={(v) => run(() => profileActions.save({ defaultActivityVisibility: v }))}
            options={VISIBILITY_OPTIONS}
          />
          <Segmented
            label="Profil görünürlüğü"
            value={s.profileVisibility}
            onChange={(v) => run(() => profileActions.save({ profileVisibility: v }))}
            options={VISIBILITY_OPTIONS}
          />
          <Txt variant="caption" muted>
            Takipçiler: yeni takipçileri sen onaylarsın. Sadece ben: sıralamalarda görünmezsin, bölgen haritada isimsiz görünür.
          </Txt>
        </View>
        <NavRow
          label="Gizli bölgeleri düzenle"
          sub="Ev, iş gibi yerlerde rotan kimseye gösterilmez"
          value={zoneCount ? `${zoneCount} bölge` : 'Yok'}
          onPress={() => router.push('/settings/privacy-zones')}
        />
        <SwitchRow
          label="Sıralamalarda görün"
          value={s.showInLeaderboards}
          onChange={(v) => run(() => profileActions.save({ showInLeaderboards: v }))}
        />
        <NavRow label="Konum izni" value={access ? ACCESS_TEXT[access] : '…'} onPress={openAppSettings} last={Platform.OS !== 'android'} />
        {Platform.OS === 'android' ? (
          <NavRow
            label="Pil optimizasyonu"
            sub="Uzun aktivitelerde kaydın kesilmemesi için kapalı olmalı"
            value={batteryOptimized ? 'Açık' : 'Kapalı'}
            onPress={() => void openBatterySettings()}
            last
          />
        ) : null}
      </Group>

      <Group title="Birimler ve görünüm">
        <View style={{ paddingVertical: 12, gap: 12 }}>
          <Segmented
            label="Ölçü birimi"
            value={s.units}
            onChange={(units) => s.set({ units })}
            options={[
              { value: 'metric', label: 'Kilometre' },
              { value: 'imperial', label: 'Mil' },
            ]}
          />
          <Segmented
            label="Tema"
            value={s.theme}
            onChange={(theme) => s.set({ theme })}
            options={[
              { value: 'system', label: 'Sistem' },
              { value: 'light', label: 'Aydınlık' },
              { value: 'dark', label: 'Koyu' },
            ]}
          />
          <Txt variant="caption" muted>Yazı boyutu cihazının erişilebilirlik ayarını izler.</Txt>
        </View>
      </Group>

      <Group title="Bildirimler">
        <SwitchRow label="Bildirimler" value={n.enabled} onChange={(v) => setNotif({ enabled: v })} />
        <SwitchRow label="Hareket hatırlatmaları" sub="En fazla günde bir" value={n.movementReminders} disabled={!n.enabled} onChange={(v) => setNotif({ movementReminders: v })} />
        <SwitchRow label="Alanında değişiklik" value={n.territoryChanges} disabled={!n.enabled} onChange={(v) => setNotif({ territoryChanges: v })} />
        <SwitchRow label="Haftalık özet" value={n.weeklySummary} disabled={!n.enabled} onChange={(v) => setNotif({ weeklySummary: v })} />
        <SwitchRow
          label="Takip istekleri ve kulüp davetleri"
          sub="Uygulama içi bildirim kutusunda"
          value={n.followRequests && n.clubInvites}
          disabled={!n.enabled}
          onChange={(v) => setNotif({ followRequests: v, clubInvites: v })}
        />
        <SwitchRow label="Sesli geri bildirim" sub="Kayıt sırasında her 1 km" value={s.voiceFeedback} onChange={(v) => s.set({ voiceFeedback: v })} />
        <SwitchRow label="Titreşimli geri bildirim" sub="Kayıt sırasında her 1 km" value={s.hapticFeedback} onChange={(v) => s.set({ hapticFeedback: v })} last />
      </Group>

      <Group title="Sağlık ve akıllı saat">
        {health ? (
          <>
            <NavRow
              icon="heart"
              label="Saat antrenmanlarını aktar"
              sub={s.healthConnected ? `${health.nameFrom}, son 7 gün, rotasıyla` : `${health.nameTo} bağlan (${health.watches})`}
              onPress={() => router.push('/import-health')}
            />
            <SwitchRow
              label={`Aktiviteleri ${health.nameTo} kaydet`}
              sub="Kaydettiğin aktiviteler rotasıyla birlikte yazılır"
              value={s.healthExport && s.healthConnected}
              onChange={(v) =>
                run(async () => {
                  if (v && !s.healthConnected) {
                    const granted = await health!.connect();
                    if (!granted && health!.source === 'health_connect') throw new Error(`İzin verilmedi. ${health!.permissionHint} bölümünden açabilirsin.`);
                    s.set({ healthConnected: true });
                  }
                  s.set({ healthExport: v });
                })
              }
              last
            />
          </>
        ) : (
          <NavRow icon="heart" label="Sağlık verisi" sub="Bu cihazda desteklenmiyor" last />
        )}
      </Group>
      <Txt variant="caption" muted>
        Yalnızca antrenmanlar, rotaları ve mesafe okunur/yazılır. Sağlık verilerin reklam veya iş ortaklığı amacıyla kullanılmaz;
        izinleri istediğin zaman geri alabilirsin.
      </Txt>

      <Group title="İş ortaklığı içeriği">
        <SwitchRow
          label="İş ortaklığı içeriği"
          sub="Sponsorlu görevler ve istek üzerine ekipman önerileri. Kapalıyken hiçbiri gösterilmez."
          value={s.partnerContent}
          onChange={(v) => s.set({ partnerContent: v })}
          last
        />
      </Group>
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
        <Icon name="lock" size={18} color={colors.text2} />
        <Txt variant="caption" muted style={{ flex: 1 }}>
          Konum ve aktivite verilerin reklam hedeflemesi için kullanılmaz, iş ortaklarıyla paylaşılmaz.
        </Txt>
      </View>

      <Group title="Hesap">
        {session ? (
          <>
            <NavRow label="E-posta" value={session.user.email ?? ''} />
            <NavRow label="Çıkış yap" onPress={() => run(() => useAuth.getState().signOut())} last />
          </>
        ) : backendConfigured ? (
          <NavRow label="Giriş yap / hesap oluştur" onPress={() => router.push('/auth')} last />
        ) : (
          <NavRow label="Sunucu bağlı değil" sub="Veriler yalnızca bu cihazda" last />
        )}
      </Group>

      <Group title="Verilerin">
        <NavRow icon="download" label="Verilerimi indir" sub="Bu cihazdaki aktiviteler ve rotalar (JSON)" onPress={() => run(exportLocalData)} />
        <NavRow
          icon="pinOff"
          label="Konum geçmişini sil"
          sub="Rotalar ve bölgen silinir, istatistiklerin kalır"
          onPress={() =>
            confirm(
              'Konum geçmişi silinsin mi?',
              'Tüm ham GPS noktaları, rotalar, gizli bölgeler ve bölgen sunucudan ve bu cihazdan silinir. Mesafe ve süre istatistikleri kalır.',
              profileActions.deleteLocationData,
            )
          }
        />
        <NavRow
          icon="trash"
          label="Hesabı sil"
          danger
          onPress={() =>
            confirm(
              'Hesap kalıcı olarak silinsin mi?',
              'Profilin, aktivitelerin, bölgen, takip ilişkilerin ve bildirimlerin silinir. Bu işlem geri alınamaz.',
              async () => {
                await profileActions.deleteAccount();
                router.replace('/onboarding');
              },
            )
          }
          last
        />
      </Group>
      <Button label="Oyun kuralları" variant="text" onPress={() => router.push('/how-it-works')} />
      <Txt variant="caption" muted style={{ textAlign: 'center', fontFamily: fonts.body }}>Runner 0.1.0</Txt>
    </Screen>
  );
}
