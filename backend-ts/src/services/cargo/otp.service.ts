/**
 * margixindia — Delivery OTP
 *
 * For high-value goods (or when the customer asks) the consignee proves they received the goods
 * with a 6-digit code. Only a hash is stored (sha256 of the shipment id and the code), with a
 * 24-hour expiry. The code reaches the customer who booked in the app, and by SMS when a
 * provider is configured. It is checked inside the delivery custody events; after 5 wrong
 * tries the shipment is locked for 15 minutes.
 */
import crypto from 'crypto';
import { supabase } from '../../core/supabase';
import { HttpError } from '../../core/errors';
import { cacheDelete, cacheGet, cacheIncr } from '../../core/redis';
import { consumeRateLimit } from '../../core/rate-limit';
import { FINAL_SHIPMENT_STATUSES } from '../../core/transitions';
import { sendSms, smsConfigured } from '../sms.service';
import { bookingCustomer, notifyUserSafe } from './notify';
import { assertNotMaster, type Actor, type Consignment } from './consignment';

export const OTP_TTL_HOURS = 24;
export const OTP_MAX_WRONG = 5;
export const OTP_LOCK_MINUTES = 15;
/** Codes sent per shipment per hour. */
export const OTP_SENDS_PER_HOUR = 5;

export function hashOtp(shipmentId: string, otp: string): string {
  return crypto.createHash('sha256').update(`${shipmentId}:${otp}`).digest('hex');
}

const failKey = (shipmentId: string) => `cargo-otp-fail:${shipmentId}`;

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/**
 * Makes a new code for a shipment, stores its hash and sends it to the consignee. Staff call it,
 * or it runs by itself when a shipment that needs a code goes out for delivery.
 */
export async function sendDeliveryOtp(c: Consignment, actor: Actor | null): Promise<{ expires_at: string; notified: { in_app: boolean; sms: boolean } }> {
  if (c.kind !== 'shipment') throw new HttpError(400, 'A delivery code is sent for shipments only');
  await assertNotMaster(c, 'Send the delivery code');
  if ((FINAL_SHIPMENT_STATUSES as readonly string[]).includes(c.status)) {
    throw new HttpError(409, `This shipment is ${c.status.replace(/_/g, ' ')}, so no delivery code is needed.`);
  }
  if (!(await consumeRateLimit(`cargo-otp-send:${c.id}`, OTP_SENDS_PER_HOUR, 60 * 60))) {
    throw new HttpError(429, 'Several codes were sent for this shipment in the last hour. Try again later.');
  }

  const otp = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
  const expiresAt = new Date(Date.now() + OTP_TTL_HOURS * 3600_000).toISOString();
  const { error } = await supabase
    .from('shipments')
    .update({ delivery_otp_hash: hashOtp(c.id, otp), delivery_otp_expires_at: expiresAt, delivery_otp_required: true })
    .eq('id', c.id);
  if (error) throw new Error(`Failed to store the delivery code: ${error.message}`);
  await cacheDelete(failKey(c.id));

  const text = `Your delivery code for ${c.code} is ${otp}. Share it with the driver only when you have your goods. It is valid for ${OTP_TTL_HOURS} hours.`;
  const notified = { in_app: false, sms: false };
  const customer = await bookingCustomer(c.id);
  if (customer) {
    await notifyUserSafe(customer.customer_id, 'Your delivery code', text, 'cargo_delivery_otp', {
      shipment_id: c.id, booking_id: customer.booking_id, code: c.code, expires_at: expiresAt, sent_by: actor?.role ?? 'system',
    });
    notified.in_app = true;
    if (smsConfigured()) {
      const { data: person } = await supabase.from('customers').select('phone').eq('id', customer.customer_id).maybeSingle();
      if (person?.phone) notified.sms = await sendSms(person.phone, `MargixIndia: ${text}`);
    }
  }
  return { expires_at: expiresAt, notified };
}

/**
 * Checks the code given at delivery. Throws 400 for a missing or wrong code, 409 when it has
 * expired and 429 while locked. The caller clears the stored hash once the delivery is written.
 */
export async function verifyDeliveryOtp(c: Consignment, otp: unknown): Promise<true> {
  const failures = Number((await cacheGet<number | string>(failKey(c.id))) ?? 0);
  if (failures >= OTP_MAX_WRONG) {
    throw new HttpError(429, `Too many wrong delivery codes. Try again in ${OTP_LOCK_MINUTES} minutes.`);
  }
  if (typeof otp !== 'string' || !/^\d{6}$/.test(otp.trim())) throw new HttpError(400, 'Enter the 6-digit delivery code from the consignee');
  const hash = c.row.delivery_otp_hash as string | null;
  const expires = c.row.delivery_otp_expires_at ? Date.parse(c.row.delivery_otp_expires_at) : NaN;
  if (!hash || !Number.isFinite(expires) || expires < Date.now()) {
    throw new HttpError(409, 'The delivery code has expired or was never sent. Ask dispatch to send a new one.');
  }
  if (!safeEqual(hash, hashOtp(c.id, otp.trim()))) {
    const count = await cacheIncr(failKey(c.id), OTP_LOCK_MINUTES * 60);
    if (count >= OTP_MAX_WRONG) {
      throw new HttpError(429, `Too many wrong delivery codes. Try again in ${OTP_LOCK_MINUTES} minutes.`);
    }
    const left = OTP_MAX_WRONG - count;
    throw new HttpError(400, `That delivery code is wrong. ${left} ${left === 1 ? 'try' : 'tries'} left.`, { tries_left: left });
  }
  await cacheDelete(failKey(c.id));
  return true;
}
