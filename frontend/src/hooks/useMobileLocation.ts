import { useEffect, useState, useRef } from 'react';

/**
 * useMobileLocation – custom hook that watches the device's geolocation when the
 * `VITE_ENABLE_MOBILE_GPS` flag is set to true. It returns the latest position,
 * any error message, and whether the feature is enabled.
 */
export const useMobileLocation = () => {
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const watchIdRef = useRef<number | null>(null);

  const enabled = import.meta.env.VITE_ENABLE_MOBILE_GPS === 'true' || import.meta.env.VITE_ENABLE_MOBILE_GPS === true;

  useEffect(() => {
    if (!enabled) return;
    if (!navigator.geolocation) {
      setError('Geolocation not supported');
      return;
    }
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setError(null);
      },
      (err) => {
        setError(err.message);
      },
      { enableHighAccuracy: true }
    );
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, [enabled]);

  return { position, error, enabled };
};
