import { supabase } from './src/core/supabase';

async function fixShipment() {
  const trackingId = 'RTX-NT8FVV2';
  console.log(`Fixing corrupted shipment ${trackingId}...`);
  
  // 1. Get the shipment
  const { data: shipment, error: err1 } = await supabase
    .from('shipments')
    .select('*')
    .eq('tracking_id', trackingId)
    .single();
    
  if (err1 || !shipment) {
    console.error('Shipment not found:', err1);
    return;
  }
  console.log(`Found shipment: ${shipment.id}`);
  
  // 2. Find the window that references this shipment
  const { data: window, error: err2 } = await supabase
    .from('capacity_windows')
    .select('*')
    .eq('fallback_shipment_id', shipment.id)
    .single();
    
  if (err2 || !window) {
    console.error('Window not found:', err2);
    return;
  }
  
  const winningBidId = window.winning_bid_id;
  if (!winningBidId) {
    console.error('Window has no winning bid!');
    return;
  }
  console.log(`Found winning bid: ${winningBidId}`);
  
  // 3. Get the bid
  const { data: bid, error: err3 } = await supabase
    .from('capacity_bids')
    .select('*')
    .eq('id', winningBidId)
    .single();
    
  if (err3 || !bid) {
    console.error('Bid not found:', err3);
    return;
  }
  
  // 4. Update the shipment to fix status and bid_id
  await supabase.from('shipments').update({
    status: 'assigned',
    priority: 'high',
    total_weight_kg: bid.weight_kg,
    bid_id: bid.id
  }).eq('id', shipment.id);
  console.log('Shipment updated!');
  
  // 5. Clean up dummy delivery points
  const { data: dummyDps } = await supabase
    .from('delivery_points')
    .select('id, name')
    .eq('shipment_id', shipment.id);
    
  for (const dp of dummyDps || []) {
    if (dp.name === 'New Location' || dp.name === 'Unknown Address') {
      await supabase.from('delivery_points').delete().eq('id', dp.id);
      console.log(`Deleted dummy point: ${dp.id}`);
    }
  }
  
  // 6. Link the correct delivery point
  if (bid.dropoff_point_id) {
    await supabase.from('delivery_points').update({ shipment_id: shipment.id }).eq('id', bid.dropoff_point_id);
    console.log(`Linked actual Mapbox destination: ${bid.dropoff_point_id}`);
  }
  
  console.log('Done! Everything is perfectly linked.');
}

fixShipment();
