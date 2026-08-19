import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

async function testCreate() {
  const url = process.env.SUPABASE_URL + '/auth/v1/admin/users';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json'
  };

  console.log('=== Step 1: List existing auth users ===');
  const listRes = await fetch(url, { headers });
  const listData: any = await listRes.json();
  console.log('Existing users:', listData.users?.length ?? 0);
  for (const u of (listData.users || [])) {
    console.log(`  - ${u.email} (id: ${u.id})`);
    // Delete them to start fresh
    console.log('  Deleting...');
    await fetch(`${url}/${u.id}`, { method: 'DELETE', headers });
  }

  console.log('\n=== Step 2: Try createUser via raw fetch ===');
  const createRes = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      email: 'driver_917360095009@driver.margixindia.local',
      email_confirm: true,
      user_metadata: {
        full_name: 'Driver 5009',
        role: 'driver',
        phone: '+917360095009'
      }
    })
  });
  const createText = await createRes.text();
  console.log('Create status:', createRes.status);
  console.log('Create response:', createText);

  if (createRes.status === 500) {
    console.log('\n=== THE TRIGGER IS CRASHING! ===');
    console.log('The handle_new_user() trigger on auth.users is failing.');
    console.log('Fix: DROP the trigger, then create users manually.');
  }
}

testCreate().catch(console.error);
