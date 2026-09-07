import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function test() {
  console.log("Signing in...");
  const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
    email: 'prudata.tech@gmail.com',
    password: 'password123'
  });

  if (authErr) {
    console.error("Auth error:", authErr.message);
    // Let's try just service_role key to see if the record exists
    return;
  }

  console.log("User ID:", authData.user.id);

  console.log("Querying tpl_partners...");
  const { data, error } = await supabase
    .from('tpl_partners')
    .select('*')
    .eq('user_id', authData.user.id);
    
  console.log("Data:", data);
  console.log("Error:", error);
}

test();
