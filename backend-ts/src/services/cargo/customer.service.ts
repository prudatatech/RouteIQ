/**
 * margixindia — What a customer sees of their goods, and how they confirm receipt
 *
 * The customer app's view of a booking's shipment: where it is, the custody timeline in plain
 * words (redacted: no internal notes, staff or driver names), the proof of delivery, notices for
 * open cases with a revised ETA, and their claims. Confirming receipt stores their rating on the
 * shipment's rating columns and can open a claim for a problem.
 */
import { z } from 'zod';
import { supabase } from '../../core/supabase';
import { HttpError } from '../../core/errors';
import { getProofOfDelivery } from '../pod.service';
import { resolveRef, type Consignment } from './consignment';
import { openExceptionsFor, revisedEta, timelineOf, whereIs } from './custody.service';
import { ownerNotice } from './exception.service';
import { CLAIM_TYPES, claimsFor, createClaim } from './claim.service';

async function bookingShipment(customerId: string, bookingId: string): Promise<{ booking: any; c: Consignment }> {
  const { data: booking, error } = await supabase.from('customer_bookings').select('id, customer_id, shipment_id, status').eq('id', bookingId).maybeSingle();
  if (error) throw new Error(`Failed to read the booking: ${error.message}`);
  if (!booking || booking.customer_id !== customerId) throw new HttpError(404, 'Booking not found');
  if (!booking.shipment_id) throw new HttpError(409, 'Your booking is not confirmed yet, so there is nothing to track.');
  return { booking, c: await resolveRef({ shipment_id: booking.shipment_id }) };
}

export async function customerCargo(customerId: string, bookingId: string) {
  const { booking, c } = await bookingShipment(customerId, bookingId);
  const [where, timeline, open, claims] = await Promise.all([
    whereIs(c, { redacted: true }),
    timelineOf(c, { redacted: true }),
    openExceptionsFor(c),
    claimsFor(c),
  ]);
  const eta = open.length > 0 ? await revisedEta(c) : null;
  const notices = open
    .map((e: any) => {
      const notice = ownerNotice(e.type);
      return notice ? { id: e.id, type: e.type, title: notice.title, message: notice.message, opened_at: e.created_at ?? null, revised_eta: eta } : null;
    })
    .filter(Boolean);
  const delivered = ['delivered', 'partially_delivered', 'returned'].includes(c.rawStatus);
  // A booking split into lots (several drops, or goods split on the way) shows each lot, with its own POD
  const { customerLots } = await import('./lots.service');
  const lots = c.isMaster ? await customerLots(c) : [];
  return {
    booking_id: booking.id,
    shipment_id: c.id,
    tracking_id: c.code,
    where,
    timeline: timeline.events,
    pod: delivered && !c.isMaster ? await getProofOfDelivery(c.id) : null,
    exceptions: notices,
    claims,
    rating: c.row.driver_rating != null ? { rating: c.row.driver_rating } : null,
    lots: lots.map(l => ({
      ref: l.ref, code: l.code, label: l.label, status: l.status, current_holder: l.current_holder, pieces: l.pieces,
      consignee: l.consignee ? { name: l.consignee.name } : null, drop: l.drop, vehicle: l.vehicle, depot: l.depot,
      text: l.text, pod: l.pod,
    })),
  };
}

export const ConfirmReceiptSchema = z.object({
  rating: z.number().int().min(1, 'Rate from 1 to 5').max(5, 'Rate from 1 to 5'),
  comment: z.string().trim().max(500).nullable().optional(),
  issue: z.object({
    type: z.enum(CLAIM_TYPES),
    description: z.string().trim().min(3, 'Describe the problem').max(2000),
    claimed_amount: z.number().min(0).max(1_000_000_000).nullable().optional(),
  }).nullable().optional(),
});

export async function confirmReceipt(customerId: string, bookingId: string, input: unknown) {
  const parsed = ConfirmReceiptSchema.safeParse(input);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0].message);
  const body = parsed.data;
  const { c } = await bookingShipment(customerId, bookingId);
  if (!['delivered', 'partially_delivered'].includes(c.rawStatus)) throw new HttpError(409, 'You can confirm receipt once your goods are delivered.');

  const { data: rated } = await supabase.from('shipments').select('driver_rating').eq('id', c.id).maybeSingle();
  if (rated?.driver_rating != null) throw new HttpError(409, 'This delivery has already been rated.');

  // The vehicle and driver that delivered it, from the delivery on record
  const { data: events } = await supabase.from('cargo_custody_events').select('kind, from_vehicle_id, recorded_at').eq('shipment_id', c.id).in('kind', ['delivery', 'partial_delivery']);
  const last = ((events ?? []) as any[]).sort((a, b) => String(b.recorded_at).localeCompare(String(a.recorded_at)))[0];
  const vehicleId: string | null = last?.from_vehicle_id ?? null;
  let driverId: string | null = null;
  if (vehicleId) driverId = (await supabase.from('vehicles').select('driver_id').eq('id', vehicleId).maybeSingle()).data?.driver_id ?? null;

  const { data: saved } = await supabase
    .from('shipments')
    .update({
      driver_rating: body.rating,
      driver_rating_note: body.comment ?? null,
      driver_rated_at: new Date().toISOString(),
      // Customers are not staff users, so the rater is left empty: a null rater marks a customer rating
      driver_rated_by: null,
      rated_vehicle_id: vehicleId,
      rated_driver_id: driverId,
    })
    .eq('id', c.id)
    .is('driver_rating', null)
    .select('id')
    .maybeSingle();
  if (!saved) throw new HttpError(409, 'This delivery has already been rated.');

  let claim = null;
  if (body.issue) {
    claim = await createClaim(
      { ref: { shipment_id: c.id }, claim_type: body.issue.type, claimed_amount: body.issue.claimed_amount ?? null, notes: body.issue.description },
      { id: customerId, role: 'customer' },
    );
  }
  return { rating: body.rating, comment: body.comment ?? null, claim };
}
