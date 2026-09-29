/**
 * margixindia Driver App — Entry Point
 * Handles auth state and navigation between Login → Home.
 */
import React, { useState, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import * as Updates from 'expo-updates';
import { useFonts } from 'expo-font';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import LoginScreen from './src/screens/LoginScreen';
import HomeScreen from './src/screens/HomeScreen';
import { NotificationListener } from './src/components/NotificationListener';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, STORAGE_KEYS } from './src/services/api';
import { supabase } from './src/services/supabase';
import { locationService } from './src/services/location';
import { TranslationProvider } from './src/hooks/useTranslation';
import AnimatedSplashScreen from './src/components/AnimatedSplashScreen';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Audio } from 'expo-av';
import { themeFonts } from './src/theme/fonts';

const queryClient = new QueryClient();

// Enable background audio so sounds don't pause when app minimizes
Audio.setAudioModeAsync({
  staysActiveInBackground: true,
  playsInSilentModeIOS: true,
  shouldDuckAndroid: true,
  playThroughEarpieceAndroid: false,
}).catch(console.warn);

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  const [splashFinished, setSplashFinished] = useState(false);
  // Hold the splash until the theme fonts are ready; if they fail to load the
  // app still starts with the system font.
  const [fontsLoaded, fontError] = useFonts(themeFonts);
  const fontsReady = fontsLoaded || !!fontError;

  useEffect(() => {
    checkUpdatesAndAuth();
  }, []);

  // Session ended (logout, failed refresh, or rejected token) → back to login.
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        if (locationService.isTracking) locationService.stop();
        queryClient.clear();
        AsyncStorage.removeItem(STORAGE_KEYS.DRIVER_INFO).catch(() => {});
        setIsLoggedIn((current) => (current === null ? current : false));
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const checkUpdatesAndAuth = async () => {
    try {
      if (!__DEV__) {
        const update = await Updates.checkForUpdateAsync();
        if (update.isAvailable) {
          await Updates.fetchUpdateAsync();
          await Updates.reloadAsync();
          return; // Stop execution as the app will reload
        }
      }
    } catch (e) {
      console.log('Error checking for OTA updates:', e);
    }
    
    await api.init();
    // Drivers without a Supabase session (including installs upgraded from
    // token-based builds) must log in again.
    const loggedIn = await api.isLoggedIn().catch(() => false);
    setIsLoggedIn(loggedIn);
  };

  // Loading state or Splash Screen
  if (isLoggedIn === null || !splashFinished || !fontsReady) {
    return (
      <SafeAreaProvider>
        <TranslationProvider>
          <AnimatedSplashScreen onAnimationFinish={() => setSplashFinished(true)} />
          <StatusBar style="light" />
        </TranslationProvider>
      </SafeAreaProvider>
    );
  }

  // Not logged in → show OTP login
  if (!isLoggedIn) {
    return (
      <SafeAreaProvider>
        <TranslationProvider>
          <LoginScreen onLoginSuccess={() => setIsLoggedIn(true)} />
          <StatusBar style="dark" />
        </TranslationProvider>
      </SafeAreaProvider>
    );
  }

  // Logged in → show home
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <TranslationProvider>
          <NotificationListener />
          <HomeScreen onLogout={() => setIsLoggedIn(false)} />
          <StatusBar style="dark" />
        </TranslationProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

