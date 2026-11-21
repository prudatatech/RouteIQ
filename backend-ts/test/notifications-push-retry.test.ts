import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseMock } from './support/mock-supabase';
import { ID } from './support/cargo-world';

const sent = vi.hoisted(() => ({ messages: [] as any[], shouldThrow: false }));
vi.mock('expo-server-sdk', () => {
  class Expo {
    static isExpoPushToken = (t: unknown) => typeof t === 'string' && /^ExponentPushToken\[.+\]$/.test(t);
    chunkPushNotifications = (m: any[]) => [m];
    sendPushNotificationsAsync = async (chunk: any[]) => {
      if (sent.shouldThrow) throw new Error('Expo server network timeout');
      sent.messages.push(...chunk);
      return [];
    };
  }
  return { Expo };
});

import { pushService } from '../src/services/push.service';

const TOKEN = 'ExponentPushToken[driver123]';

describe('push dispatch & retry sweep', () => {
  beforeEach(() => {
    sent.messages.length = 0;
    sent.shouldThrow = false;
    supabaseMock.reset({
      users: [
        { id: ID.driver1, role: 'driver', is_active: true, push_token: TOKEN },
        { id: 'user-no-token', role: 'admin', is_active: true, push_token: null },
      ],
      customers: [],
      notifications: [],
    });
  });

  describe('dispatchPushForNotification', () => {
    it('marks not_applicable when recipient has no push token', async () => {
      const notifId = 'n-no-token';
      supabaseMock.rows('notifications').push({
        id: notifId,
        user_id: 'user-no-token',
        title: 'Report Ready',
        body: 'Check finance',
        type: 'report',
        push_status: 'pending',
        push_attempts: 0,
      });

      const result = await pushService.dispatchPushForNotification(notifId, 'user-no-token', 'Report Ready', 'Check finance');
      expect(result).toBe(false);

      const row = supabaseMock.rows('notifications').find(n => n.id === notifId);
      expect(row?.push_status).toBe('not_applicable');
      expect(row?.push_attempts).toBe(1);
      expect(sent.messages).toHaveLength(0);
    });

    it('sends push and marks sent when recipient has a valid token', async () => {
      const notifId = 'n-with-token';
      supabaseMock.rows('notifications').push({
        id: notifId,
        user_id: ID.driver1,
        title: 'New Trip',
        body: 'Assigned trip #101',
        type: 'trip_assigned',
        push_status: 'pending',
        push_attempts: 0,
      });

      const result = await pushService.dispatchPushForNotification(notifId, ID.driver1, 'New Trip', 'Assigned trip #101');
      expect(result).toBe(true);

      const row = supabaseMock.rows('notifications').find(n => n.id === notifId);
      expect(row?.push_status).toBe('sent');
      expect(row?.push_attempts).toBe(1);
      expect(row?.push_sent_at).toBeDefined();
      expect(sent.messages).toHaveLength(1);
      expect(sent.messages[0]).toMatchObject({ to: TOKEN, title: 'New Trip', channelId: 'alarms' });
    });

    it('records failed status and error message when Expo throws', async () => {
      sent.shouldThrow = true;
      const notifId = 'n-error';
      supabaseMock.rows('notifications').push({
        id: notifId,
        user_id: ID.driver1,
        title: 'Emergency',
        body: 'SOS active',
        type: 'sos',
        push_status: 'pending',
        push_attempts: 0,
      });

      const result = await pushService.dispatchPushForNotification(notifId, ID.driver1, 'Emergency', 'SOS active');
      expect(result).toBe(false);

      const row = supabaseMock.rows('notifications').find(n => n.id === notifId);
      expect(row?.push_status).toBe('failed');
      expect(row?.push_attempts).toBe(1);
      expect(row?.push_error).toContain('Expo server network timeout');
    });
  });

  describe('retryPendingPushes', () => {
    it('retries pending/failed notifications and marks them sent on success', async () => {
      const pastTime = new Date(Date.now() - 30_000).toISOString(); // 30s ago
      supabaseMock.rows('notifications').push({
        id: 'n-retry-1',
        user_id: ID.driver1,
        title: 'Retry Title',
        body: 'Retry Body',
        type: 'trip_reminder',
        data: { trip_id: 't1' },
        push_status: 'failed',
        push_attempts: 1,
        created_at: pastTime,
      });

      const retried = await pushService.retryPendingPushes();
      expect(retried).toBe(1);

      const row = supabaseMock.rows('notifications').find(n => n.id === 'n-retry-1');
      expect(row?.push_status).toBe('sent');
      expect(row?.push_attempts).toBe(2);
      expect(row?.push_sent_at).toBeDefined();
      expect(sent.messages).toHaveLength(1);
      expect(sent.messages[0].to).toBe(TOKEN);
    });
  });
});
