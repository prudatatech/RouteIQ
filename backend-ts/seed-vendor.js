const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
require('dotenv').config({ path: '../frontend/.env' });
require('dotenv').config({ path: '.env', override: true }); // load backend env for service role key

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
  realtime: {
    transport: ws
  }
});

async function seed() {
  console.log("Creating vendor user...");
  // 1. Create auth user
  const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
    email: 'vendor@routeiq.io',
    password: 'Vendor1234!',
    email_confirm: true,
    user_metadata: { role: 'vendor' }
  });

  if (authErr && !authErr.message.includes('already exists')) {
    console.error("Auth error:", authErr);
    return;
  }

  let userId = authUser?.user?.id;
  if (!userId) {
    // get existing user
    const { data: existing } = await supabase.auth.admin.listUsers();
    const vendorUser = existing.users.find(u => u.email === 'vendor@routeiq.io');
    if (vendorUser) {
        userId = vendorUser.id;
    }
  }

  if (userId) {
    // 2. Insert into public.users
    const { error: dbErr } = await supabase.from('users').upsert({
      id: userId,
      email: 'vendor@routeiq.io',
      full_name: 'Test Vendor',
      role: 'vendor',
      is_active: true
    });

    if (dbErr) {
      console.error("DB error:", dbErr);
    } else {
      console.log("Vendor user seeded successfully! ID:", userId);
    }
  }
}

seed();
