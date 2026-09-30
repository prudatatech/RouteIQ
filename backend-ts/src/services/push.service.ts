import { Expo, ExpoPushMessage } from 'expo-server-sdk';
import { supabase } from '../core/supabase';

const expo = new Expo();

/**
 * Where a person's device token is kept: staff, vendors and drivers on their `users` row (the driver
 * app saves it itself), customers on their `customers` row (the backend saves it, see
 * customer-push.service.ts). Customers get the plain `default` Android channel; the loud `alarms`
 * channel belongs to the driver app.
 */
async function findPushTarget(userId: string): Promise<{ token: string; channelId: string } | null> {
  const { data: user } = await supabase.from('users').select('push_token').eq('id', userId).maybeSingle();
  if (user) return user.push_token ? { token: user.push_token, channelId: 'alarms' } : null;
  const { data: customer } = await supabase.from('customers').select('push_token').eq('id', userId).maybeSingle();
  return customer?.push_token ? { token: customer.push_token, channelId: 'default' } : null;
}

export const pushService = {
  async sendToUser(userId: string, title: string, body: string, data: any = {}) {
    try {
      const target = await findPushTarget(userId);
      if (!target || !Expo.isExpoPushToken(target.token)) return false;

      const message: ExpoPushMessage = {
        to: target.token,
        sound: 'default',
        title,
        body,
        data,
        channelId: target.channelId,
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
