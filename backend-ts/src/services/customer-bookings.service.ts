/**
 * margixindia — Customer bookings
 *
 * A customer books a shipment, and staff confirm it (which creates a real
 * shipment through ShipmentService, so dispatch works as for any other load),
 * assign a vehicle, or cancel it. The customer is told about every change and
 * can cancel until the load is picked up. Prices come from customer-booking.service.
 */
import { HttpError } from '../core/errors';
import { supabase } from '../core/supabase';
import { indianDateKey } from '../core/istDate';
import { ShipmentCreateSchema } from '../schemas';
import { computeQuote, isTodayOrLater, type QuoteInput } from './customer-booking.service';
import { selectIn } from './finance.service';
import { notificationService } from './notification.service';
import { ShipmentService, type LogActor } from './shipment.service';

export const BOOKING_STATUSES = ['requested', 'confirmed', 'assigned', 'in_transit', 'delivered', 'cancelled'] as const;
export type BookingStatus = typeof BOOKING_STATUSES[number];

/** A booking can be cancelled until the load is picked up. */
const CANCELLABLE: BookingStatus[] = ['requested', 'confirmed', 'assigned'];

/** How far ahead a pickup can be booked. */
export const MAX_DAYS_AHEAD = 90;

export interface BookingInput extends QuoteInput {
  pickup_name: string;
  pickup_address: string;
  drop_name: string;
  drop_address: string;
}

const BOOKING_COLUMNS =
  'id, customer_id, pickup_name, pickup_address, pickup_lat, pickup_lng, drop_name, drop_address, drop_lat, drop_lng, weight_kg, load_type, vehicle_type, pickup_date, quoted_price, quote_details, status, shipment_id, tracking_id, vehicle_id, cancelled_by, cancel_reason, created_at, updated_at';

/** Latest pickup date allowed, as YYYY-MM-DD in India. */
export function lastBookableDate(): string {
  return indianDateKey(new Date(Date.now() + MAX_DAYS_AHEAD * 24 * 60 * 60 * 1000));
}

/** Tells the customer about a change. A failed notification never blocks the change itself. */
async function notifyCustomer(booking: { id: string; customer_id: string }, title: string, body: string, status: BookingStatus) {
  try {
    await notificationService.sendNotification(booking.customer_id, title, body, 'booking', { booking_id: booking.id, status });
  } catch (e) {
    console.error('Booking notification failed:', e);
  }
}

async function notifyStaff(title: string, body: string, bookingId: string) {
  try {
    await notificationService.notifyStaff(title, body, 'customer_booking', { booking_id: bookingId });
  } catch (e) {
    console.error('Staff notification failed:', e);
  }
}

