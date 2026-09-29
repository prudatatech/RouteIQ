/**
 * Whether the phone can provide a location: app permission and the device's
 * location services. Re-checked every 10 s and whenever the app returns to
 * the foreground (for example after the driver changes a setting).
 */
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';

export type LocationPermission = 'granted' | 'denied' | 'undetermined';

export interface DeviceLocationStatus {
  permission: LocationPermission;
  servicesEnabled: boolean;
  checked: boolean;
}

const CHECK_MS = 10000;

export function useDeviceLocationStatus() {
  const [status, setStatus] = useState<DeviceLocationStatus>({
    permission: 'undetermined',
    servicesEnabled: true,
    checked: false,
  });

  const check = useCallback(async () => {
    try {
      const [{ status: permission }, servicesEnabled] = await Promise.all([
        Location.getForegroundPermissionsAsync(),
        Location.hasServicesEnabledAsync(),
      ]);
      setStatus((prev) =>
        prev.permission === permission && prev.servicesEnabled === servicesEnabled && prev.checked
          ? prev
          : { permission: permission as LocationPermission, servicesEnabled, checked: true },
      );
    } catch (e) {
      console.warn('Location status check failed:', e);
    }
  }, []);

  useEffect(() => {
    check();
    const interval = setInterval(check, CHECK_MS);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, [check]);

  return { ...status, recheck: check };
}
