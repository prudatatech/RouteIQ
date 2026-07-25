const fs = require('fs');
let code = fs.readFileSync('src/services/capacity.service.ts', 'utf8');
const startString = `  async approveBid(bidId: string) {`;
const endString = `  async resolveWindow(windowId: string) {`;
const startIndex = code.indexOf(startString);
const endIndex = code.indexOf(endString);
if (startIndex === -1 || endIndex === -1) {
    console.error("Could not find start or end strings!");
    process.exit(1);
}

const newApproveBid = `  async approveBid(bidId: string) {
    // 1. Fetch the bid
    const { data: bid, error: bidErr } = await supabase.from('capacity_bids').select('*').eq('id', bidId).single();
    if (bidErr || !bid) throw new Error('Bid not found');

    const windowId = bid.window_id;

    // 2. Fetch the window
    const { data: window } = await supabase.from('capacity_windows').select('*').eq('id', windowId).single();
    if (!window) throw new Error('Window not found');

    // 3. Mark this bid as won, others as lost
    await supabase.from('capacity_bids').update({ status: 'won' }).eq('id', bidId);
    await supabase.from('capacity_bids').update({ status: 'lost' }).eq('window_id', windowId).neq('id', bidId);

    // 4. Update window
    await supabase.from('capacity_windows').update({ winning_bid_id: bidId }).eq('id', windowId);

    // 4.5. Update vehicle capacity to 0 since the space is now occupied
    await supabase.from('vehicles').update({ available_capacity_kg: 0 }).eq('id', window.vehicle_id);

    // 5. Create a dynamic shipment for this cargo so it appears in Admin Live Shipments
    let finalShipmentId = window.fallback_shipment_id;
    
    // Fetch vendor info to set origin name and get coords
    let vendorOriginName = 'Dynamic Vendor Pickup';
    let vendorOriginAddress = 'Vendor Location';
    let vendorLat = null;
    let vendorLng = null;
    if (bid.vendor_id) {
      const { data: vendor } = await supabase.from('vendor_profiles').select('company_name, address, city, latitude, longitude').eq('id', bid.vendor_id).single();
      if (vendor) {
        vendorOriginName = vendor.company_name || vendorOriginName;
        vendorOriginAddress = vendor.address || vendor.city || vendorOriginAddress;
        vendorLat = vendor.latitude;
        vendorLng = vendor.longitude;
      }
    }

    if (window.fallback_shipment_id) {
      await supabase.from('shipments').update({
        status: 'assigned',
        priority: 'high',
        total_weight_kg: bid.weight_kg,
        total_items: 1,
        origin_name: vendorOriginName,
        origin_address: vendorOriginAddress,
        bid_id: bid.id
      }).eq('id', window.fallback_shipment_id);
    } else {
      const { data: s } = await supabase.from('shipments').insert({
        tracking_id: 'RTX-' + bid.id.slice(0, 7).toUpperCase(),
        status: 'assigned',
        vehicle_id: window.vehicle_id,
        priority: 'high',
        origin_name: vendorOriginName,
        origin_address: vendorOriginAddress,
        total_items: 1,
        total_weight_kg: bid.weight_kg || 500,
        bid_id: bid.id
      }).select('id').single();
      if (s) finalShipmentId = s.id;
    }

    if (finalShipmentId && bid.dropoff_point_id) {
      const { data: vendorDp } = await supabase.from('delivery_points').select('*').eq('id', bid.dropoff_point_id).single();
      if (vendorDp) {
        const { data: updatedDummy } = await supabase.from('delivery_points')
          .update({
            name: vendorDp.name,
            address: vendorDp.address,
            latitude: vendorDp.latitude,
            longitude: vendorDp.longitude,
            demand_kg: vendorDp.demand_kg
          })
          .eq('shipment_id', finalShipmentId)
          .select();
          
        if (!updatedDummy || updatedDummy.length === 0) {
          await supabase.from('delivery_points')
            .update({ shipment_id: finalShipmentId })
            .eq('id', bid.dropoff_point_id);
        } else {
          bid.dropoff_point_id = updatedDummy[0].id;
        }
      }
    }

    // 6. Also insert into cargo_manifest so it shows up in the admin dashboard and driver's fallback screen
    let manifestDropLat = null;
    let manifestDropLng = null;
    let manifestDropAddress = '';
    if (bid.dropoff_point_id) {
      const { data: dp } = await supabase.from('delivery_points').select('latitude, longitude, address, name').eq('id', bid.dropoff_point_id).single();
      if (dp) {
        manifestDropLat = dp.latitude;
        manifestDropLng = dp.longitude;
        manifestDropAddress = dp.address || dp.name;
      }
    }

    await supabase.from('cargo_manifest').insert({
      vehicle_id: window.vehicle_id,
      pickup_location: vendorOriginAddress,
      pickup_lat: vendorLat,
      pickup_lng: vendorLng,
      drop_location: manifestDropAddress,
      drop_lat: manifestDropLat,
      drop_lng: manifestDropLng,
      capacity_kg: bid.weight_kg || 500,
      status: 'scheduled',
      route_type: window.trigger_type === 'end_of_route' || window.trigger_type === 'return_trip' ? 'backhaul' : 'forward'
    });

    // 7. Inject the route stop for the vendor's drop-off point if there's an active route
    if (bid.dropoff_point_id) {
      const { data: route } = await supabase.from('routes')
        .select('id')
        .eq('vehicle_id', window.vehicle_id)
        .in('status', ['pending', 'active', 'in_progress'])
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (route) {
        const { data: pendingStops } = await supabase.from('route_stops')
          .select('id, sequence')
          .eq('route_id', route.id)
          .eq('status', 'pending')
          .order('sequence', { ascending: true });
        
        let insertSequence = 1;
        if (pendingStops && pendingStops.length > 0) {
          insertSequence = pendingStops[0].sequence;
          for (const stop of pendingStops) {
            await supabase.from('route_stops').update({ sequence: stop.sequence + 1 }).eq('id', stop.id);
          }
        } else {
          const { data: allStops } = await supabase.from('route_stops')
            .select('sequence')
            .eq('route_id', route.id)
            .order('sequence', { ascending: false })
            .limit(1);
          if (allStops && allStops.length > 0) {
            insertSequence = allStops[0].sequence + 1;
          }
        }

        const stopId = uuidv4();
        await supabase.from('route_stops').insert({
          id: stopId,
          route_id: route.id,
          delivery_point_id: bid.dropoff_point_id,
          sequence: insertSequence,
          status: 'pending'
        });

        // Trigger driver confirmation for the new stop
        await supabase.from('driver_confirmations').insert({
          route_stop_id: stopId,
          vehicle_id: window.vehicle_id,
          prompted_at: new Date().toISOString()
        });
      }
    }

    // 8. Turn off the bidding_window_open flag
    await supabase.from('vehicles').update({ bidding_window_open: false, bidding_window_closes_at: null }).eq('id', window.vehicle_id);

    return bid;
  },

`;
code = code.substring(0, startIndex) + newApproveBid + code.substring(endIndex);
fs.writeFileSync('src/services/capacity.service.ts', code);
console.log('Successfully rewrote approveBid');