async function getBookingRow(id: string): Promise<any> {
  const { data, error } = await supabase.from('customer_bookings').select(BOOKING_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw new Error(`Failed to read booking: ${error.message}`);
  if (!data) throw new HttpError(404, 'Booking not found');
  return data;
}

/** Moves a booking out of one of the `from` statuses; null when someone else changed it first. */
async function transition(id: string, from: readonly BookingStatus[], patch: Record<string, unknown>): Promise<any | null> {
  const { data, error } = await supabase
    .from('customer_bookings')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .in('status', [...from])
    .select(BOOKING_COLUMNS);
  if (error) throw new Error(`Failed to update booking: ${error.message}`);
  return data?.[0] ?? null;
}

export async function createBooking(customerId: string, input: BookingInput) {
  if (!isTodayOrLater(input.date)) throw new HttpError(400, 'Pickup date cannot be in the past');
  if (input.date > lastBookableDate()) throw new HttpError(400, `Pickup date can be at most ${MAX_DAYS_AHEAD} days from today`);

  // The price is always worked out here; a price sent by the app is never trusted.
  const quote = await computeQuote(input);
  const { data, error } = await supabase
    .from('customer_bookings')
    .insert({
      customer_id: customerId,
      pickup_name: input.pickup_name,
      pickup_address: input.pickup_address,
      pickup_lat: input.pickup_lat,
      pickup_lng: input.pickup_lng,
      drop_name: input.drop_name,
      drop_address: input.drop_address,
      drop_lat: input.drop_lat,
      drop_lng: input.drop_lng,
      weight_kg: input.weight_kg,
      load_type: input.load_type,
      vehicle_type: input.vehicle_type || null,
      pickup_date: input.date,
      quoted_price: quote.available ? quote.suggested : null,
      quote_details: { low: quote.low, suggested: quote.suggested, high: quote.high, distance_km: quote.distance_km, factors: quote.factors, source: quote.source },
      status: 'requested',
    })
    .select(BOOKING_COLUMNS)
    .single();
  if (error || !data) throw new Error(`Failed to create booking: ${error?.message}`);

  await notifyCustomer(data, 'Booking received', `We have your request from ${input.pickup_name} to ${input.drop_name}. Our team will confirm it soon.`, 'requested');
  await notifyStaff('New customer booking', `${input.pickup_name} to ${input.drop_name}, ${input.weight_kg} kg, pickup ${input.date}`, data.id);
  return data;
}

export async function listCustomerBookings(customerId: string) {
  const { data, error } = await supabase
    .from('customer_bookings')
    .select(BOOKING_COLUMNS)
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw new Error(`Failed to list bookings: ${error.message}`);
  return data ?? [];
}

/** One of the customer's own bookings, with live tracking once a shipment exists. */
export async function getCustomerBooking(customerId: string, id: string) {
  const booking = await getBookingRow(id);
  if (booking.customer_id !== customerId) throw new HttpError(404, 'Booking not found');
  const tracking = booking.tracking_id ? await ShipmentService.getPublicTracking(booking.tracking_id) : null;
  return { booking, tracking };
}

/** Staff list, newest first, with who booked. */
export async function listAllBookings(status?: string) {
  let query = supabase.from('customer_bookings').select(BOOKING_COLUMNS).order('created_at', { ascending: false }).limit(200);
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) throw new Error(`Failed to list bookings: ${error.message}`);
  const rows = data ?? [];
  const customers = await selectIn<{ id: string; full_name: string | null; phone: string | null; company_name: string | null }>(
    'customers', 'id', rows.map((r: any) => r.customer_id), 'id, full_name, phone, company_name',
  );
  const byId = new Map(customers.map((c) => [c.id, c]));
  return rows.map((r: any) => {
    const c = byId.get(r.customer_id);
    return { ...r, customer: c ? { name: c.full_name, phone: c.phone, company: c.company_name } : null };
  });
}

