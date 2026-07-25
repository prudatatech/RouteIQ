import { supabase } from './src/core/supabase';
async function test() {
  const { data: profiles, error: err2 } = await supabase.from('vendor_profiles').select('id, company_name, city, address, gst_number').in('id', ['468b64df-7efe-4478-93d4-7714a31412bf']);
  console.log('profiles error:', err2);
  console.log('profiles:', profiles);
}
test();
