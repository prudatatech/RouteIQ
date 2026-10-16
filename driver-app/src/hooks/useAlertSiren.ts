/**
 * Loud, repeating attention signal: looping sound, looping vibration and a
 * pulse animation while `ringing` is true, plus a repeating local
 * notification while an assignment waits so it is noticed in the background.
 *
 * Reserved for new route assignments, inserted stops and dispatch calls.
 * Everything else uses a single short buzz (utils/feedback.ts).
 */
import { useEffect, useRef } from 'react';
import { Animated, Vibration } from 'react-native';
import { useAudioPlayer } from 'expo-audio';
import * as Notifications from 'expo-notifications';
import { useTranslation } from './useTranslation';

interface Options {
  /** Play the looping siren and vibration. */
  ringing: boolean;
  /** An assignment is waiting for the driver (repeat a notification every 30 s). */
  assignmentWaiting: 'route' | 'stop' | null;
}

const sirenSource = require('../../assets/uber_driver_sound.mp3');

export function useAlertSiren({ ringing, assignmentWaiting }: Options) {
  const { t } = useTranslation();
  const pulse = useRef(new Animated.Value(1)).current;

  // expo-audio: create a player for the siren sound
  const player = useAudioPlayer(sirenSource);

  // Background reminder through the "alarms" channel
  useEffect(() => {
    if (!assignmentWaiting) return;
    let notificationId: string | undefined;
    let cancelled = false;

    Notifications.scheduleNotificationAsync({
      content: {
        title: t('notify_action_required'),
        body: assignmentWaiting === 'route' ? t('notify_new_route') : t('notify_confirm_stop'),
        sound: 'uber_driver_sound.mp3',
      },
      trigger: { seconds: 30, repeats: true, channelId: 'alarms' } as any,
    })
      .then((id) => {
        if (cancelled) Notifications.cancelScheduledNotificationAsync(id);
        else notificationId = id;
      })
      .catch((e) => console.warn('Could not schedule reminder', e));

    return () => {
      cancelled = true;
      if (notificationId) Notifications.cancelScheduledNotificationAsync(notificationId);
    };
  }, [assignmentWaiting, t]);

  // Foreground siren
  useEffect(() => {
    if (!ringing) return;

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.05, duration: 500, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 500, useNativeDriver: true }),
      ]),
    );
    loop.start();
    Vibration.vibrate([500, 500, 500], true);

    try {
      player.loop = true;
      player.volume = 1.0;
      player.play();
    } catch (e) {
      console.warn('Failed to play notification sound', e);
    }

    return () => {
      loop.stop();
      pulse.setValue(1);
      Vibration.cancel();
      try {
        player.pause();
        player.seekTo(0);
      } catch {
        // already released
      }
    };
  }, [ringing, pulse, player]);

  return { pulse };
}
