import { supabase } from '../src/core/supabase';

async function fixShipments() {
  // Find recent broken shipments (status created, bid_id null, tracking_id starts with RTX)
  const { data: brokenShipments } = await supabase.from('shipments')
    .select('*')
    .like('tracking_id', 'RTX-%')
    .is('bid_id', null)
    .order('created_at', { ascending: false })
    .limit(10);
    
  if (brokenShipments) {
    for (const ship of brokenShipments) {
      // Find the corresponding bid (since tracking_id is RTX- + bid_id.slice(0,7))
      const bidPrefix = ship.tracking_id.replace('RTX-', '').toLowerCase();
      const { data: bids } = await supabase.from('capacity_bids')
        .select('*')
        .like('id', `${bidPrefix}%`);
        
      if (bids && bids.length > 0) {
        const bid = bids[0];
        console.log(`Fixing shipment ${ship.tracking_id} with bid ${bid.id}`);
        
        // Update shipment to be assigned
        await supabase.from('shipments').update({
          status: 'assigned',
          bid_id: bid.id
        }).eq('id', ship.id);
        
        // Link the delivery point
        await supabase.from('delivery_points').update({
          shipment_id: ship.id
        }).eq('id', bid.dropoff_point_id);
      }
    }
  }
}

fixShipments();
