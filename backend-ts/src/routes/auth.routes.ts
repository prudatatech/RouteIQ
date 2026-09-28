/**
 * margixindia — Auth Routes (Post-Supabase Migration)
 * 
 * Frontend login/signup now goes directly to Supabase Auth.
 * This file only handles:
 *   - Driver OTP auth (phone-based, via Twilio)
 *   - Token refresh (for driver app backward compat)
 *   - Logout (no-op convenience endpoint)
 */
import { Router, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '../core/supabase';
import { authenticateToken, createAccessToken, createRefreshToken, requireAuth, requireRole } from '../core/auth';
import { settings } from '../core/config';
import { cacheDelete, cacheGet, cacheSet } from '../core/redis';
import { consumeRateLimit, rateLimitByIp } from '../core/rate-limit';
import { sendError } from '../core/errors';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

/**
 * Find a Supabase auth.users record by email without loading the whole user
 * base into memory. `supabase.auth.admin.listUsers()` defaults to the first
 * 50 users, so a plain call silently misses any account past that page.
 * Pages through in large batches (bounded) until the email is found.
 */
async function findAuthUserByEmail(email: string): Promise<{ id: string } | null> {
  const perPage = 1000;
  const maxPages = 50; // up to 50,000 users
  for (let page = 1; page <= maxPages; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error || !data?.users?.length) break;
    const match = data.users.find((u: any) => u.email === email);
    if (match) return { id: match.id };
    if (data.users.length < perPage) break; // last page
  }
  return null;
}

// ═══════════════════════════════════════════════════════════
// DRIVER AUTH — Twilio Phone OTP (like Ola/Uber/Zomato)
// ═══════════════════════════════════════════════════════════

type OtpKind = 'driver' | 'customer';

const OTP_MAX_ATTEMPTS = 5;            // wrong guesses per issued code
const OTP_SENDS_PER_WINDOW = 3;        // codes per phone per 10 minutes
const OTP_FAILURES_PER_HOUR = 10;      // wrong guesses per phone per hour, across resends

/** Random numeric OTP of the configured length (4–8 digits). */
function generateOTP(): string {
  const len = Math.min(Math.max(settings.OTP_LENGTH || 6, 4), 8);
  return crypto.randomInt(0, 10 ** len).toString().padStart(len, '0');
}

/** Normalise an Indian phone number to E.164 (+91XXXXXXXXXX); null when invalid. */
function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let phone = raw.replace(/\s+/g, '').replace(/^0+/, '');
  if (!phone.startsWith('+')) {
    if (phone.startsWith('91') && phone.length === 12) phone = '+' + phone;
    else if (phone.length === 10) phone = '+91' + phone;
    else phone = '+' + phone;
  }
  return phone.replace(/\D/g, '').length >= 10 ? phone : null;
}

