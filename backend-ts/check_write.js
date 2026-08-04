require('dotenv').config();

async function check() {
  const payload = { test: 123, str: "kyc data" };
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/vendor_profiles?id=eq.f81a59a2-a783-48b1-be76-450ccca0a17b`, {
    method: 'PATCH',
    headers: {
      'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ dummy2: JSON.stringify(payload), is_verified: true })
  });
  console.log(res.status, await res.text());
}
check();
