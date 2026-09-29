import type { ConfigContext, ExpoConfig } from 'expo/config';

// Injected at build time from the environment (customer-app/.env locally, EAS
// environment variables for cloud builds). Never commit the key itself.
const googleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY?.trim();

if (!googleMapsApiKey) {
  const message =
    '[app.config] EXPO_PUBLIC_GOOGLE_MAPS_API_KEY is not set; maps will not render. ' +
    'Set it in customer-app/.env (see .env.example) or in the EAS environment.';
  if (process.env.EAS_BUILD === 'true') {
    throw new Error(message);
  }
  console.warn(message);
}

// SDK 57's ExpoConfig type dropped the top-level `splash` field (superseded by
// the expo-splash-screen config plugin), but the native splash still reads it
// at build time, so it's kept here as-is and the object is cast below instead
// of narrowing the return type.
export default ({ config }: ConfigContext): ExpoConfig => {
  const merged = {
    ...config,
    name: 'MargixIndia',
    slug: 'customer-app',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'light',
    splash: {
      image: './assets/margix-logo.png',
      resizeMode: 'contain',
      backgroundColor: '#FFFFFF',
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.margixindia.customerapp',
      config: {
        googleMapsApiKey,
      },
    },
    android: {
      package: 'com.margixindia.customerapp',
      config: {
        googleMaps: {
          apiKey: googleMapsApiKey,
        },
      },
      adaptiveIcon: {
        backgroundColor: '#E6F4FE',
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
    },
    web: {
      favicon: './assets/favicon.png',
    },
    plugins: ['expo-secure-store'],
  };

  return merged as ExpoConfig;
};
