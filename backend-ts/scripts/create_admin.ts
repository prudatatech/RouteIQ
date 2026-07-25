import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

async function createAdmin() {
  const url = process.env.SUPABASE_URL + '/auth/v1/admin/users';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json'
  };

  console.log('Creating admin user...');
  const createRes = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      email: 'admin@routeiq.io',
      password: 'Admin1234!',
      email_confirm: true,
      user_metadata: {
        full_name: 'Super Admin',
        role: 'superadmin'
      }
    })
  });
  
  const createText = await createRes.text();
  console.log('Status:', createRes.status);
  console.log('Response:', createText);
}

createAdmin().catch(console.error);
