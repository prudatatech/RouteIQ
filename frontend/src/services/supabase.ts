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
