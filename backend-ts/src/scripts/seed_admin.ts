/**
 * Create or update the superadmin account.
 *
 * Usage: SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=... npx ts-node src/scripts/seed_admin.ts
 */
import { supabase } from '../core/supabase';

async function findAuthUserByEmail(email: string) {
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const match = data.users.find(u => u.email?.toLowerCase() === email.toLowerCase());
    if (match || data.users.length < 1000) return match;
  }
}

async function seedAdmin() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password || password.length < 12) {
    console.error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (at least 12 characters).');
    process.exit(1);
  }

  console.log('🌱 Starting Admin Seed...');
  try {
    const attributes = {
      password,
      email_confirm: true,
      app_metadata: { role: 'superadmin' },
      user_metadata: { role: 'superadmin' },
    };

    let authUser = await findAuthUserByEmail(email);
    if (!authUser) {
      const { data, error } = await supabase.auth.admin.createUser({ email, ...attributes });
      if (error) throw error;
      authUser = data.user;
    } else {
      const { error } = await supabase.auth.admin.updateUserById(authUser.id, attributes);
      if (error) throw error;
    }
    console.log(`✅ Auth user configured: ${authUser.id}`);

    const { error: dbErr } = await supabase.from('users').upsert({
      id: authUser.id,
      email,
      full_name: 'System Admin',
      role: 'superadmin',
      is_active: true,
    }, { onConflict: 'id' });
    if (dbErr) throw dbErr;

    console.log(`🎉 Superadmin ready: ${email}`);
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exitCode = 1;
  }
}

seedAdmin();
