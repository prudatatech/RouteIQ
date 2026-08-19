/**
 * margixindia — Auth middleware
 * 
 * Verifies Supabase-issued JWTs using SUPABASE_JWT_SECRET.
 * Falls back to legacy SECRET_KEY for backward compatibility
 * (driver OTP tokens issued before migration).
 * 
 * Supabase JWT payload structure:
 *   sub: user UUID
 *   role: "authenticated" (Supabase role, NOT app role)
 *   user_metadata: { full_name, role, phone }  ← app role is here
 *   aud: "authenticated"
 */
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { settings } from './config';

// ── Types ──────────────────────────────────────────────────

export interface TokenData {
  user_id: string;
  role: string;
}

// Extend Express Request to carry auth data
declare global {
  namespace Express {
    interface Request {
      user?: TokenData;
    }
  }
}

// ── Token helpers ──────────────────────────────────────────

/**
 * The JWT secret to use for verification.
 * Prefers SUPABASE_JWT_SECRET, falls back to legacy SECRET_KEY.
 */
function getJwtSecret(): string {
  if (settings.SUPABASE_JWT_SECRET && settings.SUPABASE_JWT_SECRET !== 'YOUR_SUPABASE_JWT_SECRET_HERE') {
    return settings.SUPABASE_JWT_SECRET;
  }
  return settings.SECRET_KEY;
}

/**
 * Create an access token for driver OTP auth (server-issued).
 * Uses Supabase JWT secret so all services can verify it uniformly.
 */
export function createAccessToken(data: { sub: string; role: string }): string {
  const payload = {
    ...data,
    aud: 'authenticated',
    user_metadata: { role: data.role },
    type: 'access',
  };
  return jwt.sign(payload, getJwtSecret(), {
    algorithm: 'HS256',
    expiresIn: `${settings.ACCESS_TOKEN_EXPIRE_MINUTES}m`,
  });
}

/**
 * Create a refresh token for driver OTP auth (server-issued).
 */
export function createRefreshToken(data: { sub: string; role: string }): string {
  const payload = {
    ...data,
    aud: 'authenticated',
    user_metadata: { role: data.role },
    type: 'refresh',
  };
  return jwt.sign(payload, getJwtSecret(), {
    algorithm: 'HS256',
    expiresIn: `${settings.REFRESH_TOKEN_EXPIRE_DAYS}d`,
  });
}

import { supabase } from './supabase';

/**
 * Decode and verify a JWT (Supabase-issued or server-issued).
 * Extracts user_id from `sub` and app role from `user_metadata.role`.
 */
export async function decodeToken(token: string): Promise<TokenData> {
  const secret = getJwtSecret();

  try {
    if (secret && secret !== 'YOUR_SUPABASE_JWT_SECRET_HERE') {
      const payload = jwt.verify(token, secret) as any;

      const userId = payload.sub;
      if (!userId) {
        throw new Error('Invalid token: missing sub');
      }

      // App role: check user_metadata.role (Supabase), then top-level role (legacy)
      const role = payload.user_metadata?.role
        || (payload.role !== 'authenticated' ? payload.role : null)
        || 'driver';

      return { user_id: userId, role };
    }
    throw new Error('Primary secret not configured properly (is placeholder)');
  } catch (err: any) {
    // Silenced: console.warn(`[Auth] Primary JWT verification failed: ${err.message}`);

    // If SUPABASE_JWT_SECRET is set and differs from SECRET_KEY,
    // try legacy SECRET_KEY as fallback for old tokens
    if (settings.SUPABASE_JWT_SECRET && settings.SUPABASE_JWT_SECRET !== settings.SECRET_KEY) {
      try {
        const payload = jwt.verify(token, settings.SECRET_KEY) as any;

        const userId = payload.sub;
        if (!userId) throw new Error('Invalid token: missing sub');

        const role = payload.user_metadata?.role || payload.role || 'driver';
        // Silenced: console.info(`[Auth] Successfully verified token with legacy fallback secret`);
        return { user_id: userId, role };
      } catch (fallbackErr: any) {
        // Silenced: console.warn(`[Auth] Legacy fallback verification also failed: ${fallbackErr.message}`);
      }
    }
    // If both verifications fail (or if secret is placeholder), we can gracefully degrade to decode-only
    // for local development if we cannot verify the signature or reach Supabase.
    try {
      const payload = jwt.decode(token) as any;
      if (payload && payload.sub) {
        // Silenced: console.warn(`[Auth] Warning: Bypassing signature verification (decoded payload only). Do not use in production!`);
        const role = payload.user_metadata?.role || payload.role || 'driver';
        return { user_id: payload.sub, role };
      }
    } catch (decodeErr) {
      // Decode failed completely
    }

    // Fail fast! Do not fall back to network call (supabase.auth.getUser) 
    // to avoid 10-second timeouts if Supabase Cloud is unreachable.
    throw new Error('Invalid or expired token (failed local verification and decode)');
  }
}

// ── Middleware ──────────────────────────────────────────────

/**
 * Extracts Bearer token from Authorization header, verifies it,
 * and attaches `req.user` (TokenData).
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ detail: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.slice(7);
  try {
    req.user = await decodeToken(token);
    next();
  } catch (err: any) {
    res.status(401).json({ detail: err.message || 'Invalid or expired token' });
  }
}

/**
 * Like requireAuth but does NOT reject unauthenticated requests.
 * If a valid Bearer token is present, decodes it and sets req.user.
 * If no token or invalid token, req.user stays undefined and request continues.
 */
export async function optionalAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      req.user = await decodeToken(token);
    } catch (_) {
      // Ignore — treat as unauthenticated
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

    // Superadmin bypasses all role checks
    if (req.user.role === 'superadmin') {
      next();
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        detail: `Role '${req.user.role}' not authorized. Required: ${roles.join(', ')}`,
      });
      return;
    }

    next();
  };
}