/** Staff accept a booking: a real shipment is created so it can be dispatched like any other load. */
export async function confirmBooking(id: string, actor: LogActor) {
  const claimed = await transition(id, ['requested'], { status: 'confirmed' });
  if (!claimed) {
    const current = await getBookingRow(id);
    throw new HttpError(409, `This booking is already ${current.status}`);
  }
  try {
    const shipment = await ShipmentService.createShipment(
      ShipmentCreateSchema.parse({
        origin_name: claimed.pickup_name,
        origin_address: claimed.pickup_address,
        origin_lat: claimed.pickup_lat,
        origin_lng: claimed.pickup_lng,
        dest_name: claimed.drop_name,
        dest_address: claimed.drop_address,
        dest_lat: claimed.drop_lat,
        dest_lng: claimed.drop_lng,
        total_items: 1,
        total_weight_kg: Number(claimed.weight_kg),
        load_type: claimed.load_type === 'part' ? 'partial' : 'full',
        metadata: { source: 'customer_app', customer_booking_id: claimed.id, pickup_date: claimed.pickup_date },
      }),
      actor,
    );
    if (claimed.vehicle_type) {
      await supabase.from('shipments').update({ required_vehicle_type: claimed.vehicle_type }).eq('id', shipment.id);
    }
    const { data, error } = await supabase
      .from('customer_bookings')
      .update({ shipment_id: shipment.id, tracking_id: shipment.tracking_id, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select(BOOKING_COLUMNS)
      .single();
    if (error || !data) throw new Error(`Failed to link shipment: ${error?.message}`);
    await notifyCustomer(data, 'Booking confirmed', `Your booking is confirmed. Tracking ID ${shipment.tracking_id}. Pickup on ${data.pickup_date}.`, 'confirmed');
    return data;
  } catch (e) {
    // Put the booking back so staff can try again.
    await transition(id, ['confirmed'], { status: 'requested', shipment_id: null, tracking_id: null });
    throw e;
  }
}

/** Staff put a vehicle on a confirmed booking's shipment. */
export async function assignBooking(id: string, vehicleId: string, actor: LogActor) {
  const booking = await getBookingRow(id);
  if (!['confirmed', 'assigned'].includes(booking.status) || !booking.shipment_id) {
    throw new HttpError(409, 'Confirm the booking before assigning a vehicle');
  }
  const { data: vehicle, error } = await supabase.from('vehicles').select('id, plate_number').eq('id', vehicleId).maybeSingle();
  if (error) throw new Error(`Failed to read vehicle: ${error.message}`);
  if (!vehicle) throw new HttpError(404, 'Vehicle not found');

  await ShipmentService.assignDriver(booking.shipment_id, vehicleId, actor);
  const updated = await transition(id, ['confirmed', 'assigned'], { status: 'assigned', vehicle_id: vehicleId });
  if (!updated) throw new HttpError(409, 'This booking changed while you were assigning it. Reload and try again.');
  await notifyCustomer(updated, 'Vehicle assigned', `A vehicle has been assigned to your booking${booking.tracking_id ? ` (${booking.tracking_id})` : ''}.`, 'assigned');
  return updated;
}

/** Cancel before pickup, by the customer (own booking only) or by staff (with a reason). */
export async function cancelBooking(id: string, by: { role: 'customer' | 'staff'; userId: string; actorRole: string }, reason: string | null) {
  const booking = await getBookingRow(id);
  if (by.role === 'customer' && booking.customer_id !== by.userId) throw new HttpError(404, 'Booking not found');
  if (!CANCELLABLE.includes(booking.status)) {
    throw new HttpError(409, booking.status === 'cancelled' ? 'This booking is already cancelled' : 'This booking has been picked up and can no longer be cancelled');
  }

  const updated = await transition(id, CANCELLABLE, { status: 'cancelled', cancelled_by: by.role, cancel_reason: reason });
  if (!updated) throw new HttpError(409, 'This booking changed just now. Reload and try again.');

  if (booking.shipment_id) {
    // The booking is already cancelled, so the shipment hook finds nothing left to change.
    await ShipmentService.updateShipmentStatus(
      booking.shipment_id, 'cancelled', null, null, null, null,
      { id: by.userId, role: by.actorRole },
      reason ? { reason } : undefined,
    );
  }
  if (by.role === 'staff') {
    await notifyCustomer(updated, 'Booking cancelled', `Your booking was cancelled${reason ? `: ${reason}` : '.'}`, 'cancelled');
  } else {
    await notifyStaff('Customer cancelled a booking', `${booking.pickup_name} to ${booking.drop_name}${booking.tracking_id ? `, ${booking.tracking_id}` : ''}`, id);
    await notifyCustomer(updated, 'Booking cancelled', 'Your booking has been cancelled.', 'cancelled');
  }
  return updated;
}

const SHIPMENT_TO_BOOKING: Record<string, BookingStatus> = {
  picked_up: 'in_transit',
  in_transit: 'in_transit',
  delivered: 'delivered',
  cancelled: 'cancelled',
};

const PROGRESS_TEXT: Record<string, [string, string]> = {
  in_transit: ['Your shipment is on its way', 'Your load has been picked up. You can follow it live in the app.'],
  delivered: ['Your shipment was delivered', 'Your load has been delivered. Thank you for booking with MargixIndia.'],
  cancelled: ['Booking cancelled', 'Your booking was cancelled by our team.'],
};

/** Keeps a booking in step with its shipment (called whenever a shipment status changes). */
export async function onShipmentStatus(shipmentId: string, shipmentStatus: string): Promise<void> {
  const next = SHIPMENT_TO_BOOKING[shipmentStatus];
  if (!next) return;
  const { data: booking, error } = await supabase.from('customer_bookings').select(BOOKING_COLUMNS).eq('shipment_id', shipmentId).maybeSingle();
  if (error || !booking || booking.status === next) return;
  const from = BOOKING_STATUSES.filter((s) => s !== 'delivered' && s !== 'cancelled' && s !== next);
  const patch: Record<string, unknown> = { status: next };
  if (next === 'cancelled') patch.cancelled_by = 'staff';
  const updated = await transition(booking.id, from, patch);
  if (!updated) return;
  await notifyCustomer(updated, PROGRESS_TEXT[next][0], PROGRESS_TEXT[next][1], next);
}
