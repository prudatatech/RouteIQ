import React, { useEffect } from 'react';
import { ToastAndroid, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { supabase } from '../services/supabase';
import { api } from '../services/api';
import { Audio } from 'expo-av';

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

export const NotificationListener = () => {
  const [userId, setUserId] = React.useState<string | null>(null);

  useEffect(() => {
    let currentToken: string | undefined;

    registerForPushNotificationsAsync().then(token => {
      if (token) {
        console.log("Push Token:", token);
        currentToken = token;
      }
    });

    api.getDriverInfo().then((info: any) => {
      if (info?.id) {
        setUserId(info.id);
        if (currentToken) {
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
      console.log('Push notification received!', notification);
    });

    const responseSubscription = Notifications.addNotificationResponseReceivedListener(response => {
      console.log('User interacted with push notification:', response);
    });

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
      lightColor: '#FF231F7C',
      sound: 'default'
    });
    await Notifications.setNotificationChannelAsync('alarms', {
      name: 'Loud Alarms',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 500, 500, 500],
      lightColor: '#FF0000',
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
    const projectId = "1190a266-468e-4e8f-97cc-61048ab9f825"; // From app.json
    token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  } catch (e) {
    console.log("Error getting push token", e);
  }

  return token;
}
