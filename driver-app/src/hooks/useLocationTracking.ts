/**
 * Live GPS tracking for the driver: start/stop through locationService,
 * the latest position for the map and next-action card, and breaks.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { api } from '../services/api';
import { locationService } from '../services/location';
import type { LatLng } from '../types/route';
import { useTranslation } from './useTranslation';
import { shortFeedback } from '../utils/feedback';

const TRACKING_KEY = 'tracking_active';

interface Options {
  /** Tracking cannot be paused while a route is active. */
  isRouteActive: boolean;
  /** Driver came within the geofence of a pending stop. */
  onGeofenceArrival?: (alert: { stop_id: string; message: string }) => void;
  /** Server asked the app to re-fetch the route. */
  onRouteSyncRequested?: () => void;
}

export function useLocationTracking({ isRouteActive, onGeofenceArrival, onRouteSyncRequested }: Options) {
  const { t } = useTranslation();
  const [isTracking, setIsTracking] = useState(locationService.isTracking);
  const [currentLoc, setCurrentLoc] = useState<LatLng | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  // locationService keeps the callbacks it was started with, so they read
  // the latest handlers through refs.
  const optionsRef = useRef({ isRouteActive, onGeofenceArrival, onRouteSyncRequested });
  optionsRef.current = { isRouteActive, onGeofenceArrival, onRouteSyncRequested };

  const start = useCallback(async (): Promise<boolean> => {
    setIsStarting(true);
    try {
      // Resume from break if any
      try {
        await api.setBreakStatus(false);
      } catch {}

      const result = await locationService.start(
        (alert) => optionsRef.current.onGeofenceArrival?.(alert),
        (commands) => {
          for (const cmd of commands) {
            if (cmd.type === 'sync' && cmd.action === 'fetch_route') {
              optionsRef.current.onRouteSyncRequested?.();
            }
          }
        },
        (loc) => setCurrentLoc({ lat: loc.lat, lng: loc.lng }),
      );
      if (!result.success) {
        Alert.alert(t('tracking_failed_title'), result.error || t('tracking_failed_desc'));
        return false;
      }
      setIsTracking(true);
      await AsyncStorage.setItem(TRACKING_KEY, 'true');
      try {
        await activateKeepAwakeAsync();
      } catch {}
      return true;
    } finally {
      setIsStarting(false);
    }
  }, [t]);

  const stop = useCallback(async () => {
    locationService.stop();
    setIsTracking(false);
    await AsyncStorage.setItem(TRACKING_KEY, 'false');
    try {
      deactivateKeepAwake();
    } catch {}
  }, []);

  /** Turns tracking on or off; returns true when the state changed. */
  const toggle = useCallback(async (): Promise<boolean> => {
    if (locationService.isTracking) {
      if (optionsRef.current.isRouteActive) {
        Alert.alert(t('cannot_pause_title'), t('cannot_pause_desc'));
        return false;
      }
      await stop();
      shortFeedback();
      return true;
    }
    const started = await start();
    if (started) shortFeedback();
    return started;
  }, [start, stop, t]);

  const takeBreak = useCallback(() => {
    Alert.alert(t('alert_take_break_title'), t('alert_take_break_desc'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('alert_take_break_title'),
        onPress: async () => {
          try {
            await stop();
            await api.setBreakStatus(true);
            Alert.alert(t('alert_break_started_title'), t('alert_break_started_desc'));
          } catch (err: any) {
            Alert.alert(t('error'), err?.message || t('break_failed'));
          }
        },
      },
    ]);
  }, [stop, t]);

  useEffect(() => {
    // Restore tracking if it was on when the app last closed
    AsyncStorage.getItem(TRACKING_KEY).then((val) => {
      if (val === 'true' && !locationService.isTracking) start();
    });

    // First position so the map and routing work before tracking starts
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          setCurrentLoc((current) => current ?? { lat: loc.coords.latitude, lng: loc.coords.longitude });
        }
      } catch (e) {
        console.warn('Initial location fetch failed:', e);
      }
    })();
    // Runs once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { isTracking, isStarting, currentLoc, start, toggle, takeBreak };
}
