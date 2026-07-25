import { supabase } from './src/core/supabase';
async function test() {
  const { data: users, error } = await supabase.from('users').select('id, email, full_name, role, is_active, created_at');
  console.log('users error:', error);
  const vendorIds = users?.filter((u: any) => u.role === 'vendor').map((u: any) => u.id) || [];
  console.log('vendorIds:', vendorIds);
  if (vendorIds.length > 0) {
    const { data: profiles, error: err2 } = await supabase.from('vendor_profiles').select('id, company_name, city, address, gst_number').in('id', vendorIds);
    console.log('profiles error:', err2);
  }
}
test();
