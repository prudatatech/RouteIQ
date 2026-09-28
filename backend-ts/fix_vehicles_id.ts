import { supabase } from "./src/core/supabase";

async function run() {
  const { data, error } = await supabase.rpc('execute_sql', { 
    query: 'ALTER TABLE vehicles ALTER COLUMN id SET DEFAULT gen_random_uuid();' 
  });
  console.log("RPC result:", data, error);
}

run();
