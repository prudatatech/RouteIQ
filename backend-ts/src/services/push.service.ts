import { Expo, ExpoPushMessage } from 'expo-server-sdk';
import { supabase } from './supabase.service';

const expo = new Expo();

export const pushService = {
  async sendToUser(userId: string, title: string, body: string, data: any = {}) {
    try {
      const { data: user, error } = await supabase
        .from('users')
        .select('push_token')
        .eq('id', userId)
        .single();

      if (error || !user || !user.push_token) {
        return false;
      }

      if (!Expo.isExpoPushToken(user.push_token)) {
        return false;
      }

      const message: ExpoPushMessage = {
        to: user.push_token,
        sound: 'default',
        title,
        body,
        data,
        channelId: 'alarms',
      };

      const chunks = expo.chunkPushNotifications([message]);
      for (const chunk of chunks) {
        await expo.sendPushNotificationsAsync(chunk);
      }
      return true;
    } catch (e) {
      console.error('Push error:', e);
      return false;
    }
  }
};
