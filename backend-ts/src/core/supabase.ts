/**
 * RouteIQ — Supabase client initialization
 * Provides both service-role client (for backend ops) and anon client (for auth verification).
 * 
 * Node.js 20 does not have native WebSocket — we polyfill via the 'ws' package.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { settings } from './config';
import WebSocket from 'ws';

// Polyfill WebSocket globally for Node.js < 22
// @ts-ignore — global.WebSocket typing mismatch is harmless
globalThis.WebSocket = WebSocket as any;

if (!settings.SUPABASE_URL || !settings.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env');
}

/**
 * Service-role client — bypasses RLS.
 * Use for all backend CRUD operations.
 */
export const supabase: SupabaseClient = createClient(
  settings.SUPABASE_URL,
  settings.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    realtime: {
      params: { eventsPerSecond: 2 },
    },
  }
);

/**
 * Anon client — respects RLS.
 * Use for verifying user auth tokens.
 */
export const supabaseAnon: SupabaseClient = createClient(
  settings.SUPABASE_URL,
  settings.SUPABASE_ANON_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);
