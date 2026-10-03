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
import { HttpError, sendError } from '../core/errors';
import { normalizeIndianMobile, normalizePhone } from '../utils/phone';
import { findAuthUserByEmail } from '../core/auth-users';
import { loadMemberships } from '../core/org-context';
import { buildEarnings } from '../services/driver-pay.service';
import { getPayoutAccount } from '../services/people-bank.service';
import { sendSms, smsConfigured } from '../services/sms.service';
import { notificationService } from '../services/notification.service';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { carrierStamp } from '../core/org-context';

const router = Router();

// ═══════════════════════════════════════════════════════════
// DRIVER AUTH — Twilio Phone OTP (like Ola/Uber/Zomato)
// ═══════════════════════════════════════════════════════════

type OtpKind = 'driver' | 'customer' | 'vendor';
const OTP_KIND_LABEL: Record<OtpKind, string> = { driver: 'Driver', customer: 'Customer', vendor: 'Vendor' };

const OTP_MAX_ATTEMPTS = 5;            // wrong guesses per issued code
const OTP_SENDS_PER_WINDOW = 3;        // codes per phone per 10 minutes
const OTP_FAILURES_PER_HOUR = 10;      // wrong guesses per phone per hour, across resends

/** Random numeric OTP of the configured length (4–8 digits). */
function generateOTP(): string {
  const len = Math.min(Math.max(settings.OTP_LENGTH || 6, 4), 8);
  return crypto.randomInt(0, 10 ** len).toString().padStart(len, '0');
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
    const phone = kind === 'vendor' ? normalizeIndianMobile(req.body.phone) : normalizePhone(req.body.phone);
    if (!phone) {
      res.status(400).json({ detail: 'Invalid phone number' });
      return;
    }
    const useEmail = kind === 'vendor' && !!req.body.email;
    const email = req.body.email;

    if (!useEmail && !smsConfigured() && settings.isProduction) {
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
      .from(kind === 'customer' ? 'customers' : 'users')
      .select('id')
      .eq('phone', phone)
      .maybeSingle();

    let message = `Your margixindia ${kind} login OTP is: ${otp}. Valid for ${Math.round(settings.OTP_EXPIRY_SECONDS / 60)} minutes. Do not share this code.`;
    if (!existing) message = `Welcome ${OTP_KIND_LABEL[kind]}! ${message}`;

    if (useEmail) {
      const { emailService } = await import('../services/email.service');
      const html = `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; background-color: #ffffff; padding: 32px; border: 1px solid #f0f0f0; border-top: 4px solid #facc15; border-radius: 8px; text-align: center;">
          <img src="https://staging.margixindia.com/margix-logo.png" alt="MargixIndia Logo" style="height: 48px; margin-bottom: 24px;" />
          <h1 style="font-size: 20px; font-weight: 600; color: #111827; margin: 0 0 8px 0;">Welcome Partner!</h1>
          <p style="font-size: 15px; color: #4b5563; margin: 0 0 24px 0; line-height: 1.5;">Let's post your loads and manage them with premium logistics market</p>
          <div style="background-color: #fefce8; border: 1px dashed #facc15; border-radius: 6px; padding: 16px; margin-bottom: 24px;">
            <p style="font-size: 32px; font-weight: bold; letter-spacing: 4px; color: #854d0e; margin: 0;">${otp}</p>
          </div>
          <p style="font-size: 13px; color: #6b7280; margin: 0;">Valid for ${Math.round(settings.OTP_EXPIRY_SECONDS / 60)} minutes. Please do not share this code.</p>
        </div>
      `;
      if (!(await emailService.send(email, 'Your MargixIndia OTP', html))) {
        await cacheDelete(`otp:${kind}:${phone}`);
        res.status(502).json({ detail: 'Failed to send OTP email. Please try again.' });
        return;
      }
    } else {
      if (!(await sendSms(phone, message))) {
        await cacheDelete(`otp:${kind}:${phone}`);
        res.status(502).json({ detail: 'Failed to send OTP. Please try again.' });
        return;
      }
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

/** The number is already held by an account of another kind than the one signing in (staff, driver, 3PL partner, or a vendor). */
const NUMBER_TAKEN: Record<'driver' | 'vendor', string> = {
  driver: 'This number belongs to another account',
  vendor: 'This number belongs to a company or partner account',
};

/**
 * Whether the phone number belongs to an account that is not a plain `role` account: a users row of another role, or,
 * for a vendor number, a vendor row that is a 3PL partner or a member of a company, 3PL or platform organisation.
 * Phone sign-in must never open such an account, nor change its role.
 */
async function phoneBelongsToOtherKind(role: 'driver' | 'vendor', phone: string): Promise<boolean> {
  const variants = [phone, phone.replace(/^\+/, ''), phone.replace(/^\+91/, '')];
  const { data: others, error } = await supabase.from('users').select('id, role').in('phone', variants).neq('role', role).limit(1);
  if (error) throw new HttpError(500, 'Could not check this number. Try again.');
  if ((others ?? []).length > 0) return true;
  if (role !== 'vendor') return false;
  const { data: same } = await supabase.from('users').select('id').in('phone', variants).eq('role', 'vendor');
  for (const { id } of (same ?? []) as { id: string }[]) {
    const { data: partner } = await supabase.from('tpl_partners').select('id').eq('user_id', id).limit(1);
    if ((partner ?? []).length > 0) return true;
    const memberships = await loadMemberships(id);
    if (memberships.some(m => m.org.kind !== 'vendor')) return true;
  }
  return false;
}

/**
 * The account of a phone number that just proved it (driver or vendor): creates the Supabase auth user with the role
 * in app_metadata, recovers one that exists already, and guarantees the public.users row (the vendor organisation is
 * made by the users trigger). Throws an HttpError 500 when the account cannot be made.
 */
async function provisionPhoneUser(role: 'driver' | 'vendor', phone: string, emailStr?: string): Promise<{ id: string; email: string }> {
  const email = emailStr || `${role}_${phone.replace(/\+/g, '')}@${role}.margixindia.local`;
  const fullName = `${OTP_KIND_LABEL[role]} ${phone.slice(-4)}`;
  const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
    email,
    email_confirm: true,
    app_metadata: { role },
    user_metadata: { full_name: fullName, role, phone },
  });

  let id: string;
  if (authError) {
    // The auth user may exist already (the profile trigger failed earlier): recover it
    if (authError.message.includes('already been registered') || (authError as any).code === 'email_exists') {
      const existing = await findAuthUserByEmail(email);
      if (!existing) throw new HttpError(500, `Failed to recover existing ${role} account`);
      id = existing.id;
      // Never change the role of an account that already exists
      const { data: row } = await supabase.from('users').select('role').eq('id', id).maybeSingle();
      if (row?.role && row.role !== role) throw new HttpError(403, NUMBER_TAKEN[role]);
    } else {
      console.error(`Failed to create auth user for ${role}:`, authError);
      throw new HttpError(500, `Failed to create ${role} account`);
    }
  } else {
    id = authUser.user!.id;
  }

  // Guarantee the public profile exists via manual upsert (bypassing trigger unreliability)
  const { error } = await supabase.from('users').upsert({ id, email, phone, role, full_name: fullName }, { onConflict: 'id' });
  if (error) console.error(`[auth] Failed to upsert ${role} profile:`, error.message);
  return { id, email };
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

    if (!driver) {
      if (await phoneBelongsToOtherKind('driver', phone)) {
        res.status(403).json({ detail: NUMBER_TAKEN.driver });
        return;
      }
      let authUserId: string;
      try {
        authUserId = (await provisionPhoneUser('driver', phone)).id;
      } catch (e) {
        if (e instanceof HttpError) { res.status(e.status).json({ detail: e.message }); return; }
        throw e;
      }

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

      // Staff hear about every new driver once. A failed notice never blocks the sign-in.
      notificationService
        .notifyStaffOnce('New driver signed up', `${newDriver.full_name ?? 'A new driver'} (${phone}) signed up. Review their profile and documents.`, 'driver_signed_up', { user_id: newDriver.id }, 'user_id')
        .catch(e => console.error('[auth] new driver notification failed:', e));
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

// ═══════════════════════════════════════════════════════════
// VENDOR AUTH — Phone OTP for the web "Post a load" flow
// ═══════════════════════════════════════════════════════════

// ── POST /vendor/send-otp — Send OTP to the vendor's phone ──
router.post('/vendor/send-otp', rateLimitByIp('otp-send', 10, 3600), (req: Request, res: Response) => sendOtp('vendor', req, res));

// ── POST /vendor/verify-otp — Verify OTP, find or create the vendor, return a Supabase session ──
// The web calls supabase.auth.setSession({ access_token, refresh_token }) with `session`. The vendor's organisation is
// made by the users trigger; the business profile and KYC come after sign-in.
router.post('/vendor/verify-otp', rateLimitByIp('otp-verify', 30, 3600), async (req: Request, res: Response) => {
  try {
    const phone = normalizeIndianMobile(req.body.phone);
    const email = req.body.email;
    if (!phone) {
      res.status(400).json({ detail: 'phone and otp are required' });
      return;
    }
    if (!(await verifyOtp('vendor', phone, req.body.otp, res))) return;

    // A company, staff, driver or 3PL number is not a vendor's: refuse before anything is created or signed in
    try {
      if (await phoneBelongsToOtherKind('vendor', phone)) {
        res.status(403).json({ detail: NUMBER_TAKEN.vendor });
        return;
      }
    } catch (e) {
      if (e instanceof HttpError) { res.status(e.status).json({ detail: e.message }); return; }
      throw e;
    }
    let { data: vendor } = await supabase.from('users').select('*').eq('phone', phone).eq('role', 'vendor').maybeSingle();
    let isNew = false;
    if (!vendor) {
      let id: string;
      try {
        id = (await provisionPhoneUser('vendor', phone, email)).id;
      } catch (e) {
        if (e instanceof HttpError) { res.status(e.status).json({ detail: e.message }); return; }
        throw e;
      }
      const { data: created } = await supabase.from('users').select('*').eq('id', id).maybeSingle();
      if (!created) {
        res.status(500).json({ detail: 'Failed to create vendor profile' });
        return;
      }
      vendor = created;
      isNew = true;
    }
    if (vendor.is_active === false) {
      res.status(403).json({ detail: 'This account is disabled. Contact support.' });
      return;
    }

    await supabase.from('users').update({ last_login: new Date().toISOString() }).eq('id', vendor.id);
    const { data: authUser } = await supabase.auth.admin.getUserById(vendor.id);
    const session = await createSupabaseSession(authUser?.user?.email ?? vendor.email);
    if (!session) {
      res.status(502).json({ detail: 'Could not start your session. Please try again.' });
      return;
    }

    res.json({
      status: 'authenticated',
      role: 'vendor',
      user_id: vendor.id,
      is_new_user: isNew,
      session,
      vendor: { id: vendor.id, phone: vendor.phone, full_name: vendor.full_name },
    });
  } catch (e: any) {
    sendError(req, res, e);
  }
});

/** Cache key of a revoked refresh token: its hash, never the token itself. */
const revokedKey = (token: string) => `revoked-refresh:${crypto.createHash('sha256').update(token).digest('hex')}`;

// ── POST /refresh ──────────────────────────────────────────
router.post('/refresh', rateLimitByIp('refresh', 60, 600), async (req: Request, res: Response) => {
  try {
    const token = req.body.refresh_token;
    if (!token || typeof token !== 'string') {
      res.status(400).json({ detail: 'refresh_token required' });
      return;
    }
    // A refresh token revoked by logout is refused for the rest of its life
    if (await cacheGet(revokedKey(token))) {
      res.status(401).json({ detail: 'Invalid or expired token' });
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
// Access tokens are stateless and stay valid until they expire (minutes). When the client sends its
// refresh token, that token is revoked in the shared cache (Redis; per process when Redis is not
// configured) so a stolen copy cannot mint new tokens. See docs/security-notes.md.
router.post('/logout', async (req: Request, res: Response) => {
  try {
    const token = req.body?.refresh_token;
    if (typeof token === 'string' && token) {
      // Only a genuine, unexpired refresh token is stored; anything else is ignored
      await authenticateToken(token, 'refresh')
        .then(() => cacheSet(revokedKey(token), 1, settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60))
        .catch(() => undefined);
    }
    res.json({ message: 'Logged out successfully' });
  } catch (e: any) {
    sendError(req, res, e);
  }
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

    if (vehicle_type !== undefined && (typeof vehicle_type !== 'string' || !vehicle_type.trim() || vehicle_type.length > 60)) {
      res.status(400).json({ detail: 'vehicle_type must be a name of up to 60 characters' });
      return;
    }
    if (full_name !== undefined && (typeof full_name !== 'string' || full_name.length > 100)) {
      res.status(400).json({ detail: 'full_name must be a name of up to 100 characters' });
      return;
    }

    const updates: any = {};
    if (vehicle_type) updates.vehicle_type = vehicle_type;
    // Names are kept trimmed ("Vishal " and "Vishal" are one name)
    if (typeof full_name === 'string' && full_name.trim()) updates.full_name = full_name.trim();

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
    // (a driver has one live vehicle: the unique index on driver_id, see
    // migration 20260930009400; first() so a leftover duplicate can never make this "none")
    const { data: existingRows } = await supabase
      .from('vehicles')
      .select('id')
      .eq('driver_id', userId)
      .neq('status', 'archived')
      .limit(1);
    const existingVehicle = existingRows?.[0];

    if (!existingVehicle) {
      // Create a new vehicle for the driver
      const { error: insertErr } = await supabase.from('vehicles').insert({
        ...carrierStamp(),
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

// Real endpoint
router.get('/driver/earnings', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.user_id;
    if (!userId || req.user?.role !== 'driver') { res.status(403).json({ detail: 'Only drivers' }); return; }
    res.json({ ...(await buildEarnings(userId)), payout_account: await getPayoutAccount(userId) });
  } catch (e: any) { sendError(req, res, e); }
});

const HISTORY_DEFAULT_LIMIT = 20;
const HISTORY_MAX_LIMIT = 100;

// Full, paginated trip/earnings history with an optional date range.
router.get('/driver/earnings/history', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.user_id;
    if (!userId || req.user?.role !== 'driver') { res.status(403).json({ detail: 'Only drivers' }); return; }

    const rawLimit = Number(req.query.limit);
    const rawOffset = Number(req.query.offset);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), HISTORY_MAX_LIMIT) : HISTORY_DEFAULT_LIMIT;
    const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? Math.floor(rawOffset) : 0;
    const from = typeof req.query.from === 'string' && req.query.from ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' && req.query.to ? req.query.to : undefined;

    const { total_earnings, completed_trips, recent_invoices } = await buildEarnings(userId, { from, to });
    const page = recent_invoices.slice(offset, offset + limit);

    res.json({
      invoices: page,
      total: completed_trips,
      total_earnings,
      limit,
      offset,
      has_more: offset + page.length < completed_trips,
      payout_account: await getPayoutAccount(userId),
    });
  } catch (e: any) { sendError(req, res, e); }
});

// ── POST /invite-vendor — Superadmin creates a vendor ──
router.post('/invite-vendor', requireAuth, requireRole('superadmin'), async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
      res.status(400).json({ detail: 'email and password are required' });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.length > 254) {
      res.status(400).json({ detail: 'Enter a valid email address' });
      return;
    }
    if (password.length < 10 || password.length > 128) {
      res.status(400).json({ detail: 'Password must be between 10 and 128 characters' });
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
