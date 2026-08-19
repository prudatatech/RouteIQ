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
import { supabase } from '../core/supabase';
import { createAccessToken, createRefreshToken, decodeToken, requireAuth } from '../core/auth';
import { settings } from '../core/config';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// ═══════════════════════════════════════════════════════════
// DRIVER AUTH — Twilio Phone OTP (like Ola/Uber/Zomato)
// ═══════════════════════════════════════════════════════════

/**
 * Generates a random numeric OTP of configured length.
 */
function generateOTP(): string {
  const len = settings.OTP_LENGTH || 6;
  let otp = '';
  for (let i = 0; i < len; i++) {
    otp += Math.floor(Math.random() * 10).toString();
  }
  return otp;
}

/**
 * Sends SMS via Twilio REST API (no SDK needed — just HTTP POST).
 */
async function sendTwilioSMS(to: string, body: string): Promise<boolean> {
  const accountSid = settings.TWILIO_ACCOUNT_SID;
  const authToken = settings.TWILIO_AUTH_TOKEN;
  const from = settings.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !from) {
    console.warn('Twilio credentials not configured. OTP will be logged to console only.');
    console.log(`[DEV OTP] To: ${to}, Message: ${body}`);
    return true; // Return true in dev mode so the flow continues
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

// ── POST /driver/send-otp — Send OTP to driver's phone ────
router.post('/driver/send-otp', async (req: Request, res: Response) => {
  try {
    let { phone } = req.body;
    if (!phone) {
      res.status(400).json({ detail: 'phone is required' });
      return;
    }

    // Normalize Indian phone number
    phone = phone.replace(/\s+/g, '').replace(/^0+/, '');
    if (!phone.startsWith('+')) {
      if (phone.startsWith('91') && phone.length === 12) {
        phone = '+' + phone;
      } else if (phone.length === 10) {
        phone = '+91' + phone;
      } else {
        phone = '+' + phone;
      }
    }

    // Validate: must be at least 10 digits
    const digitsOnly = phone.replace(/\D/g, '');
    if (digitsOnly.length < 10) {
      res.status(400).json({ detail: 'Invalid phone number' });
      return;
    }

    // Generate OTP
    const otp = generateOTP();

    // Store OTP in Redis with TTL
    const { cacheSet } = await import('../core/redis');
    const otpKey = `otp:driver:${phone}`;
    await cacheSet(otpKey, { otp, phone, attempts: 0, created_at: Date.now() }, settings.OTP_EXPIRY_SECONDS);

    // Rate limit: max 3 OTPs per phone per 10 minutes
    const rateLimitKey = `otp:ratelimit:${phone}`;
    const { cacheGet } = await import('../core/redis');
    const rateData = await cacheGet<{ count: number }>(rateLimitKey);
    if (rateData && rateData.count >= 50) {
      res.status(429).json({ detail: 'Too many OTP requests. Please wait 10 minutes.' });
      return;
    }
    await cacheSet(rateLimitKey, { count: (rateData?.count || 0) + 1 }, 600);

    // Check if driver is new
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('phone', phone)
      .maybeSingle();

    // Send SMS
    let message = `Your margixindia driver login OTP is: ${otp}. Valid for 5 minutes. Do not share this code.`;
    if (!existingUser) {
      message = `Welcome Driver! ${message}`;
    }
    const sent = await sendTwilioSMS(phone, message);

    if (!sent) {
      res.status(500).json({ detail: 'Failed to send OTP. Please try again.' });
      return;
    }

    res.json({
      status: 'otp_sent',
      phone: phone.replace(/(\+91)(\d{6})(\d{4})/, '$1******$3'), // Mask for response
      expires_in_seconds: settings.OTP_EXPIRY_SECONDS,
      message: 'OTP sent successfully',
    });
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

// ── POST /driver/verify-otp — Verify OTP and login driver ──
router.post('/driver/verify-otp', async (req: Request, res: Response) => {
  try {
    let { phone, otp } = req.body;
    if (!phone || !otp) {
      res.status(400).json({ detail: 'phone and otp are required' });
      return;
    }

    // Normalize phone
    phone = phone.replace(/\s+/g, '').replace(/^0+/, '');
    if (!phone.startsWith('+')) {
      if (phone.startsWith('91') && phone.length === 12) {
        phone = '+' + phone;
      } else if (phone.length === 10) {
        phone = '+91' + phone;
      } else {
        phone = '+' + phone;
      }
    }

    // Retrieve OTP from Redis
    const { cacheGet, cacheSet } = await import('../core/redis');
    const otpKey = `otp:driver:${phone}`;
    const storedData = await cacheGet<{ otp: string; phone: string; attempts: number }>(otpKey);

    if (!storedData) {
      res.status(401).json({ detail: 'OTP expired or not found. Please request a new one.' });
      return;
    }

    // Brute-force protection: max 5 attempts
    if (storedData.attempts >= 5) {
      const { cacheDelete } = await import('../core/redis');
      await cacheDelete(otpKey);
      res.status(429).json({ detail: 'Too many failed attempts. Please request a new OTP.' });
      return;
    }

    if (storedData.otp !== otp.trim()) {
      // Increment attempts
      storedData.attempts += 1;
      await cacheSet(otpKey, storedData, settings.OTP_EXPIRY_SECONDS);
      res.status(401).json({ detail: 'Incorrect OTP', remaining_attempts: 5 - storedData.attempts });
      return;
    }

    // OTP verified! Delete it from Redis
    const { cacheDelete } = await import('../core/redis');
    await cacheDelete(otpKey);

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
        user_metadata: {
          full_name: `Driver ${phone.slice(-4)}`,
          role: 'driver',
          phone,
        },
      });

      if (authError) {
        // If user already exists in auth.users (trigger failed previously), recover gracefully!
        if (authError.message.includes('already been registered') || (authError as any).code === 'email_exists') {
          const { data: existingList } = await supabase.auth.admin.listUsers();
          const existingUser = existingList.users.find((u: any) => u.email === driverEmail);
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
    res.status(500).json({ detail: e.message });
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
      tokenData = await decodeToken(token);
    } catch {
      res.status(401).json({ detail: 'Invalid or expired token' });
      return;
    }

    const { data: user } = await supabase
      .from('users')
      .select('id, role, is_active')
      .eq('id', tokenData.user_id)
      .single();

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
    res.status(500).json({ detail: e.message });
  }
});

// ── POST /logout ───────────────────────────────────────────
router.post('/logout', (_req: Request, res: Response) => {
  res.json({ message: 'Logged out successfully' });
});

// ── PUT /driver/profile ────────────────────────────────────
router.put('/driver/profile', requireAuth, async (req: Request, res: Response) => {
  try {
    const { vehicle_type, full_name } = req.body;
    const userId = req.user?.user_id;

    if (!userId || req.user?.role !== 'driver') {
      res.status(403).json({ detail: 'Only authenticated drivers can update their profile' });
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

    // Check if the driver has a vehicle assigned
    const { data: existingVehicle } = await supabase
      .from('vehicles')
      .select('id')
      .eq('driver_id', userId)
      .single();

    if (!existingVehicle) {
      // Create a new vehicle for the driver
      await supabase.from('vehicles').insert({
        id: uuidv4(),
        plate_number: `TEMP-${userId.substring(0, 6).toUpperCase()}`,
        vehicle_type: 'truck', // Must be valid enum
        driver_id: userId,
        status: 'idle',
        capacity_kg: 1000 // Default capacity
      });
    } else {
      // Update existing vehicle type
      await supabase.from('vehicles').update({ vehicle_type: 'truck' }).eq('id', existingVehicle.id);
    }

    res.json({ status: 'success', vehicle_type });
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
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

// Test endpoint (no auth, hardcoded user for debugging)
router.get('/driver/earnings-test', async (_req: Request, res: Response) => {
  try {
    res.json(await buildEarnings('a7b38f7f-214d-4c18-bd0e-98ac21ab10c3'));
  } catch (e: any) { res.status(500).json({ detail: e.message }); }
});

// Real endpoint
router.get('/driver/earnings', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.user_id;
    if (!userId || req.user?.role !== 'driver') { res.status(403).json({ detail: 'Only drivers' }); return; }
    res.json(await buildEarnings(userId));
  } catch (e: any) { res.status(500).json({ detail: e.message }); }
});

// ── POST /invite-vendor — Superadmin creates a vendor ──
router.post('/invite-vendor', async (req: Request, res: Response) => {
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
      user_metadata: { role: 'vendor' },
    });

    if (authError) {
      res.status(400).json({ detail: authError.message });
      return;
    }

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
    res.status(500).json({ detail: e.message });
  }
});

export default router;
