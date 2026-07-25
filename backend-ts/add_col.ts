import { supabase } from "./src/core/supabase";

async function run() {
  const { data, error } = await supabase.rpc('execute_sql', { query: 'ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS declared_load_percentage numeric DEFAULT 0;' });
  console.log("RPC result:", data, error);
}

run();
