import { supabase } from './src/core/supabase';
import { decodeToken } from './src/core/auth';
import jwt from 'jsonwebtoken';
import { settings } from './src/core/config';

async function run() {
  try {
    const { data: vendor } = await supabase.from('vendor_profiles').select('*').limit(1).single();
    const { data: window } = await supabase.from('capacity_windows').select('*').limit(1).single();
    console.log('Vendor:', vendor?.id);
    console.log('Window:', window?.id);
    
    // Create a mock token for this vendor
    const token = jwt.sign({ sub: vendor.id, role: 'vendor', user_id: vendor.id }, settings.SUPABASE_JWT_SECRET || settings.SECRET_KEY, { expiresIn: '1h' });
    console.log('Token:', token);
    
    // Hit the endpoint
    const res = await fetch(`http://localhost:8000/api/v1/capacity/windows/${window.id}/upcoming-stops`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    console.log('Status:', res.status);
    const json = await res.json();
    console.log('Response length:', (json as any).length);
    console.log('Response:', json);
  } catch (e) {
    console.error(e);
  }
}
run();
