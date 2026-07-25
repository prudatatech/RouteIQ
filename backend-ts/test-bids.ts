import { supabase } from './src/core/supabase';
async function run() {
  const { data, error } = await supabase
        .from('shipments')
        .select('*, capacity_bids(bid_amount, eway_bill_ref, load_configuration, vendor_profiles(company_name, city))')
        .not('bid_id', 'is', null)
        .limit(1);
  console.log(JSON.stringify(data, null, 2));
  console.log('Error:', error);
}
run();
