/**
 * Parcel scans: what a scanned code means for the driver's route, and which
 * stops and parcels have been checked on this phone.
 *
 * A delivery scan is checked against the route the app already holds, so it
 * works without a connection, and is then reported to the server, which keeps
 * the record staff see ("parcel verified" in the shipment log).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { actionQueue } from '../services/actionQueue';
import type { DriverRoute, LatLng, RouteStop } from '../types/route';
import { errorMessage } from '../utils/errors';
import { normalizeParcelCode, planScan, sameParcelCode } from '../utils/parcel';
import type { ScanMethod } from '../components/scan/ParcelScanner';

const STORE_KEY = 'parcel_scan_state';
const MAX_KEPT = 200;

interface Stored {
  verified: string[];
  pickedUp: string[];
}

export type ScanOutcome =
  | { kind: 'picked_up'; code: string; already: boolean; /** No signal: saved on the phone, sent later. */ queued?: boolean }
  | { kind: 'verified'; stop: RouteStop; isNext: boolean }
  | { kind: 'already_done'; stop: RouteStop }
  | { kind: 'not_on_route' }
  | { kind: 'error'; message: string };

export type StopCheck = 'ok' | 'wrong';

interface Options {
  route: DriverRoute | undefined;
  currentLoc: LatLng | null;
  refresh: () => Promise<unknown>;
}

export function useParcelScan({ route, currentLoc, refresh }: Options) {
  const [verified, setVerified] = useState<Set<string>>(new Set());
  const [pickedUp, setPickedUp] = useState<Set<string>>(new Set());
  const loaded = useRef(false);
  const pickedUpRef = useRef(pickedUp);
  pickedUpRef.current = pickedUp;
  const verifiedRef = useRef(verified);
  verifiedRef.current = verified;

  useEffect(() => {
    AsyncStorage.getItem(STORE_KEY)
      .then((raw) => {
        if (!raw) return;
        const stored = JSON.parse(raw) as Partial<Stored>;
        setVerified((cur) => new Set([...(stored.verified ?? []), ...cur]));
        setPickedUp((cur) => new Set([...(stored.pickedUp ?? []), ...cur]));
      })
      .catch(() => {})
      .finally(() => {
        loaded.current = true;
      });
  }, []);

  const persist = useCallback((v: Set<string>, p: Set<string>) => {
    const stored: Stored = { verified: [...v].slice(-MAX_KEPT), pickedUp: [...p].slice(-MAX_KEPT) };
    AsyncStorage.setItem(STORE_KEY, JSON.stringify(stored)).catch(() => {});
  }, []);

  const markVerified = useCallback(
    (stopId: string) =>
      setVerified((cur) => {
        if (cur.has(stopId)) return cur;
        const next = new Set(cur).add(stopId);
        persist(next, pickedUpRef.current);
        return next;
      }),
    [persist],
  );

  const markPickedUp = useCallback(
    (code: string) =>
      setPickedUp((cur) => {
        const key = normalizeParcelCode(code);
        if (cur.has(key)) return cur;
        const next = new Set(cur).add(key);
        persist(verifiedRef.current, next);
        return next;
      }),
    [persist],
  );

  const position = currentLoc ? { lat: currentLoc.lat, lng: currentLoc.lng } : {};

  /** Records a delivery scan with the server. A failure here never blocks the driver. */
  const reportDelivery = useCallback(
    (stop: RouteStop, code: string, method: ScanMethod) => {
      actionQueue
        .submit('scan', { code, purpose: 'delivery', stopId: stop.id, method, ...position })
        .catch((e) => console.warn('[scan] delivery scan not recorded:', e));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentLoc],
  );

  /** A scan from the Scan tab: works out whether it is a pickup or a delivery check. */
  const handleCode = useCallback(
    async (code: string, method: ScanMethod): Promise<ScanOutcome> => {
      const plan = planScan(route, code, pickedUp);
      switch (plan.kind) {
        case 'not_on_route':
          return { kind: 'not_on_route' };
        case 'already_done':
          return { kind: 'already_done', stop: plan.stop };
        case 'pickup':
          try {
            const outcome = await actionQueue.submit('scan', {
              code,
              purpose: 'pickup',
              ...(plan.stop ? { stopId: plan.stop.id } : {}),
              method,
              ...position,
            });
            markPickedUp(plan.code);
            if (outcome.status === 'queued') return { kind: 'picked_up', code: plan.code, already: false, queued: true };
            refresh();
            return { kind: 'picked_up', code: outcome.result.tracking_id, already: outcome.result.already };
          } catch (e) {
            return { kind: 'error', message: errorMessage(e, '') };
          }
        case 'delivery':
          markVerified(plan.stop.id);
          reportDelivery(plan.stop, code, method);
          return { kind: 'verified', stop: plan.stop, isNext: plan.isNext };
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [route, pickedUp, markPickedUp, markVerified, reportDelivery, refresh, currentLoc],
  );

  /** A scan made from the proof-of-delivery form, for that stop only. */
  const checkForStop = useCallback(
    (stop: RouteStop, code: string, method: ScanMethod): StopCheck => {
      if (!stop.parcel?.code || !sameParcelCode(stop.parcel.code, code)) return 'wrong';
      markVerified(stop.id);
      reportDelivery(stop, code, method);
      return 'ok';
    },
    [markVerified, reportDelivery],
  );

  return useMemo(
    () => ({ verified, pickedUp, handleCode, checkForStop }),
    [verified, pickedUp, handleCode, checkForStop],
  );
}
