import { supabase } from '../src/core/supabase';

async function checkBids() {
  const { data: bids } = await supabase.from('capacity_bids').select('*').like('id', 'b6fwd5q%');
  console.log("BIDS:", JSON.stringify(bids, null, 2));
}
checkBids();
