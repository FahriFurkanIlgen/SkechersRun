import type { ExpoConfig } from 'expo/config';

const bundleId = process.env.APP_BUNDLE_ID ?? 'app.runner.mobile';

const config: ExpoConfig = {
  name: 'Runner',
  slug: 'runner',
  scheme: 'runner',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: bundleId,
    // Signing team for device builds (Apple Developer team ID).
    appleTeamId: process.env.APPLE_TEAM_ID,
    supportsTablet: false,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: bundleId,
    adaptiveIcon: {
      // Brand primary (design token "Marka ana rengi").
      backgroundColor: '#1F4FD1',
      foregroundImage: './assets/android-icon-foreground.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    // Health Connect: workouts and distance only. Routes are read with the
    // per-workout consent dialog, so no READ_EXERCISE_ROUTES permission.
    permissions: [
      'android.permission.health.READ_EXERCISE',
      'android.permission.health.READ_DISTANCE',
      'android.permission.health.WRITE_EXERCISE',
      'android.permission.health.WRITE_EXERCISE_ROUTE',
      'android.permission.health.WRITE_DISTANCE',
    ],
  },
  web: { favicon: './assets/favicon.png' },
  plugins: [
    'expo-router',
    [
      // Native splash = first frame of the in-app opening animation (symbol on a flat background).
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        imageWidth: 132,
        resizeMode: 'contain',
        backgroundColor: '#FFFFFF',
        dark: { image: './assets/splash-icon-dark.png', backgroundColor: '#0E1113' },
      },
    ],
    'expo-sqlite',
    'expo-web-browser',
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'Runner, aktivite kaydederken rotanı çizmek ve haritada çevrendeki bölgeleri göstermek için konumunu kullanır.',
        locationAlwaysAndWhenInUsePermission:
          'Runner, ekran kilitliyken de aktivite kaydına devam edebilmek için konumunu kullanır. Konum yalnızca kayıt sırasında izlenir.',
        isIosBackgroundLocationEnabled: true,
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
      },
    ],
    'expo-task-manager',
    [
      '@kingstinct/react-native-healthkit',
      {
        NSHealthShareUsageDescription:
          'Runner, Apple Watch veya diğer uygulamalarla kaydettiğin yürüyüş, koşu ve bisiklet antrenmanlarını rotasıyla içe aktarabilmek için Sağlık verilerini okur.',
        NSHealthUpdateUsageDescription:
          'Runner, istersen kaydettiğin aktiviteleri rotasıyla birlikte Sağlık uygulamasına yazar.',
        // No background delivery: Runner only reads when you open the import screen.
        background: false,
      },
    ],
    // Health Connect (Android): needs minSdk 26.
    'react-native-health-connect',
    ['expo-build-properties', { android: { minSdkVersion: 26 } }],
    ['expo-notifications', { color: '#0B6E63' }],
    [
      'expo-image-picker',
      {
        photosPermission: 'Runner, profil fotoğrafı seçebilmen için fotoğraflarına erişir.',
        cameraPermission: false,
        microphonePermission: false,
      },
    ],
    [
      'react-native-maps',
      // Android needs a Google Maps SDK key; iOS uses Apple Maps (no key).
      { androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY ?? '' },
    ],
  ],
  extra: {
    // Needed for Expo push tokens (`npx eas-cli init` prints it). Without it push is disabled.
    eas: process.env.EAS_PROJECT_ID ? { projectId: process.env.EAS_PROJECT_ID } : undefined,
  },
  experiments: {
    typedRoutes: true,
  },
};

export default config;
