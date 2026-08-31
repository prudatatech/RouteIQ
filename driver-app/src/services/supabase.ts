/**
 * margixindia Driver App — Direct Supabase Client
 * 
 * This client writes GPS coordinates DIRECTLY to Supabase cloud,
 * bypassing the local backend entirely. This ensures GPS data
 * always reaches the database regardless of network topology.
 * 
 * This is the same pattern used by Ola, Uber, Zomato — the driver
 * app writes directly to the cloud database for maximum reliability.
 */
import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://plutdajzefwtpgofpqlk.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBsdXRkYWp6ZWZ3dHBnb2ZwcWxrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTEyNjgyMywiZXhwIjoyMDkwNzAyODIzfQ.pRcvEAWJ0ZPZDMLi9jK2XwypdsMZTuhaWIrAM5VM_Wg';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
