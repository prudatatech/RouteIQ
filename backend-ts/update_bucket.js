require('dotenv').config();

async function updateBucket() {
  const res = await fetch(`${process.env.SUPABASE_URL}/storage/v1/bucket/kyc_documents`, {
    method: 'PUT',
    headers: {
      'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      public: true
    })
  });
  console.log(res.status, await res.text());
}
updateBucket();
