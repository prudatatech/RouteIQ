import { supabase } from '../src/core/supabase';

async function checkWindows() {
  const { data: w, error } = await supabase.from('capacity_windows').select('*').limit(2);
  console.log("ERROR:", error);
  console.log("WINDOWS:", JSON.stringify(w, null, 2));
}
checkWindows();
