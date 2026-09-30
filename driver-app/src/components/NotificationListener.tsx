import React, { useEffect } from 'react';
import { DeviceEventEmitter, ToastAndroid, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { supabase } from '../services/supabase';
import { api } from '../services/api';
import { colors } from '../theme';
import { openNotification } from '../services/driverLinks';

// Configure how notifications behave when the app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/** Emitted when a cargo notification arrives (a transfer planned, a case opened ...), so the cargo data reloads. */
export const CARGO_CHANGED_EVENT = 'driver:cargo-changed';

const isCargoType = (type: unknown) => typeof type === 'string' && (type.startsWith('cargo_') || type === 'driver_action_rejected');

/** Emitted when any notification arrives, so the in-app list and its unread count reload. */
export const NOTIFICATIONS_CHANGED_EVENT = 'driver:notifications-changed';

/**
 * Tapping a push opens the exact place it is about (see utils/notificationTarget). The push's
 * data carries `type` and the ids; its title and body are kept for the banner Home shows.
 */
function openTarget(response: Notifications.NotificationResponse) {
  const content = response.notification.request.content;
  const data = (content.data ?? {}) as Record<string, unknown>;
  const type = String(data.type ?? '');
  if (isCargoType(type)) DeviceEventEmitter.emit(CARGO_CHANGED_EVENT, type);
  openNotification({ type, title: content.title, body: content.body, data }, response.notification.request.identifier);
}

export const NotificationListener = () => {
  const [userId, setUserId] = React.useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      registerForPushNotificationsAsync().catch(() => undefined),
      api.getDriverInfo(),
    ]).then(([currentToken, info]: [string | undefined, any]) => {
      if (info?.id) {
        setUserId(info.id);
        if (currentToken) {
          // RLS allows a driver to set push_token on their own users row only.
          supabase.from('users').update({ push_token: currentToken }).eq('id', info.id)
            .then(({ error }) => {
              if (error) console.error("Failed to save push token:", error);
              else console.log("Push token saved to Supabase!");
            });
        }
      }
    });

    // Listen for incoming push notifications to play custom sounds if needed
    const subscription = Notifications.addNotificationReceivedListener(notification => {
      const type = (notification.request.content.data as { type?: unknown } | undefined)?.type;
      if (isCargoType(type)) DeviceEventEmitter.emit(CARGO_CHANGED_EVENT, type);
      DeviceEventEmitter.emit(NOTIFICATIONS_CHANGED_EVENT);
    });

    const responseSubscription = Notifications.addNotificationResponseReceivedListener(openTarget);

    // The app was closed and a notification tap started it.
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        // Home takes the target when it mounts, so no delay is needed here
        if (response) openTarget(response);
      })
      .catch(() => {});

    return () => {
      subscription.remove();
      responseSubscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!userId) return;

    // We still keep the realtime channel as a backup for when the app is active
    const channel = supabase.channel('driver_notifications')
      .on('postgres_changes', { 
        event: 'INSERT', 
        schema: 'public', 
        table: 'notifications',
        filter: `user_id=eq.${userId}`
      }, (payload) => {
        const newNotif = payload.new as any;
        if (isCargoType(newNotif?.type)) DeviceEventEmitter.emit(CARGO_CHANGED_EVENT, newNotif.type);
        DeviceEventEmitter.emit(NOTIFICATIONS_CHANGED_EVENT);
        
        // Show Toast/Alert for the driver
        if (Platform.OS === 'android') {
          ToastAndroid.showWithGravity(
            `${newNotif.title}: ${newNotif.body}`,
            ToastAndroid.LONG,
            ToastAndroid.TOP
          );
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  return null; // Headless component
};

async function registerForPushNotificationsAsync() {
  let token;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: colors.accentFill,
      sound: 'default'
    });
    await Notifications.setNotificationChannelAsync('alarms', {
      name: 'Loud Alarms',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 500, 500, 500],
      lightColor: colors.danger,
      sound: 'uber_driver_sound.mp3'
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') {
    console.log('Failed to get push token for push notification!');
    return;
  }
  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) {
      console.log('No EAS projectId in app config; cannot get a push token');
      return;
    }
    token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  } catch (e) {
    console.log("Error getting push token", e);
  }

  return token;
}
