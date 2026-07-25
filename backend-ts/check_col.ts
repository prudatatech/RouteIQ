import { supabase } from "./src/core/supabase";

async function run() {
  const { data, error } = await supabase.from("vehicles").select("declared_load_percentage").limit(1);
  console.log(error ? error.message : "column exists");
}

run();
