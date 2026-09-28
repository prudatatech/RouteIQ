/**
 * margixindia Driver App — Supabase client
 *
 * Uses the public anon key plus the driver's own Supabase Auth session (issued
 * by the backend at OTP login). Every direct query is therefore governed by
 * row-level security: a driver can only read and write their own rows.
 *
 * The session is persisted in the secure store so the background location task
 * can load it in a headless JS context (the client restores it on first use).
 */
import 'react-native-url-polyfill/auto';
import { AppState } from 'react-native';
import { createClient, type Session } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config';
import { secureStorage } from './secureStorage';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: secureStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

// Refresh tokens in the foreground only (Supabase React Native guidance).
// In the background, each request still refreshes an expired token on demand.
if (AppState.currentState === 'active') {
  supabase.auth.startAutoRefresh();
}
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});

/** The current session (restored from storage and refreshed if expired), or null. */
export async function getCurrentSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  return data.session;
}
