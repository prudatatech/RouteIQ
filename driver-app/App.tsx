/**
 * margixindia Driver App — Entry Point
 * Handles auth state and navigation between Login → Home.
 */
import React, { useState, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View, StyleSheet, Linking, Alert } from 'react-native';
import * as Updates from 'expo-updates';
import LoginScreen from './src/screens/LoginScreen';
import HomeScreen from './src/screens/HomeScreen';
import { NotificationListener } from './src/components/NotificationListener';
import { api } from './src/services/api';
import { TranslationProvider } from './src/hooks/useTranslation';
import AnimatedSplashScreen from './src/components/AnimatedSplashScreen';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Audio } from 'expo-av';

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

  useEffect(() => {
    checkUpdatesAndAuth();
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
    const loggedIn = await api.isLoggedIn();
    setIsLoggedIn(loggedIn);
  };

  // Loading state or Splash Screen
  if (isLoggedIn === null || !splashFinished) {
    return (
      <TranslationProvider>
        <AnimatedSplashScreen onAnimationFinish={() => setSplashFinished(true)} />
        <StatusBar style="light" />
      </TranslationProvider>
    );
  }

  // Not logged in → show OTP login
  if (!isLoggedIn) {
    return (
      <TranslationProvider>
        <LoginScreen onLoginSuccess={() => setIsLoggedIn(true)} />
        <StatusBar style="light" />
      </TranslationProvider>
    );
  }

  // Logged in → show home
  return (
    <QueryClientProvider client={queryClient}>
      <TranslationProvider>
        <NotificationListener />
        <HomeScreen
          onLogout={() => setIsLoggedIn(false)}
          onNavigateToMap={async (lat?: number, lng?: number) => {
            if (lat && lng) {
              const url = `google.navigation:q=${lat},${lng}`;
              try {
                const supported = await Linking.canOpenURL(url);
                if (supported) {
                  await Linking.openURL(url);
                } else {
                  // Fallback to browser maps if app isn't installed
                  await Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`);
                }
              } catch (err) {
                Alert.alert('Error', 'Could not open map navigation');
              }
            } else {
              Alert.alert('No Destination', 'Could not find next stop coordinates');
            }
          }}
        />
        <StatusBar style="light" />
      </TranslationProvider>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0F172A',
  },
});
