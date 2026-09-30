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
  const quote = await computeQuote(input, { userId: customerId });
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

  await notifyCustomer(data, 'Booking received', `We have your booking from ${input.pickup_name} to ${input.drop_name}. Our team will confirm it soon.`, 'requested');
  await notifyStaff('New customer booking', `${input.pickup_name} to ${input.drop_name}, ${input.weight_kg} kg, pickup ${input.date}`, data.id);
  return data;
}

/**
 * Adds `shipment_status` to booking rows: the status of the linked shipment. A failed delivery
 * (exception) has no booking status of its own, so the apps read it from here.
 */
async function withShipmentStatus<T extends { shipment_id?: string | null }>(rows: T[]): Promise<(T & { shipment_status: string | null })[]> {
  const ids = Array.from(new Set(rows.map(r => r.shipment_id).filter((id): id is string => !!id)));
  const shipments = await selectIn<{ id: string; status: string }>('shipments', 'id', ids, 'id, status');
  const byId = new Map(shipments.map(sh => [sh.id, sh.status]));
  return rows.map(r => ({ ...r, shipment_status: r.shipment_id ? byId.get(r.shipment_id) ?? null : null }));
}

export async function listCustomerBookings(customerId: string) {
  const { data, error } = await supabase
    .from('customer_bookings')
    .select(BOOKING_COLUMNS)
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw new Error(`Failed to list bookings: ${error.message}`);
  return withShipmentStatus(data ?? []);
}

