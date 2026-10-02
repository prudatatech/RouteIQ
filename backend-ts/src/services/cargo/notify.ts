/**
 * margixindia — Cargo notifications
 *
 * Staff hear about cargo cases through notifyStaff (the types are in
 * OPERATIONS_NOTIFICATION_TYPES, so managers get them too). The customer who booked a shipment
 * and the vendor who asked for a load get the same news in plain words. A notification that
 * fails never undoes the change it reports.
 */
import { supabase } from '../../core/supabase';
import { notificationService } from '../notification.service';
import { carrierOf } from '../../core/org-guards';
import type { Consignment } from './consignment';

/** The notification types of the cargo contract. */
export const CARGO_NOTIFICATION_TYPES = [
  'cargo_exception_opened', 'cargo_exception_escalated', 'cargo_exception_resolved',
  'cargo_transfer_planned', 'cargo_transfer_completed', 'cargo_partial_delivery', 'cargo_rto_started',
  'cargo_at_hub', 'cargo_delivery_otp', 'cargo_claim_update', 'driver_action_rejected',
] as const;
export type CargoNotificationType = typeof CARGO_NOTIFICATION_TYPES[number];

/** The customer whose booking became this shipment (or the master it is a lot of), if any. */
export async function bookingCustomer(shipmentId: string): Promise<{ customer_id: string; booking_id: string } | null> {
  const { data } = await supabase.from('customer_bookings').select('id, customer_id').eq('shipment_id', shipmentId).limit(1);
  const row = data?.[0];
  if (row?.customer_id) return { customer_id: row.customer_id, booking_id: row.id };
  const { data: lot } = await supabase.from('shipments').select('parent_shipment_id').eq('id', shipmentId).maybeSingle();
  return lot?.parent_shipment_id ? bookingCustomer(lot.parent_shipment_id) : null;
}

/** The vendor and the vendor request (the load they posted) behind a vendor-load consignment. */
export async function manifestRequest(manifestId: string): Promise<{ vendor_id: string; request_id: string } | null> {
  const { data: manifest } = await supabase.from('cargo_manifest').select('vendor_request_id').eq('id', manifestId).maybeSingle();
  if (!manifest?.vendor_request_id) return null;
  const { data: request } = await supabase.from('vendor_shipment_requests').select('vendor_id').eq('id', manifest.vendor_request_id).maybeSingle();
  return request?.vendor_id ? { vendor_id: request.vendor_id, request_id: manifest.vendor_request_id } : null;
}

/** The ids a customer app (booking_id) or vendor app (request_id) needs to open the item a cargo row is about. */
export async function ownerRefs(row: { shipment_id?: string | null; manifest_id?: string | null }): Promise<{ user_id: string; ids: Record<string, string> } | null> {
  if (row.manifest_id) {
    const m = await manifestRequest(row.manifest_id);
    return m ? { user_id: m.vendor_id, ids: { request_id: m.request_id, manifest_id: row.manifest_id } } : null;
  }
  if (row.shipment_id) {
    const b = await bookingCustomer(row.shipment_id);
    return b ? { user_id: b.customer_id, ids: { booking_id: b.booking_id, shipment_id: row.shipment_id } } : null;
  }
  return null;
}

/**
 * The company that owns the record a cargo notification is about (its case, transfer, claim, shipment or load,
 * named in `data`), so only that company's staff hear of it. Null when `data` names none.
 */
async function ownerOfNews(data: Record<string, unknown>): Promise<string | null> {
  const id = (k: string) => (typeof data[k] === 'string' ? (data[k] as string) : null);
  return (await carrierOf('cargo_exceptions', id('exception_id')))
    ?? (await carrierOf('cargo_transfers', id('transfer_id')))
    ?? (await carrierOf('cargo_claims', id('claim_id')))
    ?? (await carrierOf('shipments', id('shipment_id')))
    ?? (await carrierOf('cargo_manifest', id('manifest_id')));
}

