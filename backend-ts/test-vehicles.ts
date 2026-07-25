import { supabase } from './src/core/supabase';

async function run() {
  const { data, error } = await supabase.from('vehicles').select('*').limit(5);
  if (error) {
    console.error("Error:", error);
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}
run();
