import { Archivo_800ExtraBold } from '@expo-google-fonts/archivo';
import { ArchivoNarrow_600SemiBold, ArchivoNarrow_700Bold } from '@expo-google-fonts/archivo-narrow';
import {
  InstrumentSans_400Regular,
  InstrumentSans_500Medium,
  InstrumentSans_600SemiBold,
  InstrumentSans_700Bold,
} from '@expo-google-fonts/instrument-sans';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { addNetworkStateListener } from 'expo-network';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { AppState, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { getDb } from '../data/local/db';
import { AnimatedSplash } from '../features/splash/AnimatedSplash';
import { health } from '../services/health';
import { handleNotificationTaps, syncPushToken } from '../services/push';
import { syncLocalReminders } from '../services/reminders';
import { syncPending } from '../services/syncService';
import { useAuth } from '../state/authStore';
import { useRecording } from '../state/recordingStore';
import { useSettings } from '../state/settingsStore';
import { fonts, useTheme } from '../theme/theme';

// Keep the native splash until the animated one (same first frame) is on screen.
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  const [splashDone, setSplashDone] = useState(false);
  const onboardingDone = useSettings((s) => s.onboardingDone);
  const [ready, setReady] = useState(false);
  const [fontsLoaded, fontError] = useFonts({
    Archivo_800ExtraBold,
    ArchivoNarrow_600SemiBold,
    ArchivoNarrow_700Bold,
    InstrumentSans_400Regular,
    InstrumentSans_500Medium,
    InstrumentSans_600SemiBold,
    InstrumentSans_700Bold,
  });
  const session = useAuth((s) => s.session);
  const notificationPrefs = useSettings((s) => s.notificationPrefs);
  const { colors, dark } = useTheme();

  useEffect(() => {
    (async () => {
      await getDb();
      await useAuth.getState().init();
      await useRecording.getState().hydrate();
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    void syncLocalReminders(notificationPrefs).catch(() => undefined);
  }, [notificationPrefs]);

  // Keep the backend's push token in sync with sign-in state and preferences.
  useEffect(() => {
    if (session) void syncPushToken().catch(() => undefined);
  }, [session, notificationPrefs]);

  // Tapping a notification opens the related screen (once the navigator exists).
  useEffect(() => {
    if (!ready) return;
    return handleNotificationTaps();
  }, [ready]);

  // Flush the upload outbox when signed in, when coming online and on foreground.
  useEffect(() => {
    if (!ready || !session) return;
    void syncPending();
    const net = addNetworkStateListener((s) => s.isInternetReachable && void syncPending());
    const app = AppState.addEventListener('change', (s) => s === 'active' && void syncPending());
    return () => {
      net.remove();
      app.remove();
    };
  }, [ready, session]);

  // Fonts failing to load must not block the app; system fonts are the fallback.
  const show = ready && (fontsLoaded || !!fontError);

  return (
    <SafeAreaProvider>
      <StatusBar style={dark ? 'light' : 'dark'} />
      {show ? (
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.bg },
            headerTintColor: colors.text,
            headerTitleStyle: { fontFamily: fonts.bodyBold, fontSize: 17 },
            headerShadowVisible: false,
            contentStyle: { backgroundColor: colors.bg },
            headerBackTitle: 'Geri',
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="onboarding" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="start"
            options={{ headerShown: false, presentation: 'transparentModal', animation: 'slide_from_bottom', contentStyle: { backgroundColor: 'transparent' } }}
          />
          <Stack.Screen name="record" options={{ headerShown: false, gestureEnabled: false, presentation: 'fullScreenModal' }} />
          <Stack.Screen name="summary/[id]" options={{ headerShown: false, gestureEnabled: false }} />
          <Stack.Screen
            name="share/[id]"
            options={{ headerShown: false, presentation: 'transparentModal', animation: 'slide_from_bottom', contentStyle: { backgroundColor: 'transparent' } }}
          />
          <Stack.Screen name="activity/[id]" options={{ title: 'Aktivite' }} />
          <Stack.Screen name="auth" options={{ title: 'Giriş yap', presentation: 'modal' }} />
          <Stack.Screen name="settings/index" options={{ headerShown: false }} />
          <Stack.Screen name="settings/privacy-zones" options={{ title: 'Gizli bölgeler' }} />
          <Stack.Screen name="inbox" options={{ title: 'Bildirimler' }} />
          <Stack.Screen name="people" options={{ title: 'Arkadaş bul' }} />
          <Stack.Screen name="clubs" options={{ title: 'Kulüpler' }} />
          <Stack.Screen name="how-it-works" options={{ title: 'Oyun kuralları' }} />
          <Stack.Screen name="import-health" options={{ title: health ? `${health.nameFrom} aktar` : 'Antrenman aktar' }} />
        </Stack>
      ) : (
        <View style={{ flex: 1, backgroundColor: colors.bg }} />
      )}
      {!splashDone ? (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} onLayout={() => void SplashScreen.hideAsync().catch(() => undefined)}>
          <AnimatedSplash
            ready={show}
            fontsLoaded={fontsLoaded}
            // Full 2.5 s on first launch; returning users get a shorter version.
            speed={onboardingDone ? 0.5 : 1}
            onDone={() => setSplashDone(true)}
          />
        </View>
      ) : null}
    </SafeAreaProvider>
  );
}
