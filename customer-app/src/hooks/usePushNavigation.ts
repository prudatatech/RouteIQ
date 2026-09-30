import { useCallback, useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import type { NavigationContainerRefWithCurrent } from '@react-navigation/native';
import { notificationTarget, type NotificationTarget } from '../utils/notificationTarget';

/** Opens a notification's target from anywhere in the app. Invoices is a tab; the others are root screens. */
export function openTarget(navigation: { navigate: (...args: any[]) => void }, target: NotificationTarget) {
  if (target.screen === 'Invoices') navigation.navigate('Main', { screen: 'Invoices' });
  else navigation.navigate(target.screen, target.params);
}

/**
 * Tapping a push opens the exact screen, with the same routing as the in-app list. A tap that
 * started the app (or arrived while the sign-in screen was up) waits for the app to reach its tabs:
 * it opens once the customer is signed in and past the splash, and is dropped on the sign-in screen,
 * so a later sign-in never jumps to an old notification. Pass the returned `flush` to the
 * NavigationContainer's `onReady` and `onStateChange`.
 */
export function usePushNavigation(navigationRef: NavigationContainerRefWithCurrent<any>) {
  const pending = useRef<NotificationTarget | null>(null);
  const handled = useRef<Set<string>>(new Set());

  const flush = useCallback(() => {
    const target = pending.current;
    if (!target || !navigationRef.isReady()) return;
    const route = navigationRef.getCurrentRoute()?.name;
    if (route === 'Splash') return;
    pending.current = null;
    if (route === 'Login') return;
    openTarget(navigationRef, target);
  }, [navigationRef]);

  useEffect(() => {
    const open = (response: Notifications.NotificationResponse) => {
      const id = response.notification.request.identifier;
      if (handled.current.has(id)) return;
      handled.current.add(id);
      const data = response.notification.request.content.data as Record<string, unknown> | undefined;
      const target = notificationTarget(data?.type, data);
      if (!target) return;
      pending.current = target;
      flush();
    };

    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    // The app was closed and the tap started it.
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response) {
          open(response);
          Notifications.clearLastNotificationResponse();
        }
      })
      .catch(() => {});
    return () => subscription.remove();
  }, [flush]);

  return flush;
}
