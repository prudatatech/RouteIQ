import { supabase } from '../src/core/supabase';
async function run() {
  const { data: users, error: authErr } = await supabase.auth.admin.listUsers();
  const adminUser = users.users.find(u => u.email === 'admin@margixindia.io');
  if (!adminUser) return console.log('Admin not found in auth');

  console.log('Admin ID:', adminUser.id);

  await supabase.from('users').upsert({
    id: adminUser.id,
    email: 'admin@margixindia.io',
    full_name: 'Super Admin',
    role: 'superadmin',
    is_active: true
  });
  console.log('Added admin to public.users');

  const { data: vehicles } = await supabase.from('vehicles').select('id, plate_number').limit(1);
  if (vehicles && vehicles.length > 0) {
    await supabase.from('vehicles').update({ driver_id: adminUser.id }).eq('id', vehicles[0].id);
    console.log('Assigned vehicle', vehicles[0].plate_number, 'to admin');
  } else {
    const { data: v } = await supabase.from('vehicles').insert({
      plate_number: 'TEST-ADMIN-01',
      vehicle_type: 'truck',
      status: 'idle',
      driver_id: adminUser.id,
      capacity_kg: 5000,
      cargo_types: ['general']
    }).select().single();
    console.log('Created and assigned vehicle TEST-ADMIN-01 to admin');
  }
}
run();
