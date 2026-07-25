import { supabase } from './src/core/supabase';

async function run() {
  const { data, error } = await supabase.from('users').select('id, email, role, vendor_profiles(*)').eq('role', 'vendor');
  console.log('Error from users with profiles:', error);
}
run();
