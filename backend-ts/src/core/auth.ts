/**
 * margixindia — Auth middleware
 *
 * Two token sources are accepted, each verified by signature:
 *
 * 1. Supabase Auth (web app). The project signs user tokens with an
 *    asymmetric key (ES256); they are verified against the project's
 *    public JWKS. Legacy HS256 Supabase tokens (iss = <SUPABASE_URL>/auth/v1)
 *    are verified with SUPABASE_JWT_SECRET. The app role is always read
 *    from the database — `user_metadata` is user-editable and never trusted.
 *
 * 2. Backend-issued tokens (driver/customer phone OTP). HS256, signed with
 *    the backend secret. The role in these tokens was set by this server.
 */
import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import jwt, { JwtHeader, JwtPayload, SignOptions } from 'jsonwebtoken';
import { settings } from './config';
import { supabase } from './supabase';

// ── Types ──────────────────────────────────────────────────

export type TokenSource = 'supabase' | 'backend';

export interface TokenData {
  user_id: string;
  role: string;
  source: TokenSource;
}

interface VerifiedToken {
  payload: JwtPayload;
  source: TokenSource;
}

// Extend Express Request to carry auth data
declare global {
  namespace Express {
    interface Request {
      user?: TokenData;
    }
  }
}

export const BACKEND_TOKEN_ISSUER = 'margix-backend';

const SECRET_PLACEHOLDERS = new Set(['', 'YOUR_SUPABASE_JWT_SECRET_HERE', 'temporary_secret_key_for_setup']);

/**
 * Secret used to sign and verify backend-issued tokens.
 * Kept identical to the previous resolution order so existing driver and
 * customer sessions stay valid.
 */
export function getBackendSecret(): string {
  if (!SECRET_PLACEHOLDERS.has(settings.SUPABASE_JWT_SECRET)) return settings.SUPABASE_JWT_SECRET;
  if (!SECRET_PLACEHOLDERS.has(settings.SECRET_KEY)) return settings.SECRET_KEY;
  return '';
}

function supabaseIssuer(): string {
  return `${settings.SUPABASE_URL.replace(/\/+$/, '')}/auth/v1`;
}

// ── Token issuance (backend) ───────────────────────────────

function signBackendToken(data: { sub: string; role: string }, type: 'access' | 'refresh', expiresIn: SignOptions['expiresIn']): string {
  const secret = getBackendSecret();
  if (!secret) throw new Error('Backend JWT secret is not configured');
  const payload = {
    ...data,
    aud: 'authenticated',
    user_metadata: { role: data.role },
    type,
  };
  // A refresh token is unique, so revoking one at logout never revokes another issued in the same second
  const jwtid = type === 'refresh' ? crypto.randomUUID() : undefined;
  return jwt.sign(payload, secret, { algorithm: 'HS256', expiresIn, issuer: BACKEND_TOKEN_ISSUER, ...(jwtid ? { jwtid } : {}) });
}

/** Access token for phone-OTP users (drivers, customers). */
export function createAccessToken(data: { sub: string; role: string }): string {
  return signBackendToken(data, 'access', settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60);
}

/** Refresh token for phone-OTP users (drivers, customers). */
export function createRefreshToken(data: { sub: string; role: string }): string {
  return signBackendToken(data, 'refresh', settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60);
}

// ── Supabase JWKS (asymmetric signing keys) ────────────────

const JWKS_TTL_MS = 10 * 60 * 1000;
const JWKS_MIN_REFRESH_MS = 30 * 1000;
let jwksCache: { keys: Map<string, crypto.KeyObject>; fetchedAt: number } | null = null;
let jwksInflight: Promise<void> | null = null;

async function refreshJwks(): Promise<void> {
  if (!settings.SUPABASE_URL) throw new Error('SUPABASE_URL is not configured');
  const res = await fetch(`${supabaseIssuer()}/.well-known/jwks.json`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`JWKS fetch failed with status ${res.status}`);
  const body = (await res.json()) as { keys?: Array<crypto.JsonWebKey & { kid?: string }> };
  const keys = new Map<string, crypto.KeyObject>();
  for (const jwk of body.keys ?? []) {
    if (!jwk.kid) continue;
    keys.set(jwk.kid, crypto.createPublicKey({ key: jwk, format: 'jwk' }));
  }
  jwksCache = { keys, fetchedAt: Date.now() };
}

