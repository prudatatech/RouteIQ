/**
 * Location that stays off on an active route gets one louder reminder.
 *
 * The first minutes only show the red status pill and one short buzz. If GPS is
 * still off after 2 minutes, one high-priority local notification with sound is
 * shown, once per episode. It is scheduled ahead of time, so it also fires when
 * the app is in the background, and cancelled if location comes back first.
 * It is a single notification, not the looping siren.
 */
import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { useTranslation } from './useTranslation';

export const GPS_OFF_ESCALATION_S = 120;

export function useGpsOffEscalation(gpsOffOnRoute: boolean) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!gpsOffOnRoute) return;
    let notificationId: string | undefined;
    let cancelled = false;

    Notifications.scheduleNotificationAsync({
      content: {
        title: t('notify_gps_off_title'),
        body: t('notify_gps_off_body'),
        sound: 'default',
        priority: Notifications.AndroidNotificationPriority.MAX,
      },
      trigger: { seconds: GPS_OFF_ESCALATION_S, channelId: 'default' } as any,
    })
      .then((id) => {
        if (cancelled) Notifications.cancelScheduledNotificationAsync(id);
        else notificationId = id;
      })
      .catch((e) => console.warn('Could not schedule the GPS reminder', e));

    return () => {
      cancelled = true;
      if (notificationId) Notifications.cancelScheduledNotificationAsync(notificationId);
    };
  }, [gpsOffOnRoute, t]);
}
