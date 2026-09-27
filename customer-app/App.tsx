import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';

import SplashScreen from './src/screens/SplashScreen';
import LoginScreen from './src/screens/LoginScreen';
import HomeScreen from './src/screens/HomeScreen';
import NotificationsScreen from './src/screens/NotificationsScreen';
import LocationSearchScreen from './src/screens/LocationSearchScreen';
import CargoConfigScreen from './src/screens/CargoConfigScreen';

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <StatusBar style="light" />
      <Stack.Navigator 
        initialRouteName="Splash"
        screenOptions={{ 
          headerShown: false,
          animation: 'fade', // Subtle fade transition for opening new pages
        }}
      >
        <Stack.Screen name="Splash" component={SplashScreen} />
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen 
          name="Home" 
          component={HomeScreen} 
          options={{ animation: 'fade_from_bottom' }} 
        />
        <Stack.Screen 
          name="Notifications" 
          component={NotificationsScreen} 
          options={{ animation: 'slide_from_bottom' }} 
        />
        <Stack.Screen 
          name="LocationSearch" 
          component={LocationSearchScreen} 
          options={{ animation: 'fade' }} 
        />
        <Stack.Screen 
          name="CargoConfig" 
          component={CargoConfigScreen} 
          options={{ animation: 'slide_from_right' }} 
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
