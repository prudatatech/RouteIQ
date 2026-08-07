import { supabase } from './core/supabase';

async function fetchColumns() {
  const { data: req, error: e } = await supabase.from('vendor_shipment_requests').select('*').limit(1);
  if (req && req.length > 0) {
    console.log("vendor_shipment_requests:", Object.keys(req[0]));
  } else {
    console.log('No reqs found');
  }

  const { data: b, error: e2 } = await supabase.from('capacity_bids').select('*').limit(1);
  if (b && b.length > 0) {
    console.log("capacity_bids:", Object.keys(b[0]));
  } else {
    console.log('No bids found');
  }

  process.exit(0);
}

fetchColumns().catch(console.error);