function twilioConfigured(): boolean {
  return Boolean(settings.TWILIO_ACCOUNT_SID && settings.TWILIO_AUTH_TOKEN && settings.TWILIO_PHONE_NUMBER);
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/**
 * Create a real Supabase Auth session for a user who has just proven their
 * phone number, so the mobile app can call Supabase directly under row-level
 * security (and the API with the same token). Uses an admin-generated
 * magic-link token that is verified server-side; no email is sent.
 * Returns null when a session cannot be created (older app builds only need
 * the backend-issued tokens).
 */
async function createSupabaseSession(email: string | undefined | null) {
  if (!email) return null;
  const { data: link, error: linkErr } = await supabase.auth.admin.generateLink({ type: 'magiclink', email });
  const tokenHash = link?.properties?.hashed_token;
  if (linkErr || !tokenHash) {
    console.error(`[auth] Could not generate session link: ${linkErr?.message ?? 'no token'}`);
    return null;
  }

  const client = createClient(settings.SUPABASE_URL, settings.SUPABASE_ANON_KEY || settings.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.verifyOtp({ token_hash: tokenHash, type: 'email' });
  if (error || !data.session) {
    console.error(`[auth] Could not create Supabase session: ${error?.message ?? 'no session'}`);
    return null;
  }
  return {
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at,
  };
}

/**
 * Issue and send a login OTP. Rate limits are checked before a new code is
 * stored, so a rejected request never replaces (or resets) the current code.
 */
async function sendOtp(kind: OtpKind, req: Request, res: Response): Promise<void> {
  try {
    const phone = normalizePhone(req.body.phone);
    if (!phone) {
      res.status(400).json({ detail: 'Invalid phone number' });
      return;
    }
    if (!twilioConfigured() && settings.isProduction) {
      console.error('[OTP] Twilio is not configured; refusing to issue OTPs in production');
      res.status(503).json({ detail: 'SMS delivery is temporarily unavailable. Please try again later.' });
      return;
    }
    if (!(await consumeRateLimit(`otp-send:${kind}:${phone}`, OTP_SENDS_PER_WINDOW, 600))) {
      res.status(429).json({ detail: 'Too many OTP requests. Please wait 10 minutes.' });
      return;
    }

    const otp = generateOTP();
    await cacheSet(`otp:${kind}:${phone}`, { otp, attempts: 0, created_at: Date.now() }, settings.OTP_EXPIRY_SECONDS);

    const { data: existing } = await supabase
      .from(kind === 'driver' ? 'users' : 'customers')
      .select('id')
      .eq('phone', phone)
      .maybeSingle();

    let message = `Your margixindia ${kind} login OTP is: ${otp}. Valid for ${Math.round(settings.OTP_EXPIRY_SECONDS / 60)} minutes. Do not share this code.`;
    if (!existing) message = `Welcome ${kind === 'driver' ? 'Driver' : 'Customer'}! ${message}`;

    if (!(await sendTwilioSMS(phone, message))) {
      await cacheDelete(`otp:${kind}:${phone}`);
      res.status(502).json({ detail: 'Failed to send OTP. Please try again.' });
      return;
    }

    res.json({
      status: 'otp_sent',
      phone: phone.replace(/(\+91)(\d{6})(\d{4})/, '$1******$3'), // Mask for response
      expires_in_seconds: settings.OTP_EXPIRY_SECONDS,
      message: 'OTP sent successfully',
    });
  } catch (e) {
    sendError(req, res, e);
  }
}

/**
 * Check a submitted OTP. Sends the error response and returns false when the
 * code is missing, wrong, expired or the phone is locked out.
 */
async function verifyOtp(kind: OtpKind, phone: string, otp: unknown, res: Response): Promise<boolean> {
  if (typeof otp !== 'string' || !otp.trim()) {
    res.status(400).json({ detail: 'phone and otp are required' });
    return false;
  }

  const failKey = `otp-fail:${kind}:${phone}`;
  if (Number(await cacheGet(`ratelimit:${failKey}`) ?? 0) >= OTP_FAILURES_PER_HOUR) {
    res.status(429).json({ detail: 'Too many failed attempts. Please try again in an hour.' });
    return false;
  }

  const otpKey = `otp:${kind}:${phone}`;
  const stored = await cacheGet<{ otp: string; attempts: number; created_at: number }>(otpKey);
  if (!stored || typeof stored.otp !== 'string') {
    res.status(401).json({ detail: 'OTP expired or not found. Please request a new one.' });
    return false;
  }
  if (stored.attempts >= OTP_MAX_ATTEMPTS) {
    await cacheDelete(otpKey);
    res.status(429).json({ detail: 'Too many failed attempts. Please request a new OTP.' });
    return false;
  }

  if (!safeEqual(stored.otp, otp.trim())) {
    const attempts = stored.attempts + 1;
    await cacheSet(otpKey, { ...stored, attempts }, settings.OTP_EXPIRY_SECONDS);
    await consumeRateLimit(failKey, OTP_FAILURES_PER_HOUR, 3600);
    res.status(401).json({ detail: 'Incorrect OTP', remaining_attempts: Math.max(0, OTP_MAX_ATTEMPTS - attempts) });
    return false;
  }

  await cacheDelete(otpKey);
  return true;
}

/**
 * Sends SMS via Twilio REST API (no SDK needed — just HTTP POST).
 */
async function sendTwilioSMS(to: string, body: string): Promise<boolean> {
  const accountSid = settings.TWILIO_ACCOUNT_SID;
  const authToken = settings.TWILIO_AUTH_TOKEN;
  const from = settings.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !from) {
    if (settings.isProduction) return false;
    console.warn(`[DEV OTP] Twilio not configured. To: ${to}, Message: ${body}`);
    return true;
  }

  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const params = new URLSearchParams({ To: to, From: from, Body: body });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (response.ok) {
      console.log(`SMS sent to ${to}`);
      return true;
    } else {
      const errData: any = await response.json();
      console.error(`Twilio SMS failed: ${errData.message || response.status}`);
      return false;
    }
  } catch (e: any) {
    console.error(`Twilio SMS error: ${e.message}`);
    return false;
  }
}