export async function notifyStaffSafe(title: string, body: string, type: CargoNotificationType, data: Record<string, unknown>, orgId?: string | null): Promise<void> {
  try {
    await notificationService.notifyStaff(title, body, type, data, orgId ?? await ownerOfNews(data));
  } catch (e) {
    console.error(`[cargo] Staff notification ${type} failed:`, e);
  }
}

export async function notifyUserSafe(userId: string | null | undefined, title: string, body: string, type: CargoNotificationType, data: Record<string, unknown>): Promise<void> {
  if (!userId) return;
  try {
    await notificationService.sendNotification(userId, title, body, type, data);
  } catch (e) {
    console.error(`[cargo] Notification ${type} to ${userId} failed:`, e);
  }
}

/**
 * Tells the customer (for a shipment booked in the customer app) or the vendor (for their load)
 * about their goods, in plain words. `text` should read naturally after "Your goods" is implied,
 * e.g. "Your goods were moved to another truck after a breakdown."
 */
export async function notifyOwner(c: Pick<Consignment, 'kind' | 'id' | 'code'>, title: string, text: string, type: CargoNotificationType, data: Record<string, unknown> = {}): Promise<void> {
  try {
    const payload = { ...data, ...(c.kind === 'shipment' ? { shipment_id: c.id } : { manifest_id: c.id }), code: c.code };
    if (c.kind === 'shipment') {
      const customer = await bookingCustomer(c.id);
      if (customer) await notifyUserSafe(customer.customer_id, title, text, type, { ...payload, booking_id: customer.booking_id });
    } else {
      const vendor = await manifestRequest(c.id);
      if (vendor) await notifyUserSafe(vendor.vendor_id, title, text, type, { ...payload, request_id: vendor.request_id });
    }
  } catch (e) {
    console.error(`[cargo] Owner notification ${type} failed:`, e);
  }
}

/**
 * A delivery was rated. The driver hears how it went; staff hear it too when the customer rated
 * (a rating staff entered themselves needs no notice to staff). Once per shipment and rating time.
 */
export async function notifyDeliveryRated(shipmentId: string, rating: number, opts: { driverId: string | null; byCustomer: boolean; comment?: string | null; notifyStaff?: boolean }): Promise<void> {
  try {
    const { data: shipment } = await supabase.from('shipments').select('tracking_id, driver_rated_at').eq('id', shipmentId).maybeSingle();
    const code = shipment?.tracking_id ?? shipmentId;
    const data = { shipment_id: shipmentId, code, rating, rated_at: shipment?.driver_rated_at ?? null, ...(opts.comment ? { comment: opts.comment } : {}) };
    const who = opts.byCustomer ? 'The customer' : 'Dispatch';
    if (opts.driverId) {
      await notificationService.sendNotificationOnce(opts.driverId, `You got ${rating} out of 5`, `${who} rated delivery ${code} ${rating} out of 5.`, 'delivery_rated', data, 'rated_at', 1);
    }
    if (opts.byCustomer && opts.notifyStaff !== false) {
      await notificationService.notifyStaffOnce(`Delivery rated ${rating} out of 5`, `The customer rated ${code} ${rating} out of 5${opts.comment ? `: ${opts.comment}` : ''}.`, 'delivery_rated', data, 'rated_at', 1, await carrierOf('shipments', shipmentId));
    }
  } catch (e) {
    console.error('[rating] could not send the rating notification:', e);
  }
}

/** The driver of a vehicle, if any. */
export async function notifyVehicleDriver(vehicleId: string | null | undefined, title: string, body: string, type: CargoNotificationType, data: Record<string, unknown>): Promise<void> {
  if (!vehicleId) return;
  const { data: vehicle } = await supabase.from('vehicles').select('driver_id').eq('id', vehicleId).maybeSingle();
  await notifyUserSafe(vehicle?.driver_id, title, body, type, data);
}

/** "6:40 pm" style time in India, for revised ETAs in messages. */
export function istTime(at: Date): string {
  return at.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }).toLowerCase();
}
