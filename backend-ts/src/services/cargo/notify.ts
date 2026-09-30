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
import { manifestVendorId, type Consignment } from './consignment';

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

export async function notifyStaffSafe(title: string, body: string, type: CargoNotificationType, data: Record<string, unknown>): Promise<void> {
  try {
    await notificationService.notifyStaff(title, body, type, data);
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
      const vendorId = await manifestVendorId(c.id);
      await notifyUserSafe(vendorId, title, text, type, payload);
    }
  } catch (e) {
    console.error(`[cargo] Owner notification ${type} failed:`, e);
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
