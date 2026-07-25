import { supabase } from '../src/core/supabase';

async function checkShip() {
  const { data: s } = await supabase.from('shipments').select('*').order('created_at', { ascending: false }).limit(2);
  console.log("SHIPMENTS:", JSON.stringify(s, null, 2));
}
checkShip();
