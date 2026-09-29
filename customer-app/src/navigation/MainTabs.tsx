import React from 'react';
import { Feather } from '@expo/vector-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import HomeScreen from '../screens/HomeScreen';
import NotificationsScreen from '../screens/NotificationsScreen';
import AccountScreen from '../screens/AccountScreen';
import { colors, size, type } from '../theme';

const Tab = createBottomTabNavigator();

function icon(name: keyof typeof Feather.glyphMap) {
  return function TabIcon({ color }: { color: string }) {
    return <Feather name={name} size={size.icon.lg} color={color} />;
  };
}

/** The three signed-in destinations. Safe-area insets are applied by the tab bar. */
export default function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: type.captionMedium,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
      }}
    >
      <Tab.Screen name="Home" component={HomeScreen} options={{ title: 'Home', tabBarIcon: icon('home') }} />
      <Tab.Screen
        name="Notifications"
        component={NotificationsScreen}
        options={{ title: 'Notifications', tabBarIcon: icon('bell') }}
      />
      <Tab.Screen name="Account" component={AccountScreen} options={{ title: 'Account', tabBarIcon: icon('user') }} />
    </Tab.Navigator>
  );
}
