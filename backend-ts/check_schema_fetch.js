require('dotenv').config();

async function check() {
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/vendor_profiles?select=*&limit=1`, {
    headers: {
      'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
    }
  });
  const data = await res.json();
  console.log(data);
}
check();
