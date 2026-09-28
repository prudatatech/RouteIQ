import type { ConfigContext, ExpoConfig } from 'expo/config';

// Injected at build time from the environment (driver-app/.env locally, EAS
// environment variables for cloud builds). Never commit the key itself.
const googleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY?.trim();

if (!googleMapsApiKey) {
  const message =
    '[app.config] EXPO_PUBLIC_GOOGLE_MAPS_API_KEY is not set; maps will not render. ' +
    'Set it in driver-app/.env (see .env.example) or in the EAS environment.';
  if (process.env.EAS_BUILD === 'true') {
    throw new Error(message);
  }
  console.warn(message);
}

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'margixindia',
  slug: 'routeiq',
  owner: 'kushagratiwari',
  version: '1.1.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  splash: {
    image: './assets/splash.png',
    resizeMode: 'contain',
    backgroundColor: '#000000',
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.margixindia.driverapp',
    config: {
      googleMapsApiKey,
    },
    infoPlist: {
      UIBackgroundModes: ['location', 'fetch', 'remote-notification'],
    },
  },
  android: {
    package: 'com.margixindia.driverapp',
    config: {
      googleMaps: {
        apiKey: googleMapsApiKey,
      },
    },
    adaptiveIcon: {
      backgroundColor: '#000000',
      foregroundImage: './assets/icon.png',
    },
    predictiveBackGestureEnabled: false,
    permissions: [
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.ACCESS_BACKGROUND_LOCATION',
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_LOCATION',
    ],
  },
  web: {
    favicon: './assets/favicon.png',
  },
  updates: {
    enabled: true,
    fallbackToCacheTimeout: 0,
    url: 'https://u.expo.dev/f9e3960e-8b3e-4caf-9044-6cbe07af3371',
  },
  plugins: [
    [
      'expo-location',
      {
        locationAlwaysAndWhenInUsePermission:
          'Allow margixindia Driver to use your location for accurate delivery tracking and background updates.',
        locationAlwaysPermission:
          'Allow margixindia Driver to use your location for accurate delivery tracking and background updates.',
        locationWhenInUsePermission:
          'Allow margixindia Driver to use your location for accurate delivery tracking and background updates.',
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
      },
    ],
    'expo-task-manager',
    [
      'expo-notifications',
      {
        sounds: ['./assets/uber_driver_sound.mp3'],
      },
    ],
    'expo-font',
    'expo-secure-store',
  ],
  extra: {
    eas: {
      projectId: 'f9e3960e-8b3e-4caf-9044-6cbe07af3371',
    },
  },
  runtimeVersion: {
    policy: 'appVersion',
  },
});
