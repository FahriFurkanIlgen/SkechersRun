import { router } from 'expo-router';
import { backendConfigured } from '../data/remote/supabase';
import { useIsOffline } from '../services/useConnectivity';
import { useAuth } from '../state/authStore';
import { Banner } from './ui';

/** Connection state shown on screens that depend on the server. */
export function ConnectionBanner({ feature }: { feature: string }) {
  const offline = useIsOffline();
  const session = useAuth((s) => s.session);
  if (!backendConfigured) {
    return (
      <Banner tone="warning" title="Sunucu bağlı değil">
        {`${feature} sunucu gerektirir ve bu sürümde kullanılamıyor. Aktiviteler yalnızca bu cihazda saklanır.`}
      </Banner>
    );
  }
  if (!session) {
    return (
      <Banner tone="info" title="Giriş yapman gerekiyor" action={{ label: 'Giriş yap', onPress: () => router.push('/auth') }}>
        {`${feature} için bir hesap gerekir.`}
      </Banner>
    );
  }
  if (offline) {
    return (
      <Banner tone="warning" icon="offline" title="Çevrimdışısın">
        Gösterilen veriler güncel olmayabilir.
      </Banner>
    );
  }
  return null;
}
