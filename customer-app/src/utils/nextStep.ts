/**
 * The one next step of a booking, shown on the bookings list: what the customer is waiting for, or
 * what is left for them to do. Pure (no React, no network, no formatting), so it is easy to test:
 * `nextStepText` in nextStepText.ts turns a step into the sentence.
 *
 * Order of importance: a delivered booking asks to be confirmed and rated, then a problem on the
 * way is told in plain words with the new arrival time, then the live ETA, and last the unpaid
 * invoice. Cancelled bookings have none.
 */
import type { Booking } from '../services/api';

export type NextStepKind =
  | 'waiting_accept'
  | 'truck_being_assigned'
  | 'truck_assigned'
  | 'on_the_way'
  | 'eta'
  | 'problem'
  | 'problem_failed'
  | 'confirm_and_rate'
  | 'invoice_due'
  | 'invoice_overdue';

export type NextStepTone = 'info' | 'accent' | 'warning' | 'danger' | 'success';

export interface NextStep {
  kind: NextStepKind;
  tone: NextStepTone;
  /** `eta`: minutes until arrival. */
  minutes?: number;
  /** `problem`: the server's plain message, and the new arrival time when there is one. */
  message?: string;
  revisedEta?: string | null;
  /** `invoice_due` and `invoice_overdue`: the due date. */
  dueDate?: string | null;
}

export interface NextStepInput {
  booking: Pick<Booking, 'status' | 'shipment_status'> & { rated?: boolean | null };
  /** Minutes to arrival from live tracking, when the truck is moving. */
  etaMinutes?: number | null;
  /** An open problem on the goods, in the server's plain words. */
  problem?: { message: string; revisedEta?: string | null } | null;
  /** The booking's invoice when it is issued and not yet paid. */
  unpaidInvoice?: { dueDate: string | null; overdue: boolean } | null;
}

const MOVING = ['picked_up', 'in_transit', 'out_for_delivery', 'at_hub', 'on_hold', 'returning'];

/** Goods that have reached the receiver, in full or in part. */
const delivered = (b: NextStepInput['booking']) =>
  b.status === 'delivered' || b.shipment_status === 'delivered' || b.shipment_status === 'partially_delivered';

export function nextStep({ booking, etaMinutes, problem, unpaidInvoice }: NextStepInput): NextStep | null {
  if (booking.status === 'cancelled') return null;

  if (delivered(booking)) {
    if (booking.rated !== true) return { kind: 'confirm_and_rate', tone: 'accent' };
    if (unpaidInvoice) {
      return unpaidInvoice.overdue
        ? { kind: 'invoice_overdue', tone: 'danger', dueDate: unpaidInvoice.dueDate }
        : { kind: 'invoice_due', tone: 'info', dueDate: unpaidInvoice.dueDate };
    }
    return null;
  }

  if (problem) return { kind: 'problem', tone: 'warning', message: problem.message, revisedEta: problem.revisedEta ?? null };
  if (booking.shipment_status === 'exception') return { kind: 'problem_failed', tone: 'danger' };

  const moving = booking.status === 'in_transit' || (!!booking.shipment_status && MOVING.includes(booking.shipment_status));
  if (moving) {
    return etaMinutes != null && etaMinutes >= 0
      ? { kind: 'eta', tone: 'accent', minutes: Math.round(etaMinutes) }
      : { kind: 'on_the_way', tone: 'accent' };
  }
  if (booking.status === 'assigned') return { kind: 'truck_assigned', tone: 'info' };
  if (booking.status === 'confirmed') return { kind: 'truck_being_assigned', tone: 'info' };
  if (booking.status === 'requested') return { kind: 'waiting_accept', tone: 'info' };
  return null;
}

/** Which bookings still need live data (the ETA, or the open problem) that the list does not carry. */
export function needsLiveDetail(booking: Pick<Booking, 'status' | 'shipment_status'>): boolean {
  if (booking.status === 'cancelled' || delivered(booking)) return false;
  return booking.status === 'in_transit' || (!!booking.shipment_status && [...MOVING, 'exception'].includes(booking.shipment_status));
}

/** A delivered booking the customer has not confirmed and rated yet. */
export const awaitsRating = (booking: NextStepInput['booking']): boolean => booking.status !== 'cancelled' && delivered(booking) && booking.rated !== true;
