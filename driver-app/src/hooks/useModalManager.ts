/**
 * Only one dialog is ever on screen. The driver opens at most one dialog at a
 * time (opening another replaces it); a dispatch call or a new assignment
 * takes the screen over it and the driver's dialog comes back afterwards.
 * An open SOS is never covered.
 */
import { useCallback, useMemo, useState } from 'react';
import type { RouteStop } from '../types/route';
import type { DropLot } from '../utils/dropLots';
import type { VehicleTransfer } from './useCargo';

export type DriverModal =
  | { kind: 'sos' }
  | { kind: 'sosCountdown' }
  /**
   * The delivery sheet, opened on "delivered" (pod) or on "not delivered" (issue), with the lots to
   * hand over at that drop (fixed when it opens, so recording one lot does not reshuffle the list).
   */
  | { kind: 'pod'; stop: RouteStop; lots?: DropLot[] }
  | { kind: 'issue'; stop: RouteStop; lots?: DropLot[] }
  | { kind: 'pickup' }
  | { kind: 'cargoCheck' }
  | { kind: 'handover'; transfer: VehicleTransfer }
  | { kind: 'hubDrop' }
  | { kind: 'returnPickup' }
  | { kind: 'capacity' }
  | { kind: 'returnTrip' }
  | { kind: 'fuel' }
  | { kind: 'moreActions' }
  | { kind: 'notifications' };

export type SystemModal = { kind: 'call' } | { kind: 'assignment' };

export type ActiveModal = DriverModal | SystemModal;

interface SystemRequests {
  call: boolean;
  assignment: boolean;
}

/** Pure priority rule, kept separate so it is easy to reason about. */
export function resolveActiveModal(driver: DriverModal | null, system: SystemRequests): ActiveModal | null {
  if (driver?.kind === 'sos' || driver?.kind === 'sosCountdown') return driver;
  if (system.call) return { kind: 'call' };
  if (system.assignment) return { kind: 'assignment' };
  return driver;
}

export function useModalManager(system: SystemRequests) {
  const [driverModal, setDriverModal] = useState<DriverModal | null>(null);

  const active = useMemo(
    () => resolveActiveModal(driverModal, system),
    // Only the two flags matter, not the object identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [driverModal, system.call, system.assignment],
  );

  const open = useCallback((modal: DriverModal) => setDriverModal(modal), []);
  const close = useCallback(() => setDriverModal(null), []);

  return { active, open, close };
}
