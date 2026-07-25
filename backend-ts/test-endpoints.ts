import { supabase } from './src/core/supabase';
async function testEndpoints() {
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: 'admin@routeiq.io',
    password: 'password123'
  });
  if (authError || !authData.session) {
    console.error('Auth failed:', authError);
    return;
  }
  const token = authData.session.access_token;
  
  console.log('Testing /api/v1/users/');
  const r1 = await fetch('http://localhost:8000/api/v1/users/', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  console.log('Users status:', r1.status);
  console.log('Users response:', await r1.text());

  console.log('Testing /api/v1/vendor/profile');
  const r2 = await fetch('http://localhost:8000/api/v1/vendor/profile', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  console.log('Vendor status:', r2.status);
  console.log('Vendor response:', await r2.text());
}
testEndpoints();
