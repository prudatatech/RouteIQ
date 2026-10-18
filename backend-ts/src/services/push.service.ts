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
  /**
   * Direct push send to a user. Used by tests and direct callers.
   * Returns true when sent, false when no token or error.
   */
  async sendToUser(userId: string, title: string, body: string, data: any = {}): Promise<boolean> {
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
  },

  /**
   * Immediate dispatch for a recorded notification row.
   * Runs in the background (fire-and-forget), updating push_status on the notification row.
   */
  async dispatchPushForNotification(
    notificationId: string,
    userId: string,
    title: string,
    body: string,
    data: any = {}
  ): Promise<boolean> {
    try {
      const target = await findPushTarget(userId);
      if (!target || !Expo.isExpoPushToken(target.token)) {
        await supabase
          .from('notifications')
          .update({ push_status: 'not_applicable', push_attempts: 1 })
          .eq('id', notificationId);
        return false;
      }

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

      await supabase
        .from('notifications')
        .update({
          push_status: 'sent',
          push_attempts: 1,
          push_sent_at: new Date().toISOString(),
          push_error: null,
        })
        .eq('id', notificationId);
      return true;
    } catch (e: any) {
      console.error('[push] Notification push failed:', e);
      await supabase
        .from('notifications')
        .update({
          push_status: 'failed',
          push_attempts: 1,
          push_error: e?.message ?? String(e),
        })
        .eq('id', notificationId);
      return false;
    }
  },

  /**
   * Scheduler sweep: retries notifications whose push failed or remained pending.
   * Bounded to max 3 attempts and within the last 24 hours (older than 10s to avoid racing immediate dispatch).
   */
  async retryPendingPushes(limit = 50): Promise<number> {
    const minAge = new Date(Date.now() - 10_000).toISOString();
    const maxAge = new Date(Date.now() - 24 * 3600_000).toISOString();

    const { data: pending, error } = await supabase
      .from('notifications')
      .select('id, user_id, title, body, type, data, push_attempts')
      .in('push_status', ['pending', 'failed'])
      .lt('push_attempts', 3)
      .lt('created_at', minAge)
      .gt('created_at', maxAge)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (error || !pending || pending.length === 0) return 0;

    let successful = 0;
    for (const item of pending) {
      const attempts = (Number(item.push_attempts) || 0) + 1;
      try {
        const target = await findPushTarget(item.user_id);
        if (!target || !Expo.isExpoPushToken(target.token)) {
          await supabase
            .from('notifications')
            .update({ push_status: 'not_applicable', push_attempts: attempts })
            .eq('id', item.id);
          continue;
        }

        const message: ExpoPushMessage = {
          to: target.token,
          sound: 'default',
          title: item.title,
          body: item.body,
          data: { ...(item.data ?? {}), type: item.type },
          channelId: target.channelId,
        };

        const chunks = expo.chunkPushNotifications([message]);
        for (const chunk of chunks) {
          await expo.sendPushNotificationsAsync(chunk);
        }

        await supabase
          .from('notifications')
          .update({
            push_status: 'sent',
            push_attempts: attempts,
            push_sent_at: new Date().toISOString(),
            push_error: null,
          })
          .eq('id', item.id);
        successful++;
      } catch (e: any) {
        console.error(`[push-retry] Failed for notification ${item.id}:`, e);
        await supabase
          .from('notifications')
          .update({
            push_status: 'failed',
            push_attempts: attempts,
            push_error: e?.message ?? String(e),
          })
          .eq('id', item.id);
      }
    }
    return successful;
  },
};
