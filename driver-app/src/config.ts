/**
 * Runtime configuration, read from EXPO_PUBLIC_* environment variables.
 *
 * Expo inlines `process.env.EXPO_PUBLIC_*` into the bundle at build time, so
 * each variable must be referenced literally (no dynamic `process.env[name]`).
 * Set them in driver-app/.env for local development (see .env.example) and as
 * EAS environment variables for builds and updates. There are deliberately no
 * fallbacks: a build without configuration fails at startup instead of
 * silently talking to the wrong backend.
 */

function required(name: string, value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(
      `[config] Missing required environment variable ${name}. ` +
        'Set it in driver-app/.env (see .env.example) or in the EAS environment for this build.'
    );
  }
  return trimmed;
}

/**
 * Refuse to start with a privileged Supabase key. The app must only ever carry
 * the public anon (publishable) key; row-level security does the rest.
 */
function assertPublicSupabaseKey(key: string): string {
  if (key.startsWith('sb_secret_')) {
    throw new Error('[config] EXPO_PUBLIC_SUPABASE_ANON_KEY is a secret key. Use the anon/publishable key.');
  }
  const parts = key.split('.');
  if (parts.length === 3) {
    let role: unknown;
    try {
      const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      role = JSON.parse(atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '='))).role;
    } catch {
      role = undefined;
    }
    if (role !== undefined && role !== 'anon') {
      throw new Error(`[config] EXPO_PUBLIC_SUPABASE_ANON_KEY has role "${String(role)}". Use the anon key.`);
    }
  }
  return key;
}

const DEFAULT_API_URL = 'https://api.margixindia.com';
const DEFAULT_SUPABASE_URL = 'https://data.margixindia.com';
const DEFAULT_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJtYXJnaXgiLCJyb2xlIjoiYW5vbiIsImlhdCI6MTc5MDAwMDAwMCwiZXhwIjoyMTA1MDAwMDAwfQ.gp2nTeMR_7CGthbOYowaL-8xqNpw0kmdlxxwj0hzCCU';

export const API_BASE_URL = (process.env.EXPO_PUBLIC_API_URL?.trim() || DEFAULT_API_URL).replace(/\/+$/, '');

export const API_V1 = `${API_BASE_URL}/api/v1`;

export const SUPABASE_URL = (process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() || DEFAULT_SUPABASE_URL).replace(/\/+$/, '');

export const SUPABASE_ANON_KEY = assertPublicSupabaseKey(
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() || DEFAULT_ANON_KEY
);

// The Google Maps key is consumed natively (see app.config.ts), not at runtime.

// GPS Ping defaults (server overrides these)
export const DEFAULT_PING_INTERVAL_MS = 5000; // 5 seconds (Zomato-style high-frequency)
export const MIN_PING_INTERVAL_MS = 5000;
export const MAX_PING_INTERVAL_MS = 60000;
