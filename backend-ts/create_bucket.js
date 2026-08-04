require('dotenv').config();

async function createBucket() {
  const res = await fetch(`${process.env.SUPABASE_URL}/storage/v1/bucket`, {
    method: 'POST',
    headers: {
      'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      id: 'kyc_documents',
      name: 'kyc_documents',
      public: false
    })
  });
  console.log(res.status, await res.text());
}
createBucket();
