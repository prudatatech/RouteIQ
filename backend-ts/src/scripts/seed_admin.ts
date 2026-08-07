import { supabase } from '../core/supabase';

async function seedAdmin() {
  console.log('🌱 Starting Admin Seed...');
  try {
    const email = 'nexus.auth@prudata.io';
    const password = 'password123';

    // 1. Check if user exists in auth.users
    let { data: users, error: listErr } = await supabase.auth.admin.listUsers();
    if (listErr) throw listErr;

    let authUser = users.users.find(u => u.email === email);

    if (!authUser) {
      console.log('Creating auth user...');
      const { data, error } = await supabase.auth.admin.createUser({
        email: email,
        password: password,
        email_confirm: true,
        user_metadata: { role: 'superadmin' }
      });
      if (error) throw error;
      authUser = data.user;
    } else {
      console.log('Auth user already exists, updating password and metadata...');
      const { data, error } = await supabase.auth.admin.updateUserById(authUser.id, {
        password: password,
        user_metadata: { role: 'superadmin' }
      });
      if (error) throw error;
    }

    console.log(`✅ Auth user configured: ${authUser.id}`);

    // 2. Add to public.users
    console.log('Inserting into public.users...');
    const { error: dbErr } = await supabase.from('users').upsert({
      id: authUser.id,
      email: email,
      full_name: 'System Admin',
      role: 'superadmin',
      is_active: true,
    }, { onConflict: 'id' });

    if (dbErr) throw dbErr;
    console.log(`✅ Superadmin added to public.users`);

    console.log('\n=============================================');
    console.log('🎉 Admin Seed completed successfully!');
    console.log('You can now log in with:');
    console.log(`Email: ${email}`);
    console.log(`Password: ${password}`);
    console.log('=============================================\n');
  } catch (error) {
    console.error('❌ Seeding failed:', error);
  } finally {
    process.exit();
  }
}

seedAdmin();