/** One of the customer's own bookings, with live tracking once a shipment exists. */
export async function getCustomerBooking(customerId: string, id: string) {
  const booking = await getBookingRow(id);
  if (booking.customer_id !== customerId) throw new HttpError(404, 'Booking not found');
  const tracking = booking.tracking_id ? await ShipmentService.getPublicTracking(booking.tracking_id) : null;
  return { booking: { ...booking, shipment_status: tracking?.status ?? null }, tracking };
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
  const withStatus = await withShipmentStatus(rows);
  return withStatus.map((r: any) => {
    const c = byId.get(r.customer_id);
    return { ...r, customer: c ? { name: c.full_name, phone: c.phone, company: c.company_name } : null };
  });
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The tracking id a booking's shipment always gets, so confirming twice finds the same shipment. */
export function bookingTrackingId(bookingId: string): string {
  return `RTX-${bookingId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

/** The live shipment already made for a booking (left over by an earlier confirm that failed part-way), if any. */
async function findBookingShipment(bookingId: string): Promise<{ id: string; status: string; taken: boolean } | null> {
  const { data, error } = await supabase.from('shipments').select('id, status, metadata').eq('tracking_id', bookingTrackingId(bookingId)).maybeSingle();
  if (error) throw new Error(`Failed to look for the booking's shipment: ${error.message}`);
  if (!data) return null;
  const ours = data.metadata?.customer_booking_id === bookingId;
  return { id: data.id, status: data.status, taken: !ours || data.status === 'cancelled' };
}

/**
 * Staff accept a booking: a real shipment is created so it can be dispatched like any other load.
 * The freight charge is the price staff entered, or else the quote the customer saw, so the
 * delivery can be invoiced. Safe to repeat: a shipment left by a failed attempt is reused.
 */
export async function confirmBooking(id: string, actor: LogActor, options: { price?: number | null } = {}) {
  let override: number | null = null;
  if (options.price !== undefined && options.price !== null) {
    const price = Number(options.price);
    if (!Number.isFinite(price) || price < 0 || price > 99_999_999.99) throw new HttpError(400, 'The price must be zero or more');
    override = round2(price);
  }

  const claimed = await transition(id, ['requested'], { status: 'confirmed' });
  if (!claimed) {
    const current = await getBookingRow(id);
    throw new HttpError(409, `This booking is already ${current.status}`);
  }
  try {
    const quoted = claimed.quoted_price != null ? Number(claimed.quoted_price) : null;
    const freight = override ?? (quoted != null && Number.isFinite(quoted) ? quoted : null);

    let shipmentId: string | null = null;
    let trackingId: string | null = null;
    const left = await findBookingShipment(claimed.id);
    if (left && !left.taken) {
      const reused = await ShipmentService.getShipment(left.id);
      if (reused) {
        shipmentId = reused.id;
        trackingId = reused.tracking_id;
        await supabase.from('shipments').update({ freight_charge: freight }).eq('id', reused.id);
      }
    }
    if (!shipmentId) {
      const shipment = await ShipmentService.createShipment(
        ShipmentCreateSchema.parse({
          // A fixed id per booking: a repeat after a partial failure finds this shipment instead of making another
          tracking_id: left ? undefined : bookingTrackingId(claimed.id),
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
          freight_charge: freight,
          metadata: {
            source: 'customer_app',
            customer_booking_id: claimed.id,
            pickup_date: claimed.pickup_date,
            // The shipment's own dispatch date, as the manifest and the shipments list read it
            dispatch_date: claimed.pickup_date,
          },
        }),
        actor,
      );
      shipmentId = shipment.id;
      trackingId = shipment.tracking_id;
      if (claimed.vehicle_type) {
        await supabase.from('shipments').update({ required_vehicle_type: claimed.vehicle_type }).eq('id', shipment.id);
      }
    }
    const { data, error } = await supabase
      .from('customer_bookings')
      .update({ shipment_id: shipmentId, tracking_id: trackingId, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select(BOOKING_COLUMNS)
      .single();
    if (error || !data) throw new Error(`Failed to link shipment: ${error?.message}`);
    await notifyCustomer(data, 'Booking confirmed', `Your booking is confirmed. Tracking ID ${trackingId}. Pickup on ${data.pickup_date}.`, 'confirmed');
    return data;
  } catch (e) {
    // Put the booking back so staff can try again; the shipment made so far is reused then.
    await transition(id, ['confirmed'], { status: 'requested', shipment_id: null, tracking_id: null });
    throw e;
  }
}

/** Staff put a vehicle on a confirmed booking's shipment. The shipment's own assign rules apply (vehicle in service, type, capacity). */
export async function assignBooking(id: string, vehicleId: string, actor: LogActor) {
  const booking = await getBookingRow(id);
  if (!booking.shipment_id || !['confirmed', 'assigned', 'in_transit'].includes(booking.status)) {
    throw new HttpError(409, 'Confirm the booking before assigning a vehicle');
  }
  if (booking.status === 'in_transit') {
    // Only a failed delivery can be given a vehicle again once the load has moved
    const { data: shipment } = await supabase.from('shipments').select('status').eq('id', booking.shipment_id).maybeSingle();
    if (shipment?.status !== 'exception') throw new HttpError(409, 'This booking is on its way and cannot be given another vehicle');
  }
  const { data: vehicle, error } = await supabase.from('vehicles').select('id').eq('id', vehicleId).maybeSingle();
  if (error) throw new Error(`Failed to read vehicle: ${error.message}`);
  if (!vehicle) throw new HttpError(404, 'Vehicle not found');

  // Assigning marks the shipment assigned, which moves this booking and tells the customer
  await ShipmentService.assignDriver(booking.shipment_id, vehicleId, actor);
  const updated = await getBookingRow(id);
  if (updated.status !== 'assigned') throw new HttpError(409, 'This booking changed while you were assigning it. Reload and try again.');
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

  // The booking is already cancelled, so the shipment hook finds nothing left to change.
  const shipmentId = booking.shipment_id ?? (await findBookingShipment(id))?.id ?? null;
  if (shipmentId) {
    try {
      await ShipmentService.updateShipmentStatus(
        shipmentId, 'cancelled', null, null, null, null,
        { id: by.userId, role: by.actorRole },
        reason ? { reason } : undefined,
      );
    } catch (e) {
      // The shipment refused (it has moved on): the booking goes back as it was, so nothing is half-cancelled.
      await transition(id, ['cancelled'], { status: booking.status, cancelled_by: null, cancel_reason: null });
      if (e instanceof HttpError && e.status === 409) {
        throw new HttpError(409, 'This shipment has already been picked up, so the booking can no longer be cancelled.');
      }
      throw e;
    }
  }
  if (by.role === 'staff') {
    await notifyCustomer(updated, 'Booking cancelled', `Your booking was cancelled${reason ? `: ${reason}` : '.'}`, 'cancelled');
  } else {
    await notifyStaff('Customer cancelled a booking', `${booking.pickup_name} to ${booking.drop_name}${booking.tracking_id ? `, ${booking.tracking_id}` : ''}`, id);
    await notifyCustomer(updated, 'Booking cancelled', 'Your booking has been cancelled.', 'cancelled');
  }
  return updated;
}

/**
 * How a shipment's status shows on its booking. A failed delivery (`exception`) has no booking status
 * (the table does not allow a new one): the booking keeps its status, the customer is told, and
 * the apps show "Delivery attempt failed" from the booking's `shipment_status`.
 */
const SHIPMENT_TO_BOOKING: Record<string, BookingStatus> = {
  created: 'confirmed',
  assigned: 'assigned',
  picked_up: 'in_transit',
  in_transit: 'in_transit',
  // Still on its way: out for delivery, at a hub, or coming back. Holds, cases, partial
  // deliveries, returns and losses keep the booking's status; the cargo notifications explain them.
  out_for_delivery: 'in_transit',
  at_hub: 'in_transit',
  returning: 'in_transit',
  delivered: 'delivered',
  cancelled: 'cancelled',
};

/** Booking statuses each shipment status may move a booking out of. */
const MOVES_FROM: Record<string, BookingStatus[]> = {
  confirmed: ['assigned'], // the vehicle was taken off (its route was cancelled)
  assigned: ['confirmed', 'assigned', 'in_transit'], // assigned, or assigned again after a failed delivery
};

const PROGRESS_TEXT: Record<string, [string, string]> = {
  confirmed: ['Finding you another vehicle', 'The vehicle for your booking is no longer available. Our team is arranging another one.'],
  assigned: ['Vehicle assigned', 'A vehicle has been assigned to your booking.'],
  in_transit: ['Your shipment is on its way', 'Your shipment has been picked up. You can follow it live in the app.'],
  delivered: ['Your shipment was delivered', 'Your shipment has been delivered. Thank you for booking with MargixIndia.'],
  cancelled: ['Booking cancelled', 'Your booking was cancelled by our team.'],
};

/** Keeps a booking in step with its shipment (called whenever a shipment status changes). */
export async function onShipmentStatus(shipmentId: string, shipmentStatus: string, extra: { vehicle_id?: string } = {}): Promise<void> {
  if (shipmentStatus === 'exception') {
    const { data: failed } = await supabase.from('customer_bookings').select(BOOKING_COLUMNS).eq('shipment_id', shipmentId).maybeSingle();
    if (failed && !['delivered', 'cancelled'].includes(failed.status)) {
      await notifyCustomer(failed, 'Delivery attempt failed', 'We could not deliver your shipment this time. Our team will arrange another attempt.', failed.status);
    }
    return;
  }
  const next = SHIPMENT_TO_BOOKING[shipmentStatus];
  if (!next) return;
  const { data: booking, error } = await supabase.from('customer_bookings').select(BOOKING_COLUMNS).eq('shipment_id', shipmentId).maybeSingle();
  if (error || !booking) return;
  if (booking.status === next) {
    // Same status, another vehicle: keep the booking's vehicle current
    if (next === 'assigned' && extra.vehicle_id && booking.vehicle_id !== extra.vehicle_id) {
      const changed = await transition(booking.id, ['assigned'], { vehicle_id: extra.vehicle_id });
      if (changed) await notifyCustomer(changed, 'Vehicle changed', 'A different vehicle has been assigned to your booking.', 'assigned');
    }
    return;
  }
  const from = MOVES_FROM[next] ?? BOOKING_STATUSES.filter((s) => s !== 'delivered' && s !== 'cancelled' && s !== next);
  const patch: Record<string, unknown> = { status: next };
  if (next === 'cancelled') patch.cancelled_by = 'staff';
  if (next === 'assigned' && extra.vehicle_id) patch.vehicle_id = extra.vehicle_id;
  if (next === 'confirmed') patch.vehicle_id = null;
  const updated = await transition(booking.id, from, patch);
  if (!updated) return;
  await notifyCustomer(updated, PROGRESS_TEXT[next][0], PROGRESS_TEXT[next][1], next);
}
