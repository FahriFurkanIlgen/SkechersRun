import { router } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { Banner, Button, Txt } from '../../components/ui';
import { Bullet, OnboardingStep } from '../../features/onboarding/OnboardingStep';
import { openAppSettings, requestForegroundLocation, type LocationAccess } from '../../services/location/permissions';
import { fonts } from '../../theme/theme';

const B = ({ children }: { children: string }) => <Text style={{ fontFamily: fonts.bodyBold }}>{children}</Text>;

/** 01b Konum izni */
export default function LocationStep() {
  const [result, setResult] = useState<LocationAccess | null>(null);
  const next = () => router.push('/onboarding/notifications');

  return (
    <OnboardingStep
      step={2}
      total={3}
      icon="pin"
      title="Konumunu neden istiyoruz?"
      lead="Runner, rotanı ve kazandığın alanı haritada gösterebilmek için konumuna ihtiyaç duyar."
      onSkip={next}
      footer={
        result === 'denied' || result === 'services_off' ? (
          <>
            <Button label="Ayarları aç" size="lg" onPress={openAppSettings} />
            <Button label="Şimdilik devam et" variant="text" onPress={next} />
          </>
        ) : (
          <>
            <Button
              label="Konum iznini ver"
              size="lg"
              onPress={async () => {
                const r = await requestForegroundLocation();
                setResult(r);
                if (r === 'foreground' || r === 'background') next();
              }}
            />
            <Button label="Şimdi değil" variant="text" onPress={next} />
            <Txt variant="caption" muted style={{ textAlign: 'center' }}>
              Sonraki adımda sistem izni açılır. İstediğin zaman Ayarlar’dan değiştirebilirsin.
            </Txt>
          </>
        )
      }
    >
      <Bullet icon="route"><B>Rotanı çizmek</B> ve mesafeni doğru ölçmek için</Bullet>
      <Bullet icon="hex"><B>Kazandığın alanı</B> hesaplamak için</Bullet>
      <Bullet icon="lock">
        Konumun <B>reklam hedeflemesi için kullanılmaz</B>. Paylaşılan rotalarda başlangıç ve bitiş her zaman gizlenir.
      </Bullet>
      <Bullet icon="shield">
        <B>Evin haritada görünmez:</B> ev ve iş gibi gizli bölgeler eklersen oradaki rotan kimseye gösterilmez.
      </Bullet>
      {result === 'denied' ? (
        <Banner tone="warning" title="Konum izni reddedildi">
          İzni yalnızca cihaz Ayarları’ndan açabilirsin. Uygulamayı keşfetmeye yine de devam edebilirsin.
        </Banner>
      ) : null}
      {result === 'services_off' ? (
        <Banner tone="warning" title="Konum servisleri kapalı">Cihaz ayarlarından konum servislerini aç.</Banner>
      ) : null}
    </OnboardingStep>
  );
}
