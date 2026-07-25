import jwt from 'jsonwebtoken';
import { supabase } from './src/core/supabase';
import { settings } from './src/core/config';

async function test() {
  const { data: window } = await supabase.from('capacity_windows').select('*').limit(1).single();
  const { data: user } = await supabase.from('users').select('*').eq('role', 'vendor').limit(1).single();
  const token = jwt.sign({ sub: user.id, role: 'vendor', user_id: user.id }, settings.SUPABASE_JWT_SECRET, { expiresIn: '1h' });
  
  const res = await fetch('http://localhost:8000/api/v1/capacity/windows/' + window.id + '/upcoming-stops', { headers: { Authorization: 'Bearer ' + token } });
  
  console.log('Status:', res.status);
  const text = await res.text();
  console.log('Body:', text);
}
test();
