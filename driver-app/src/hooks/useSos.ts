/**
 * One-tap SOS. The alert is sent at once as a panic button with the best
 * position already known; the driver can then add what happened, which is
 * added to that same alert (never a second one).
 */
import { useCallback, useRef, useState } from 'react';
import { Vibration } from 'react-native';
import * as Location from 'expo-location';
import * as Crypto from 'expo-crypto';
import { api, ApiError, type SosSeverity, type SosType } from '../services/api';
import { actionQueue } from '../services/actionQueue';
import type { LatLng } from '../types/route';
import { isNetworkError } from '../utils/errors';

export type SosFailure = 'offline' | 'no_vehicle' | 'error';

export type SosState =
  | { phase: 'sending' }
  | { phase: 'sent'; withLocation: boolean }
  | { phase: 'failed'; reason: SosFailure };

/** 'queued': no signal, kept on the phone and sent when it is back. */
export type SosDetailsState = 'idle' | 'sending' | 'sent' | 'queued' | 'failed';

/** Longest wait for a fresh fix, and only when no position is known at all. */
const FIX_TIMEOUT_MS = 3000;
const LAST_KNOWN_MAX_AGE_MS = 5 * 60 * 1000;

async function bestKnownPosition(currentLoc: LatLng | null): Promise<LatLng | null> {
  if (currentLoc) return currentLoc;
  try {
    const last = await Location.getLastKnownPositionAsync({ maxAge: LAST_KNOWN_MAX_AGE_MS });
    if (last) return { lat: last.coords.latitude, lng: last.coords.longitude };
  } catch {}
  try {
    const fix = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), FIX_TIMEOUT_MS)),
    ]);
    if (fix) return { lat: fix.coords.latitude, lng: fix.coords.longitude };
  } catch {}
  return null;
}

function failureOf(error: unknown): SosFailure {
  if (error instanceof ApiError && error.status === 404) return 'no_vehicle';
  if (isNetworkError(error)) return 'offline';
  return 'error';
}

export function useSos(currentLoc: LatLng | null) {
  const [state, setState] = useState<SosState>({ phase: 'sending' });
  const [details, setDetails] = useState<SosDetailsState>('idle');
  const alertIdRef = useRef<string | null>(null);
  /** Kept between retries of one SOS, so a lost reply never raises a second alert. */
  const triggerKeyRef = useRef<string | null>(null);
  const currentLocRef = useRef(currentLoc);
  currentLocRef.current = currentLoc;

  const trigger = useCallback(async () => {
    setState({ phase: 'sending' });
    setDetails('idle');
    alertIdRef.current = null;
    Vibration.vibrate(100);
    const position = await bestKnownPosition(currentLocRef.current);
    if (!triggerKeyRef.current) triggerKeyRef.current = Crypto.randomUUID();
    try {
      const res = await api.triggerSos(position?.lat ?? null, position?.lng ?? null, 'panic_button', undefined, triggerKeyRef.current);
      triggerKeyRef.current = null;
      alertIdRef.current = res?.id ?? null;
      setState({ phase: 'sent', withLocation: !!position });
    } catch (e) {
      console.warn('SOS failed', e);
      setState({ phase: 'failed', reason: failureOf(e) });
    }
  }, []);

  const sendDetails = useCallback(async (type: SosType, description: string, severity?: SosSeverity) => {
    const id = alertIdRef.current;
    if (!id) {
      setDetails('failed');
      return;
    }
    setDetails('sending');
    try {
      const outcome = await actionQueue.submit('sos_details', {
        alertId: id,
        details: { alert_type: type, description: description.trim() || undefined, severity },
      });
      setDetails(outcome.status === 'queued' ? 'queued' : 'sent');
    } catch (e) {
      console.warn('SOS details failed', e);
      setDetails('failed');
    }
  }, []);

  return { state, details, trigger, sendDetails };
}
