import { supabase } from "./src/core/supabase";

async function run() {
  const { data, error } = await supabase.rpc("exec_sql", { query: "SELECT 1" });
  console.log("data:", data, "error:", error);
}
run();
