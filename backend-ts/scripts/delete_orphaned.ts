import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

async function testCreate() {
  const url = process.env.SUPABASE_URL + '/auth/v1/admin/users';
  const headers = {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
    'Content-Type': 'application/json'
  };

  const body = {
    email: 'driver_14787804704@driver.margixindia.local',
    email_confirm: true,
    user_metadata: {
      full_name: 'Driver 4704',
      role: 'driver',
      phone: '+14787804704'
    }
  };

  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  console.log('Status:', res.status);
  console.log('Response:', text);
}

testCreate().catch(console.error);
