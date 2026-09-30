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
import { normalizeParcelCode, planScan, sameParcelCode } from '../utils/parcel';
import { manifestRefOfStop, type ConsignmentRef } from '../services/cargo';
import type { ScanMethod } from '../components/scan/ParcelScanner';

const STORE_KEY = 'parcel_scan_state';
const MAX_KEPT = 200;

interface Stored {
  verified: string[];
  pickedUp: string[];
}

export type ScanOutcome =
  | {
      /** A parcel waiting for pickup on this route; the pickup details record it. */
      kind: 'picked_up';
      code: string;
      /** The vendor load, or the tracking ID (the server takes either). */
      ref: ConsignmentRef;
    }
  | { kind: 'verified'; stop: RouteStop; isNext: boolean }
  | { kind: 'already_done'; stop: RouteStop }
  | { kind: 'not_on_route' }
  | { kind: 'error'; message: string };

export type StopCheck = 'ok' | 'wrong';

interface Options {
  route: DriverRoute | undefined;
  currentLoc: LatLng | null;
}

export function useParcelScan({ route, currentLoc }: Options) {
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
          // Checked against the route on the phone only. The pickup itself is recorded by the
          // pickup details (a `pickup` custody event with the count, condition, photos and
          // signature): the server's pickup scan would already record it with the booked count,
          // and a second pickup is refused.
          return { kind: 'picked_up', code: plan.code, ref: manifestRefOfStop(plan.stop?.id) ?? plan.code };
        case 'delivery':
          markVerified(plan.stop.id);
          reportDelivery(plan.stop, code, method);
          return { kind: 'verified', stop: plan.stop, isNext: plan.isNext };
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [route, pickedUp, markVerified, reportDelivery, currentLoc],
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

  /** Parcels whose pickup was saved (or kept to send): a new scan of them is no longer a pickup. */
  const markPickedUpMany = useCallback((codes: string[]) => codes.forEach(markPickedUp), [markPickedUp]);

  return useMemo(
    () => ({ verified, pickedUp, handleCode, checkForStop, markPickedUp: markPickedUpMany }),
    [verified, pickedUp, handleCode, checkForStop, markPickedUpMany],
  );
}