// ── POST /driver/send-otp — Send OTP to the driver's phone ──
router.post('/driver/send-otp', rateLimitByIp('otp-send', 10, 3600), (req: Request, res: Response) => sendOtp('driver', req, res));

// ── POST /driver/verify-otp — Verify OTP and login driver ──
router.post('/driver/verify-otp', rateLimitByIp('otp-verify', 30, 3600), async (req: Request, res: Response) => {
  try {
    const phone = normalizePhone(req.body.phone);
    if (!phone) {
      res.status(400).json({ detail: 'phone and otp are required' });
      return;
    }
    if (!(await verifyOtp('driver', phone, req.body.otp, res))) return;

    // Find or create driver in auth.users via Supabase Admin API
    // This ensures the FK constraint (public.users.id → auth.users.id) is satisfied
    let { data: driver } = await supabase
      .from('users')
      .select('*')
      .eq('phone', phone)
      .eq('role', 'driver')
      .single();

    let authUserId: string;

    if (!driver) {
      const driverEmail = `driver_${phone.replace(/\+/g, '')}@driver.margixindia.local`;
      const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
        email: driverEmail,
        email_confirm: true,
        app_metadata: { role: 'driver' },
        user_metadata: {
          full_name: `Driver ${phone.slice(-4)}`,
          role: 'driver',
          phone,
        },
      });

      if (authError) {
        // If user already exists in auth.users (trigger failed previously), recover gracefully!
        if (authError.message.includes('already been registered') || (authError as any).code === 'email_exists') {
          const existingUser = await findAuthUserByEmail(driverEmail);
          if (existingUser) {
            authUserId = existingUser.id;
          } else {
            res.status(500).json({ detail: 'Failed to recover existing driver account' });
            return;
          }
        } else {
          console.error('Failed to create auth user for driver:', authError);
          res.status(500).json({ detail: 'Failed to create driver account' });
          return;
        }
      } else {
        authUserId = authUser.user!.id;
      }

      // Guarantee the public profile exists via manual upsert (bypassing trigger unreliability)
      await supabase.from('users').upsert({
        id: authUserId,
        email: driverEmail,
        phone: phone,
        role: 'driver',
        full_name: `Driver ${phone.slice(-4)}`
      }, { onConflict: 'id' });

      // Fetch the created driver profile
      const { data: newDriver } = await supabase
        .from('users')
        .select('*')
        .eq('id', authUserId)
        .single();

      if (!newDriver) {
        res.status(500).json({ detail: 'Failed to create driver profile' });
        return;
      }
      driver = newDriver;
    }

    if (!driver.is_active) {
      res.status(403).json({ detail: 'Driver account disabled. Contact your fleet manager.' });
      return;
    }

    // Update last login
    await supabase.from('users').update({ last_login: new Date().toISOString() }).eq('id', driver.id);

    // Issue JWT signed with Supabase JWT secret (compatible with all services)
    const tokenData = { sub: driver.id, role: 'driver' };

    // Fetch user metadata to get language preference
    let language_preference = 'en';
    const { data: authUser } = await supabase.auth.admin.getUserById(driver.id);
    if (authUser?.user?.user_metadata?.language_preference) {
      language_preference = authUser.user.user_metadata.language_preference;
    }

    res.json({
      status: 'authenticated',
      access_token: createAccessToken(tokenData),
      refresh_token: createRefreshToken(tokenData),
      token_type: 'bearer',
      role: 'driver',
      user_id: driver.id,
      // Supabase session for direct, RLS-governed access (current driver app)
      supabase_session: await createSupabaseSession(authUser?.user?.email),
      driver: {
        id: driver.id,
        phone: driver.phone,
        full_name: driver.full_name,
        is_active: driver.is_active,
        language_preference,
        vehicle_type: driver.vehicle_type,
      },
    });
  } catch (e: any) {
    sendError(req, res, e);
  }
});


