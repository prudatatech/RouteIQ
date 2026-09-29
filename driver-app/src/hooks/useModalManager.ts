/**
 * Only one dialog is ever on screen. The driver opens at most one dialog at a
 * time (opening another replaces it); a dispatch call or a new assignment
 * takes the screen over it and the driver's dialog comes back afterwards.
 * An open SOS is never covered.
 */
import { useCallback, useMemo, useState } from 'react';
import type { Invoice } from '../components/modals/InvoiceDialog';
import type { RouteStop } from '../types/route';

export type DriverModal =
  | { kind: 'sos' }
  | { kind: 'sosCountdown' }
  | { kind: 'pod'; stop: RouteStop }
  | { kind: 'capacity' }
  | { kind: 'returnTrip' }
  | { kind: 'moreActions' }
  | { kind: 'invoice'; invoice: Invoice };

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