async function getSigningKey(kid: string): Promise<crypto.KeyObject | undefined> {
  const age = jwksCache ? Date.now() - jwksCache.fetchedAt : Infinity;
  const known = jwksCache?.keys.get(kid);
  // Refetch when the cache is stale, or when an unknown kid appears (key rotation),
  // but never more often than JWKS_MIN_REFRESH_MS.
  if (age > JWKS_TTL_MS || (!known && age > JWKS_MIN_REFRESH_MS)) {
    jwksInflight ??= refreshJwks().finally(() => { jwksInflight = null; });
    try {
      await jwksInflight;
    } catch (e: any) {
      console.error(`[Auth] ${e.message}`);
    }
  }
  return jwksCache?.keys.get(kid);
}

// ── Verification ───────────────────────────────────────────

class AuthError extends Error {}

/**
 * Verify a token's signature and classify its source.
 * Throws AuthError for anything that is not a valid, signed token.
 */
async function verifyToken(token: string): Promise<VerifiedToken> {
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || typeof decoded.payload === 'string') throw new AuthError('Malformed token');
  const header = decoded.header as JwtHeader;

  let payload: JwtPayload;
  let source: TokenSource;

  if (header.alg === 'ES256' || header.alg === 'RS256') {
    if (!header.kid) throw new AuthError('Token has no key id');
    const key = await getSigningKey(header.kid);
    if (!key) throw new AuthError('Unknown signing key');
    payload = jwt.verify(token, key, {
      algorithms: [header.alg],
      issuer: supabaseIssuer(),
      audience: 'authenticated',
    }) as JwtPayload;
    source = 'supabase';
  } else if (header.alg === 'HS256') {
    const secret = getBackendSecret();
    if (!secret) throw new AuthError('Token secret not configured');
    payload = jwt.verify(token, secret, { algorithms: ['HS256'] }) as JwtPayload;

    if (settings.SUPABASE_URL && payload.iss === supabaseIssuer()) {
      // Legacy HS256 Supabase user token (only when SUPABASE_JWT_SECRET is the project's legacy secret)
      source = 'supabase';
    } else if (payload.iss === BACKEND_TOKEN_ISSUER || (payload.iss === undefined && typeof payload.type === 'string')) {
      // Backend-issued. Tokens minted before `iss` was added carry only `type`.
      source = 'backend';
    } else {
      throw new AuthError('Unrecognised token issuer');
    }
  } else {
    throw new AuthError('Unsupported token algorithm');
  }

  if (typeof payload.sub !== 'string' || !payload.sub) throw new AuthError('Token has no subject');
  return { payload, source };
}

// ── Role resolution ────────────────────────────────────────

const ROLE_CACHE_TTL_MS = 60 * 1000;
const roleCache = new Map<string, { role: string; expiresAt: number }>();

/** Drop a cached role, e.g. after an admin changes a user's role or status. */
export function invalidateRoleCache(userId: string): void {
  roleCache.delete(userId);
  activeCache.delete(userId);
}

const activeCache = new Map<string, { active: boolean; expiresAt: number }>();

/**
 * Backend-issued tokens (drivers) live for their whole lifetime once minted, so
 * a driver suspended after signing in would keep working. Look the account up
 * (cached 60s) and reject it when it is switched off. A token whose user has no
 * `users` row (customers, who live in their own table) is left alone.
 */
async function assertBackendUserActive(userId: string): Promise<void> {
  const cached = activeCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    if (!cached.active) throw new AuthError('Account is inactive');
    return;
  }
  const { data, error } = await supabase.from('users').select('is_active').eq('id', userId).maybeSingle();
  if (error) throw new Error(`Account lookup failed: ${error.message}`);
  const active = data?.is_active !== false;
  activeCache.set(userId, { active, expiresAt: Date.now() + ROLE_CACHE_TTL_MS });
  if (!active) throw new AuthError('Account is inactive');
}

