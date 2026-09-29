import { createClient } from '@supabase/supabase-js';

// Use direct Supabase URL for auth operations (the Cloudflare worker proxy
// may not forward /auth/v1/* endpoints correctly)
const supabaseUrl = import.meta.env.VITE_SUPABASE_DIRECT_URL
  || import.meta.env.VITE_SUPABASE_URL
  || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    storageKey: 'margixindia-auth',
  },
});

let channelSeq = 0;

/**
 * A new realtime channel for one component instance. `supabase.channel(name)`
 * hands back the existing channel when the name is already in use (the same
 * component on screen twice, or a remount before the old channel is removed),
 * and adding listeners to that subscribed channel throws. A per-call suffix
 * keeps every subscription separate.
 */
export function openChannel(name: string) {
  channelSeq += 1;
  return supabase.channel(`${name}:${channelSeq}`);
}
