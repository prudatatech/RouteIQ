import { supabase } from './src/core/supabase';
async function run() {
  const { data, error } = await supabase
    .from('users')
    .select('id, email, full_name, role, is_active, created_at, vendor_profiles(company_name, city, address, gst_number)');
  console.log(JSON.stringify(data, null, 2));
  console.log('Error:', error);
}
run();