/**
 * App role of a Supabase Auth user, from the database.
 * Mirrors the web app: `users.role`, except that a non-admin with a vendor
 * profile or 3PL partner record acts as a vendor.
 */
async function resolveSupabaseRole(userId: string): Promise<string> {
  const cached = roleCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.role;

  const [userRes, vendorRes, tplRes] = await Promise.all([
    supabase.from('users').select('role, is_active').eq('id', userId).maybeSingle(),
    supabase.from('vendor_profiles').select('id').eq('id', userId).maybeSingle(),
    supabase.from('tpl_partners').select('id').eq('user_id', userId).maybeSingle(),
  ]);
  if (userRes.error) throw new Error(`Role lookup failed: ${userRes.error.message}`);

  const user = userRes.data;
  if (user && user.is_active === false) throw new AuthError('Account is inactive');

  const isVendor = Boolean(vendorRes.data || tplRes.data);
  let role: string | undefined = user?.role;
  if (role !== 'admin' && role !== 'superadmin' && isVendor) role = 'vendor';
  if (!role) throw new AuthError('No role assigned to this account');

  roleCache.set(userId, { role, expiresAt: Date.now() + ROLE_CACHE_TTL_MS });
  return role;
}

function backendTokenRole(payload: JwtPayload): string {
  const role = payload.user_metadata?.role ?? payload.role;
  if (typeof role !== 'string' || !role || role === 'authenticated') throw new AuthError('Token has no role');
  return role;
}

/**
 * Verify a token and resolve the caller.
 * `expectedType` applies to backend-issued tokens: middleware accepts only
 * access tokens, the refresh endpoint only refresh tokens.
 */
export async function authenticateToken(token: string, expectedType: 'access' | 'refresh' = 'access'): Promise<TokenData> {
  const { payload, source } = await verifyToken(token);
  const userId = payload.sub as string;

  if (source === 'backend') {
    if (payload.type !== expectedType) throw new AuthError(`Expected a ${expectedType} token`);
    const role = backendTokenRole(payload);
    if (expectedType === 'access' && role !== 'customer') await assertBackendUserActive(userId);
    return { user_id: userId, role, source };
  }

  if (expectedType !== 'access') throw new AuthError('Supabase sessions are refreshed by Supabase');
  return { user_id: userId, role: await resolveSupabaseRole(userId), source };
}

// ── Middleware ──────────────────────────────────────────────

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  return header && header.startsWith('Bearer ') ? header.slice(7) : null;
}

/**
 * Verifies the Bearer token and attaches `req.user`.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = bearerToken(req);
  if (!token) {
    res.status(401).json({ detail: 'Missing or invalid Authorization header' });
    return;
  }

  try {
    req.user = await authenticateToken(token);
    next();
  } catch (err) {
    if (err instanceof AuthError || err instanceof jwt.JsonWebTokenError) {
      res.status(401).json({ detail: 'Invalid or expired token' });
      return;
    }
    console.error('[Auth] Verification error:', err);
    res.status(503).json({ detail: 'Authentication temporarily unavailable' });
  }
}

/**
 * Like requireAuth but does not reject unauthenticated requests.
 * A valid Bearer token sets req.user; otherwise the request continues anonymously.
 */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = bearerToken(req);
  if (token) {
    try {
      req.user = await authenticateToken(token);
    } catch {
      // Treat as unauthenticated
    }
  }
  next();
}

/**
 * Role-based access control middleware factory.
 * Superadmin always passes.
 */
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // requireAuth must run first
    if (!req.user) {
      res.status(401).json({ detail: 'Authentication required' });
      return;
    }

    if (req.user.role === 'superadmin' || roles.includes(req.user.role)) {
      next();
      return;
    }

    res.status(403).json({ detail: 'Not authorized for this action' });
  };
}
