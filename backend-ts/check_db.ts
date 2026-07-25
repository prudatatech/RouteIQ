import { supabase } from './src/core/supabase';

async function run() {
  console.log('Querying cargo_manifest...');
  const { data, error } = await supabase.from('cargo_manifest').select('*');
  console.log('Data:', JSON.stringify(data, null, 2));
  if (error) console.error('Error:', error);
}

run();
