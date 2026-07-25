import { supabase } from './src/core/supabase';

async function run() {
  const { data: users, error } = await supabase.from('users').select('*');
  console.log('Users:', users);
  if (error) console.log('Users Error:', error);
}
run();
