import React from 'react';
import { StyleSheet, View } from 'react-native';
import { DefaultTheme, NavigationContainer, type Theme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';

import SplashScreen from './src/screens/SplashScreen';
import LoginScreen from './src/screens/LoginScreen';
import MainTabs from './src/navigation/MainTabs';
import LocationSearchScreen from './src/screens/LocationSearchScreen';
import CargoConfigScreen from './src/screens/CargoConfigScreen';
import { themeFonts } from './src/theme/fonts';
import { colors } from './src/theme';

const Stack = createNativeStackNavigator();

const navigationTheme: Theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.accent,
    background: colors.bg,
    card: colors.surface,
    text: colors.text,
    border: colors.border,
    notification: colors.danger,
  },
};

export default function App() {
  // Hold on the splash background until the theme fonts are ready; if they
  // fail to load the app still starts with the system font.
  const [fontsLoaded, fontError] = useFonts(themeFonts);

  if (!fontsLoaded && !fontError) {
    return <View style={styles.fontGate} />;
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer theme={navigationTheme}>
        <StatusBar style="dark" />
        <Stack.Navigator
          initialRouteName="Splash"
          screenOptions={{
            headerShown: false,
            animation: 'fade', // Subtle fade transition for opening new pages
          }}
        >
          <Stack.Screen name="Splash" component={SplashScreen} />
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="Main" component={MainTabs} options={{ animation: 'fade_from_bottom' }} />
          <Stack.Screen name="LocationSearch" component={LocationSearchScreen} options={{ animation: 'fade' }} />
          <Stack.Screen name="CargoConfig" component={CargoConfigScreen} options={{ animation: 'slide_from_right' }} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  // Matches the native splash background so there is no flash.
  fontGate: { flex: 1, backgroundColor: colors.surface },
});