// ═══════════════════════════════════════════════════════════
// CUSTOMER AUTH — Twilio Phone OTP
// ═══════════════════════════════════════════════════════════

// ── POST /customer/send-otp — Send OTP to the customer's phone ──
router.post('/customer/send-otp', rateLimitByIp('otp-send', 10, 3600), (req: Request, res: Response) => sendOtp('customer', req, res));

// ── POST /customer/verify-otp — Verify OTP and login driver ──
router.post('/customer/verify-otp', rateLimitByIp('otp-verify', 30, 3600), async (req: Request, res: Response) => {
  try {
    const phone = normalizePhone(req.body.phone);
    if (!phone) {
      res.status(400).json({ detail: 'phone and otp are required' });
      return;
    }
    if (!(await verifyOtp('customer', phone, req.body.otp, res))) return;

    // Find or create customer in auth.users via Supabase Admin API
    let { data: customer } = await supabase
      .from('customers')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    let authUserId: string;

    if (!customer) {
      const customerEmail = `customer_${phone.replace(/\+/g, '')}@customer.margixindia.local`;
      const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
        email: customerEmail,
        email_confirm: true,
        app_metadata: { role: 'customer' },
        user_metadata: {
          full_name: `Customer ${phone.slice(-4)}`,
          role: 'customer',
          phone,
        },
      });

      if (authError) {
        // If user already exists in auth.users (trigger failed previously), recover gracefully!
        if (authError.message.includes('already been registered') || (authError as any).code === 'email_exists') {
          const existingUser = await findAuthUserByEmail(customerEmail);
          if (existingUser) {
            authUserId = existingUser.id;
          } else {
            res.status(500).json({ detail: 'Failed to recover existing customer account' });
            return;
          }
        } else {
          console.error('Failed to create auth user for customer:', authError);
          res.status(500).json({ detail: 'Failed to create customer account' });
          return;
        }
      } else {
        authUserId = authUser.user!.id;
      }

      // Guarantee the public profile exists via manual upsert
      const { error: upsertErr } = await supabase.from('customers').upsert({
        id: authUserId,
        phone: phone,
        full_name: `Customer ${phone.slice(-4)}`
      }, { onConflict: 'id' });
      
      if (upsertErr) {
        console.error("Failed to upsert customer:", upsertErr);
      }

      // Fetch the created customer profile
      const { data: newCustomer } = await supabase
        .from('customers')
        .select('*')
        .eq('id', authUserId)
        .maybeSingle();

      if (!newCustomer) {
        res.status(500).json({ detail: 'Failed to create customer profile' });
        return;
      }
      customer = newCustomer;
    }

    // Skip is_active and last_login checks for customers for now, 
    // as the customers schema doesn't necessarily have these columns yet.

    // Issue JWT signed with Supabase JWT secret (compatible with all services)
    const tokenData = { sub: customer.id, role: 'customer' };

    // Fetch user metadata to get language preference
    let language_preference = 'en';
    const { data: authUser } = await supabase.auth.admin.getUserById(customer.id);
    if (authUser?.user?.user_metadata?.language_preference) {
      language_preference = authUser.user.user_metadata.language_preference;
    }

    res.json({
      status: 'authenticated',
      access_token: createAccessToken(tokenData),
      refresh_token: createRefreshToken(tokenData),
      token_type: 'bearer',
      role: 'customer',
      user_id: customer.id,
      customer: {
        id: customer.id,
        phone: customer.phone,
        full_name: customer.full_name,
        is_active: customer.is_active,
        language_preference,
        vehicle_type: customer.vehicle_type,
      },
    });
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── POST /refresh ──────────────────────────────────────────
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const token = req.body.refresh_token;
    if (!token) {
      res.status(400).json({ detail: 'refresh_token required' });
      return;
    }

    let tokenData;
    try {
      tokenData = await authenticateToken(token, 'refresh');
    } catch {
      res.status(401).json({ detail: 'Invalid or expired token' });
      return;
    }

    // Customers live in their own table; everyone else in users
    let user: { id: string; role: string; is_active: boolean } | null = null;
    if (tokenData.role === 'customer') {
      const { data } = await supabase.from('customers').select('id').eq('id', tokenData.user_id).maybeSingle();
      if (data) user = { id: data.id, role: 'customer', is_active: true };
    } else {
      const { data } = await supabase.from('users').select('id, role, is_active').eq('id', tokenData.user_id).maybeSingle();
      user = data;
    }

    if (!user || !user.is_active) {
      res.status(401).json({ detail: 'User not found or inactive' });
      return;
    }

    const td = { sub: user.id, role: user.role };
    res.json({
      access_token: createAccessToken(td),
      refresh_token: createRefreshToken(td),
      token_type: 'bearer',
      role: user.role,
      user_id: user.id,
    });
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── POST /logout ───────────────────────────────────────────
router.post('/logout', (_req: Request, res: Response) => {
  res.json({ message: 'Logged out successfully' });
});

// ── PUT /driver/profile ────────────────────────────────────
// vehicles.vehicle_type is a Postgres enum (scripts/supabase_init.sql: CREATE TYPE
// vehicle_type AS ENUM ('truck', 'van', 'bike', 'car')). users.vehicle_type is a
// free-text column, so it can hold whatever descriptive value the client sends
// (e.g. the driver app's specific truck model names, see driver-app/src/screens/
// HomeScreen.tsx INDIAN_VEHICLES).
const VEHICLE_ENUM_TYPES = ['truck', 'van', 'bike', 'car'];

router.put('/driver/profile', requireAuth, async (req: Request, res: Response) => {
  try {
    const { vehicle_type, full_name } = req.body;
    const userId = req.user?.user_id;

    if (!userId || req.user?.role !== 'driver') {
      res.status(403).json({ detail: 'Only authenticated drivers can update their profile' });
      return;
    }

    if (vehicle_type !== undefined && (typeof vehicle_type !== 'string' || !vehicle_type.trim())) {
      res.status(400).json({ detail: 'vehicle_type must be a non-empty string' });
      return;
    }

    const updates: any = {};
    if (vehicle_type) updates.vehicle_type = vehicle_type;
    if (full_name) updates.full_name = full_name;

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ detail: 'No update data provided' });
      return;
    }

    // Update database since column exists
    const { error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', userId);

    if (error) throw error;

    // Only the vehicles.vehicle_type enum column accepts truck/van/bike/car —
    // map the submitted value onto it when it actually is one of those, and
    // otherwise leave the vehicle's existing category untouched rather than
    // overwriting it with a value the driver never chose.
    const normalizedEnumType = typeof vehicle_type === 'string'
      ? VEHICLE_ENUM_TYPES.find((t) => t === vehicle_type.trim().toLowerCase())
      : undefined;

    // Check if the driver has a vehicle assigned
    const { data: existingVehicle } = await supabase
      .from('vehicles')
      .select('id')
      .eq('driver_id', userId)
      .single();

    if (!existingVehicle) {
      // Create a new vehicle for the driver
      const { error: insertErr } = await supabase.from('vehicles').insert({
        id: uuidv4(),
        plate_number: `TEMP-${userId.substring(0, 6).toUpperCase()}`,
        vehicle_type: normalizedEnumType || 'truck', // Must be valid enum
        driver_id: userId,
        status: 'idle',
        capacity_kg: 1000 // Default capacity
      });
      if (insertErr) console.error('Failed to create vehicle for driver:', insertErr);
    } else if (normalizedEnumType) {
      const { error: vehUpdateErr } = await supabase
        .from('vehicles')
        .update({ vehicle_type: normalizedEnumType })
        .eq('id', existingVehicle.id);
      if (vehUpdateErr) console.error('Failed to update vehicle type:', vehUpdateErr);
    }

    res.json({ status: 'success', vehicle_type });
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// Haversine distance in km from lat/lng pairs
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const RATE_PER_KM = 15; // ₹15/km standard Indian trucking rate

async function buildEarnings(userId: string) {
  const { data: vehicles } = await supabase.from('vehicles').select('id, latitude, longitude, capacity_kg').eq('driver_id', userId);
  if (!vehicles || vehicles.length === 0) return { total_earnings: 0, completed_trips: 0, recent_invoices: [] };

  const activeVehicle = vehicles[0];
  let driverLat = activeVehicle.latitude || 23.7842;
  let driverLng = activeVehicle.longitude || 86.4461;
  let driverLocationName = 'Origin Depot';

  if (driverLat && driverLng) {
    try {
      // Use Nominatim (OpenStreetMap) for server-side reverse geocoding to avoid Google Maps API referer restrictions
      const url = `https://nominatim.openstreetmap.org/reverse?lat=${driverLat}&lon=${driverLng}&format=json`;
      const response = await fetch(url, { headers: { 'User-Agent': 'margixindia-Backend' } });
      const data: any = await response.json();
      if (data && data.address) {
        driverLocationName = data.address.city || data.address.town || data.address.county || data.address.state_district || data.display_name.split(',')[0];
      }
    } catch (e) {
      console.error("Geocoding failed", e);
    }
  }

  const vehicleIds = vehicles.map(v => v.id);
  const { data: cargoTrips } = await supabase.from('cargo_manifest').select('*').in('vehicle_id', vehicleIds).eq('status', 'delivered').order('updated_at', { ascending: false });
  const { data: routeTrips } = await supabase.from('routes').select(`
    *,
    route_stops (
      sequence,
      delivery_points ( name, address, latitude, longitude, demand_kg )
    )
  `).in('vehicle_id', vehicleIds).eq('status', 'completed').order('updated_at', { ascending: false });

  const allTrips = [
    ...(cargoTrips || []).map(t => ({ ...t, trip_type: 'cargo' })),
    ...(routeTrips || []).map(t => ({ ...t, trip_type: 'route' }))
  ].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

  if (allTrips.length === 0) return { total_earnings: 0, completed_trips: 0, recent_invoices: [] };

  const invoices = allTrips.map((t: any) => {
    // Determine proper pickup/drop based on type
    let pickupLoc = t.trip_type === 'cargo' ? (t.pickup_location || 'Unknown Pickup') : 'Assigned Route Start';
    let dropLoc = t.trip_type === 'cargo' ? (t.drop_location || 'Unknown Drop') : 'Multiple Delivery Stops';

    let distKm = 0;

    if (t.trip_type === 'route' && t.route_stops && t.route_stops.length > 0) {
      // Sort stops by sequence
      const sortedStops = [...t.route_stops].sort((a, b) => a.sequence - b.sequence);
      const startStop = sortedStops[0]?.delivery_points;
      const endStop = sortedStops[sortedStops.length - 1]?.delivery_points;

      if (t.total_distance_km && t.total_distance_km > 0) {
        distKm = t.total_distance_km;
      } else {
        let calculatedDist = 0;
        for (let i = 0; i < sortedStops.length - 1; i++) {
          const p1 = sortedStops[i]?.delivery_points;
          const p2 = sortedStops[i + 1]?.delivery_points;
          if (p1?.latitude && p1?.longitude && p2?.latitude && p2?.longitude) {
            calculatedDist += haversineKm(p1.latitude, p1.longitude, p2.latitude, p2.longitude);
          }
        }
        distKm = Math.round(calculatedDist * 10) / 10;
      }

      if (sortedStops.length === 1) {
        pickupLoc = driverLocationName;
        dropLoc = startStop?.name || startStop?.address || 'Unknown Drop';

        // Add distance from driver location to the single stop
        if (startStop?.latitude && startStop?.longitude && driverLat && driverLng) {
          distKm += Math.round(haversineKm(driverLat, driverLng, startStop.latitude, startStop.longitude) * 10) / 10;
        }
      } else {
        pickupLoc = startStop?.name || startStop?.address || 'Unknown Pickup';
        dropLoc = endStop?.name || endStop?.address || 'Unknown Drop';
      }
    } else if (t.trip_type === 'cargo') {

      distKm = t.total_distance_km
        ? t.total_distance_km
        : (t.pickup_lat && t.drop_lat)
          ? Math.round(haversineKm(t.pickup_lat, t.pickup_lng, t.drop_lat, t.drop_lng) * 10) / 10
          : 0;
    }

    const cost = t.cost || 0;

    let weightKg = t.capacity_kg || 0;
    if (t.trip_type === 'route' && t.route_stops) {
      weightKg = t.route_stops.reduce((sum: number, stop: any) => sum + (stop.delivery_points?.demand_kg || 0), 0);
    }

    return {
      id: `INV-${t.id.split('-')[0].toUpperCase()}`,
      date: t.updated_at,
      pickup: pickupLoc,
      drop: dropLoc,
      cargo_type: t.trip_type === 'cargo' ? 'General Goods' : 'Assigned Route',
      weight_tons: weightKg ? +(weightKg / 1000).toFixed(1) : 0,
      distance_km: distKm,
      base_pay: cost,
      bonus: 0,
      tax: 0,
      total_payout: cost,
      status: 'paid'
    };
  });

  const totalEarnings = invoices.reduce((sum, inv) => sum + inv.total_payout, 0);
  return { total_earnings: totalEarnings, completed_trips: allTrips.length, recent_invoices: invoices };
}

// Real endpoint
router.get('/driver/earnings', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.user_id;
    if (!userId || req.user?.role !== 'driver') { res.status(403).json({ detail: 'Only drivers' }); return; }
    res.json(await buildEarnings(userId));
  } catch (e: any) { sendError(req, res, e); }
});

// ── POST /invite-vendor — Superadmin creates a vendor ──
router.post('/invite-vendor', requireAuth, requireRole('superadmin'), async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ detail: 'email and password are required' });
      return;
    }

    // Create the user in Auth with role: 'vendor'
    const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { role: 'vendor' },
      user_metadata: { role: 'vendor' },
    });

    if (authError) throw authError;

    const authUserId = authUser.user!.id;

    // 1. Insert into public.users with role 'vendor'
    await supabase.from('users').upsert({
      id: authUserId,
      email: email,
      full_name: email.split('@')[0],
      role: 'vendor',
      is_active: true
    }, { onConflict: 'id' });

    // 2. Create vendor profile so they are recognized as vendor everywhere
    await supabase.from('vendor_profiles').upsert({
      id: authUserId,
      company_name: email,
      city: 'Pending',
      address: 'Pending',
      gst_number: 'PENDING',
      latitude: 0,
      longitude: 0,
      is_verified: true
    }, { onConflict: 'id' });

    res.json({ status: 'success', user_id: authUserId, message: 'Vendor created successfully' });
  } catch (e: any) {
    sendError(req, res, e);
  }
});

export default router;
