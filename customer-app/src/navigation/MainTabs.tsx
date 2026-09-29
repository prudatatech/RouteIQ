import React, { useCallback, useEffect, useState } from 'react';
import { DeviceEventEmitter } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import HomeScreen from '../screens/HomeScreen';
import BookingsScreen from '../screens/BookingsScreen';
import NotificationsScreen from '../screens/NotificationsScreen';
import AccountScreen from '../screens/AccountScreen';
import { api, NOTIFICATIONS_CHANGED_EVENT } from '../services/api';
import { useTranslation } from '../hooks/useTranslation';
import { colors, size, type } from '../theme';

/** How often the unread count is checked while the app is open. */
const BADGE_REFRESH_MS = 60_000;

const Tab = createBottomTabNavigator();

function icon(name: keyof typeof Feather.glyphMap) {
  return function TabIcon({ color }: { color: string }) {
    return <Feather name={name} size={size.icon.lg} color={color} />;
  };
}

/** The signed-in destinations. Safe-area insets are applied by the tab bar. */
export default function MainTabs() {
  const { t } = useTranslation();
  const [unread, setUnread] = useState(0);
  const refreshUnread = useCallback(() => {
    api
      .getNotifications({ limit: 1 })
      .then((res) => setUnread(res.unread_count))
      .catch(() => {
        // The badge is a convenience: keep the last count when there is no signal.
      });
  }, []);

  useEffect(() => {
    refreshUnread();
    const timer = setInterval(refreshUnread, BADGE_REFRESH_MS);
    const sub = DeviceEventEmitter.addListener(NOTIFICATIONS_CHANGED_EVENT, refreshUnread);
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [refreshUnread]);

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
      <Tab.Screen name="Home" component={HomeScreen} options={{ title: t('tab_home'), tabBarIcon: icon('home') }} />
      <Tab.Screen name="Bookings" component={BookingsScreen} options={{ title: t('tab_bookings'), tabBarIcon: icon('package') }} />
      <Tab.Screen
        name="Notifications"
        component={NotificationsScreen}
        options={{
          title: t('tab_notifications'),
          tabBarIcon: icon('bell'),
          tabBarBadge: unread > 0 ? (unread > 9 ? '9+' : unread) : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.danger, color: colors.onSolid },
          tabBarAccessibilityLabel: unread > 0 ? t('tab_notifications_unread', { n: unread }) : t('tab_notifications'),
        }}
      />
      <Tab.Screen name="Account" component={AccountScreen} options={{ title: t('tab_account'), tabBarIcon: icon('user') }} />
    </Tab.Navigator>
  );
}
