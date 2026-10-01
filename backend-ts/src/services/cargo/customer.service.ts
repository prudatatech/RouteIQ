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
import { CLAIM_TYPES, claimsForBooking, createClaim } from './claim.service';
import { notifyDeliveryRated } from './notify';

/** The vehicle and driver that delivered a shipment, from the delivery on record, as the rating columns. */
async function deliveredBy(shipmentId: string): Promise<{ driverId: string | null; columns: { rated_vehicle_id: string | null; rated_driver_id: string | null } }> {
  const { data: events } = await supabase.from('cargo_custody_events').select('kind, from_vehicle_id, recorded_at').eq('shipment_id', shipmentId).in('kind', ['delivery', 'partial_delivery']);
  const last = ((events ?? []) as any[]).sort((a, b) => String(b.recorded_at).localeCompare(String(a.recorded_at)))[0];
  const vehicleId: string | null = last?.from_vehicle_id ?? null;
  const driverId: string | null = vehicleId ? (await supabase.from('vehicles').select('driver_id').eq('id', vehicleId).maybeSingle()).data?.driver_id ?? null : null;
  return { driverId, columns: { rated_vehicle_id: vehicleId, rated_driver_id: driverId } };
}

async function bookingShipment(customerId: string, bookingId: string): Promise<{ booking: any; c: Consignment }> {
  const { data: booking, error } = await supabase.from('customer_bookings').select('id, customer_id, shipment_id, status').eq('id', bookingId).maybeSingle();
  if (error) throw new Error(`Failed to read the booking: ${error.message}`);
  if (!booking || booking.customer_id !== customerId) throw new HttpError(404, 'Booking not found');
  if (!booking.shipment_id) throw new HttpError(409, 'Your booking is not confirmed yet, so there is nothing to track.');
  return { booking, c: await resolveRef({ shipment_id: booking.shipment_id }) };
}

export async function customerCargo(customerId: string, bookingId: string) {
  const { booking, c } = await bookingShipment(customerId, bookingId);
  const { customerLots, lotsOf } = await import('./lots.service');
  // The claims of the master and of every lot (cancelled ones too), each tagged with its lot code
  const allLots = c.isMaster ? await lotsOf(c.kind, c.id) : [];
  const [where, timeline, open, claims] = await Promise.all([
    whereIs(c, { redacted: true }),
    timelineOf(c, { redacted: true }),
    openExceptionsFor(c),
    claimsForBooking(c, allLots),
  ]);
  const eta = open.length > 0 ? await revisedEta(c) : null;
  const notices = open
    .map((e: any) => {
      const notice = ownerNotice(e.type);
      return notice ? { id: e.id, type: e.type, title: notice.title, message: notice.message, opened_at: e.created_at ?? null, revised_eta: eta, lot_code: e.lot_code ?? null } : null;
    })
    .filter(Boolean);
  const delivered = ['delivered', 'partially_delivered', 'returned'].includes(c.rawStatus);
  // A booking split into lots (several drops, or goods split on the way) shows each lot, with its own POD
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
    rating: c.row.driver_rating != null ? { rating: Number(c.row.driver_rating), comment: c.row.driver_rating_note ?? null, rated_at: c.row.driver_rated_at ?? null } : null,
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

  const ratedAt = new Date().toISOString();
  const ratedFields = { driver_rating: body.rating, driver_rating_note: body.comment ?? null, driver_rated_at: ratedAt, driver_rated_by: null as string | null };

  // A booking split into lots (several drops) is rated on the booking, and each delivered lot also carries the rating
  // with the truck and driver that delivered it, so the driver hears of it and their average counts it.
  const { lotsOf } = await import('./lots.service');
  const lots = c.isMaster ? (await lotsOf(c.kind, c.id)).filter(l => ['delivered', 'partially_delivered'].includes(l.rawStatus)) : [];
  if (c.isMaster && lots.length === 0) throw new HttpError(409, 'You can confirm receipt once your goods are delivered.');

  // Customers are not staff users, so the rater is left empty: a null rater marks a customer rating
  const { data: saved } = await supabase
    .from('shipments')
    .update(c.isMaster ? ratedFields : { ...ratedFields, ...(await deliveredBy(c.id)).columns })
    .eq('id', c.id)
    .is('driver_rating', null)
    .select('id')
    .maybeSingle();
  if (!saved) throw new HttpError(409, 'This delivery has already been rated.');

  if (!c.isMaster) {
    await notifyDeliveryRated(c.id, body.rating, { driverId: (await deliveredBy(c.id)).driverId, byCustomer: true, comment: body.comment ?? null });
  } else {
    await notifyDeliveryRated(c.id, body.rating, { driverId: null, byCustomer: true, comment: body.comment ?? null });
    for (const lot of lots) {
      const by = await deliveredBy(lot.id);
      await supabase.from('shipments').update({ ...ratedFields, ...by.columns }).eq('id', lot.id).is('driver_rating', null);
      await notifyDeliveryRated(lot.id, body.rating, { driverId: by.driverId, byCustomer: true, comment: body.comment ?? null, notifyStaff: false });
    }
  }

  let claim = null;
  if (body.issue) {
    claim = await createClaim(
      { ref: { shipment_id: c.id }, claim_type: body.issue.type, claimed_amount: body.issue.claimed_amount ?? null, notes: body.issue.description },
      { id: customerId, role: 'customer' },
    );
  }
  return { rating: body.rating, comment: body.comment ?? null, claim };
}
