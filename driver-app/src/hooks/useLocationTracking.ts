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
import { locationService, type BackgroundError } from '../services/location';
import type { LatLng } from '../types/route';
import { useTranslation } from './useTranslation';
import { shortFeedback } from '../utils/feedback';

const TRACKING_KEY = 'tracking_active';
/** How long a speed reading is shown after it was taken. */
const SPEED_STALE_MS = 15000;

interface Options {
  /** Tracking cannot be paused while a route is active. */
  isRouteActive: boolean;
  /** Driver came within the geofence of a pending stop. */
  onGeofenceArrival?: (alert: { stop_id: string; message: string }) => void;
  /** Server asked the app to re-fetch the route. */
  onRouteSyncRequested?: () => void;
  /** Ask the device-location-status hook to re-check immediately (e.g. after a permission prompt), instead of waiting for its polling interval. */
  onDeviceLocationRecheck?: () => void;
}

export function useLocationTracking({
  isRouteActive,
  onGeofenceArrival,
  onRouteSyncRequested,
  onDeviceLocationRecheck,
}: Options) {
  const { t } = useTranslation();
  const [isTracking, setIsTracking] = useState(locationService.isTracking);
  const [currentLoc, setCurrentLoc] = useState<LatLng | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [speedReading, setSpeedReading] = useState<{ kmph: number; at: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [backgroundError, setBackgroundError] = useState<BackgroundError | null>(locationService.getLastBackgroundError());

  // locationService keeps the callbacks it was started with, so they read
  // the latest handlers through refs.
  const optionsRef = useRef({ isRouteActive, onGeofenceArrival, onRouteSyncRequested, onDeviceLocationRecheck });
  optionsRef.current = { isRouteActive, onGeofenceArrival, onRouteSyncRequested, onDeviceLocationRecheck };

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
        (loc, speedMps) => {
          setCurrentLoc({ lat: loc.lat, lng: loc.lng });
          setSpeedReading(speedMps === null ? null : { kmph: speedMps * 3.6, at: Date.now() });
        },
        (err) => setBackgroundError(err),
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
    setSpeedReading(null);
    await AsyncStorage.setItem(TRACKING_KEY, 'false');
    try {
      deactivateKeepAwake();
    } catch {}
  }, []);

  /** Dismisses the background-error pill; the next ping/geofence check reports fresh. */
  const retryBackgroundTracking = useCallback(() => {
    locationService.clearLastBackgroundError();
    setBackgroundError(null);
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
    // Same rule as pausing: while a route is active the phone keeps reporting, so no break
    if (optionsRef.current.isRouteActive) {
      Alert.alert(t('cannot_pause_title'), t('cannot_pause_desc'));
      return;
    }
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
        // Let StatusStrip reflect the permission decision immediately instead
        // of waiting for its own polling interval.
        optionsRef.current.onDeviceLocationRecheck?.();
        if (status === 'granted') {
          const servicesEnabled = await Location.hasServicesEnabledAsync();
          if (!servicesEnabled) {
            console.warn('Initial location fetch skipped: location services are off');
            return;
          }
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          setCurrentLoc((current) => current ?? { lat: loc.coords.latitude, lng: loc.coords.longitude });
        } else {
          console.warn('Initial location fetch skipped: permission not granted');
        }
      } catch (e) {
        console.warn('Initial location fetch failed:', e);
        optionsRef.current.onDeviceLocationRecheck?.();
      }
    })();
    // Runs once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A reading older than this is stale (signal lost, or the phone stopped reporting), so the speed is hidden
  useEffect(() => {
    if (!speedReading) return;
    const id = setInterval(() => setNow(Date.now()), SPEED_STALE_MS / 3);
    return () => clearInterval(id);
  }, [speedReading]);
  const speedKmph = isTracking && speedReading && now - speedReading.at < SPEED_STALE_MS ? Math.round(speedReading.kmph) : null;

  return { isTracking, isStarting, currentLoc, speedKmph, start, toggle, takeBreak, backgroundError, retryBackgroundTracking };
}
