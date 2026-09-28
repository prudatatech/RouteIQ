import { supabase } from '../core/supabase';
import { v4 as uuidv4 } from 'uuid';
import { HttpError } from '../core/errors';

export const capacityService = {
  /**
   * Submit a bid for a capacity window
   */
  async submitBid(data: { vendor_id: string; window_id: string; bid_amount: number; eway_bill_ref: string; dropoff_point_id: string; weight_kg: number; load_configuration: string }) {
    const bidAmount = Number(data.bid_amount);
    const weightKg = Number(data.weight_kg);
    if (!Number.isFinite(bidAmount) || bidAmount <= 0) throw new HttpError(400, 'bid_amount must be a positive number');
    if (!Number.isFinite(weightKg) || weightKg <= 0) throw new HttpError(400, 'weight_kg must be a positive number');

    const { data: window, error: windowErr } = await supabase
      .from('capacity_windows')
      .select('id, opens_at, closes_at, floor_price, winning_bid_id, vehicles(latitude, longitude, city, available_capacity_kg)')
      .eq('id', data.window_id)
      .maybeSingle();
    if (windowErr) throw new Error(`Failed to load window ${data.window_id}: ${windowErr.message}`);
    if (!window) throw new HttpError(404, 'Window not found');

    const now = Date.now();
    if (window.winning_bid_id || new Date(window.closes_at).getTime() <= now || new Date(window.opens_at).getTime() > now) {
      throw new HttpError(409, 'This capacity window is not open for bids');
    }
    if (window.floor_price != null && bidAmount < Number(window.floor_price)) {
      throw new HttpError(400, `Bid is below the floor price of ₹${window.floor_price}`);
    }
    const windowVehicle = window.vehicles as any;
    if (windowVehicle?.available_capacity_kg != null && weightKg > Number(windowVehicle.available_capacity_kg)) {
      throw new HttpError(400, `Load of ${weightKg} kg exceeds the ${windowVehicle.available_capacity_kg} kg available on this vehicle`);
    }

    const { data: existing, error: existingErr } = await supabase
      .from('capacity_bids')
      .select('id')
      .eq('window_id', data.window_id)
      .eq('vendor_id', data.vendor_id)
      .eq('status', 'pending')
      .limit(1);
    if (existingErr) throw new Error(`Failed to check existing bids: ${existingErr.message}`);
    if (existing && existing.length > 0) throw new HttpError(409, 'You already have a pending bid on this window');

    // Geofencing Check: vehicle location vs vendor location
    const { data: vendor } = await supabase.from('vendor_profiles').select('latitude, longitude, city').eq('id', data.vendor_id).single();

    if (window?.vehicles && vendor) {
      const vehicle = window.vehicles as any;
      const vLat = vehicle.latitude;
      const vLng = vehicle.longitude;
      const vndLat = vendor.latitude;
      const vndLng = vendor.longitude;

      if (vLat && vLng && vndLat && vndLng) {
        let drivingDistanceKm = 0;
        let etaMins = 0;

        try {
          const axios = require('axios');
          const osrmRes = await axios.get(`https://router.project-osrm.org/route/v1/driving/${vLng},${vLat};${vndLng},${vndLat}?overview=false`, { timeout: 5000 });
          if (osrmRes.data.routes && osrmRes.data.routes.length > 0) {
            const routeData = osrmRes.data.routes[0];
            drivingDistanceKm = Math.round(routeData.distance / 1000 * 10) / 10;
            etaMins = Math.round(routeData.duration / 60);
          }
        } catch (e: any) {
          console.warn('OSRM fallback to Haversine due to error:', e.message);
          const { data: distance } = await supabase.rpc('calculate_distance', {
            lat1: vLat, lon1: vLng, lat2: vndLat, lon2: vndLng
          });
          drivingDistanceKm = distance;
        }

        const isSameCity = vehicle.city?.toLowerCase() === vendor.city?.toLowerCase();
        
        if (!isSameCity && drivingDistanceKm > 50) {
          throw new HttpError(400, `Geofencing lock: The physical driving distance is ${drivingDistanceKm}km (ETA: ${etaMins} mins), which exceeds the 50km limit from your location.`);
        }
      }
    }

    const { data: bid, error } = await supabase.from('capacity_bids').insert({
      vendor_id: data.vendor_id,
      window_id: data.window_id,
      bid_amount: bidAmount,
      eway_bill_ref: data.eway_bill_ref,
      dropoff_point_id: data.dropoff_point_id,
      weight_kg: weightKg,
      load_configuration: data.load_configuration,
      status: 'pending'
    }).select().single();

    if (error) throw new Error(error.message);
    return bid;
  },

  /**
   * Toggle backhaul matching for a vehicle
   */
  async toggleMatching(vehicleId: string, enabled: boolean) {
    const { data: vehicle, error: fetchErr } = await supabase.from('vehicles').select('available_capacity_kg, latitude, longitude').eq('id', vehicleId).single();
    if (fetchErr) throw new Error(fetchErr.message);

    const availableCapacity = vehicle?.available_capacity_kg || 0;

    const { error } = await supabase.from('vehicles').update({ bidding_window_open: enabled }).eq('id', vehicleId);
    
    if (error) throw new Error(error.message);

    if (enabled && availableCapacity > 0) {
      // Driver initiated return trip search, so we open a bidding window based on true calculated capacity
      await this.openBackhaulWindow(vehicleId, availableCapacity, 'return_trip');
      
      // Hook into the vendor passing route broadcast system
      let routeId;
      const { data: routes } = await supabase.from('routes').select('id').eq('vehicle_id', vehicleId).order('created_at', { ascending: false }).limit(1);
      
      if (routes && routes.length > 0) {
        routeId = routes[0].id;
      } else {
        const { data: newRoute } = await supabase.from('routes').insert({
          id: uuidv4(),
          vehicle_id: vehicleId,
          status: 'active',
          total_distance_km: 0,
          total_duration_minutes: 0,
          estimated_fuel_liters: 0,
          weather_condition: 'clear',
          traffic_delay_minutes: 0,
          waypoints: []
        }).select().single();
        routeId = newRoute?.id;
      }

      if (routeId && vehicle.latitude && vehicle.longitude) {
        import('./vendor.service').then(({ vendorService }) => {
          vendorService.matchRouteToVendors(
            routeId,
            vehicleId,
            vehicle.latitude!,
            vehicle.longitude!,
            vehicle.latitude! + 0.01,
            vehicle.longitude! + 0.01
          ).catch(console.error);
        });
      }
    }
  },

  /**
   * Driver or Superadmin triggers a capacity window
   */
  async openBackhaulWindow(
    vehicleId: string, 
    availableCapacityKg: number, 
    triggerType: 'mid_route' | 'return_trip' | 'superadmin_dispatch',
    customOpensAt?: string,
    customClosesAt?: string,
    customFloorPrice?: number,
    sourceShipmentId?: string
  ) {
    // 1. Compute floor price (simple heuristic: 10 INR per kg, could use distance later)
    const floorPrice = customFloorPrice ?? (availableCapacityKg * 10);
    
    const opensAt = customOpensAt ? new Date(customOpensAt) : new Date();
    const closesAt = customClosesAt ? new Date(customClosesAt) : new Date(opensAt.getTime() + 300 * 1000); // 5 minute window

    // 2. Insert capacity_windows row
    const { data: window, error } = await supabase.from('capacity_windows').insert({
      vehicle_id: vehicleId,
      opens_at: opensAt.toISOString(),
      closes_at: closesAt.toISOString(),
      floor_price: floorPrice,
      trigger_type: triggerType,
      fallback_shipment_id: sourceShipmentId || null
    }).select().single();

    if (error) throw new Error(error.message);

    // Removed 60s auto-resolver setTimeout. Bids now wait for manual Superadmin approval.

    return window;
  },

  /**
   * Superadmin manually approves a backhaul bid
   */
  async approveBid(bidId: string) {
    // 1. Claim the bid: only a pending bid can be approved, and only once.
    // The conditional update is atomic per row, so concurrent approvals
    // (double clicks, retries) cannot both proceed.
    const { data: bid, error: claimErr } = await supabase
      .from('capacity_bids')
      .update({ status: 'won' })
      .eq('id', bidId)
      .eq('status', 'pending')
      .select('*')
      .maybeSingle();
    if (claimErr) throw new Error(`Failed to claim bid ${bidId}: ${claimErr.message}`);
    if (!bid) {
      const { data: existing } = await supabase.from('capacity_bids').select('status').eq('id', bidId).maybeSingle();
      if (!existing) throw new HttpError(404, 'Bid not found');
      throw new HttpError(409, `Bid is already ${existing.status}`);
    }

    const windowId = bid.window_id;

    // 2. Claim the window for this bid; another bid may already have won it
    const { data: window, error: windowErr } = await supabase
      .from('capacity_windows')
      .update({ winning_bid_id: bidId })
      .eq('id', windowId)
      .is('winning_bid_id', null)
      .select('*')
      .maybeSingle();
    if (windowErr || !window) {
      // Release the claim: retryable on a database error, lost if another bid won
      await supabase.from('capacity_bids').update({ status: windowErr ? 'pending' : 'lost' }).eq('id', bidId);
      if (windowErr) throw new Error(`Failed to claim window ${windowId}: ${windowErr.message}`);
      throw new HttpError(409, 'Another bid has already won this window');
    }

    // 3. Remaining pending bids on the window lose
    const { error: loseErr } = await supabase.from('capacity_bids').update({ status: 'lost' }).eq('window_id', windowId).eq('status', 'pending');
    if (loseErr) throw new Error(`Failed to close other bids: ${loseErr.message}`);

    // 4. The space is now occupied
    const { error: capErr } = await supabase.from('vehicles').update({ available_capacity_kg: 0 }).eq('id', window.vehicle_id);
    if (capErr) throw new Error(`Failed to update vehicle capacity: ${capErr.message}`);

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

    // Fallback to vehicle's current location if vendor coordinates are missing
    if (!vendorLat || !vendorLng) {
      const { data: v } = await supabase.from('vehicles').select('latitude, longitude, current_location_name').eq('id', window.vehicle_id).single();
      if (v) {
        vendorLat = v.latitude;
        vendorLng = v.longitude;
        if (vendorOriginAddress === 'Vendor Location' && v.current_location_name) {
          vendorOriginAddress = v.current_location_name;
        }
      }
    }

    if (window.fallback_shipment_id) {
      const { error: shipErr } = await supabase.from('shipments').update({
        status: 'assigned',
        priority: 'high',
        total_weight_kg: bid.weight_kg,
        total_items: 1,
        origin_name: vendorOriginName,
        origin_address: vendorOriginAddress,
        bid_id: bid.id
      }).eq('id', window.fallback_shipment_id);
      if (shipErr) throw new Error(`Failed to update shipment ${window.fallback_shipment_id}: ${shipErr.message}`);
    } else {
      const { data: s, error: shipErr } = await supabase.from('shipments').insert({
        tracking_id: 'RTX-' + bid.id.slice(0, 7).toUpperCase(),
        status: 'created',
        priority: 'high',
        origin_name: vendorOriginName,
        origin_address: vendorOriginAddress,
        total_items: 1,
        total_weight_kg: bid.weight_kg,
        bid_id: bid.id
      }).select('id').single();
      if (shipErr || !s) throw new Error(`Failed to create shipment for bid ${bid.id}: ${shipErr?.message}`);
      finalShipmentId = s.id;
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

    const { error: manifestErr } = await supabase.from('cargo_manifest').insert({
      vehicle_id: window.vehicle_id,
      pickup_location: vendorOriginAddress,
      pickup_lat: vendorLat,
      pickup_lng: vendorLng,
      drop_location: manifestDropAddress,
      drop_lat: manifestDropLat,
      drop_lng: manifestDropLng,
      capacity_kg: bid.weight_kg,
      status: 'scheduled'
    });
    if (manifestErr) throw new Error(`Failed to create manifest for bid ${bid.id}: ${manifestErr.message}`);

    // 7. Inject the route stop for the vendor's drop-off point if there's an active route
    if (bid.dropoff_point_id) {
      let { data: route } = await supabase.from('routes')
        .select('id')
        .eq('vehicle_id', window.vehicle_id)
        .in('status', ['pending', 'active', 'in_progress'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!route) {
        const routeId = uuidv4();
        const { error: routeErr } = await supabase.from('routes').insert({
          id: routeId,
          vehicle_id: window.vehicle_id,
          status: 'active',
          total_distance_km: 0,
          total_duration_minutes: 0,
          estimated_fuel_liters: 0,
          weather_condition: 'clear',
          traffic_delay_minutes: 0,
          waypoints: []
        });
        if (routeErr) throw new Error(`Failed to create route for vehicle ${window.vehicle_id}: ${routeErr.message}`);
        route = { id: routeId };
      }

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
        const { error: stopErr } = await supabase.from('route_stops').insert({
          id: stopId,
          route_id: route.id,
          delivery_point_id: bid.dropoff_point_id,
          sequence: insertSequence,
          status: 'pending'
        });
        if (stopErr) throw new Error(`Failed to add route stop: ${stopErr.message}`);

        // Trigger driver confirmation for the new stop
        const { error: confErr } = await supabase.from('driver_confirmations').insert({
          route_stop_id: stopId,
          vehicle_id: window.vehicle_id,
          prompted_at: new Date().toISOString()
        });
        if (confErr) throw new Error(`Failed to create driver confirmation: ${confErr.message}`);
      }
    }

    // 8. Turn off the bidding_window_open flag
    await supabase.from('vehicles').update({ bidding_window_open: false, bidding_window_closes_at: null }).eq('id', window.vehicle_id);

    return bid;
  },

  /**
   * Inner timer start (client acks delivery of prompt)
   */
  async ackStopDelivery(confirmationId: string) {
    const { error } = await supabase
      .from('driver_confirmations')
      .update({ delivered_at: new Date().toISOString() })
      .eq('id', confirmationId);
    
    if (error) throw new Error(error.message);
  },

  /**
   * Superadmin manually rejects a backhaul bid
   */
  async rejectBid(bidId: string) {
    const { data: bid, error: rejectErr } = await supabase
      .from('capacity_bids')
      .update({ status: 'rejected' })
      .eq('id', bidId)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();
    if (rejectErr) throw new Error(`Failed to reject bid ${bidId}: ${rejectErr.message}`);
    if (!bid) {
      const { data: existing } = await supabase.from('capacity_bids').select('status').eq('id', bidId).maybeSingle();
      if (!existing) throw new HttpError(404, 'Bid not found');
      throw new HttpError(409, `Bid is already ${existing.status}`);
    }

    return { id: bidId, status: 'rejected' };
  },

  /**
   * Driver explicitly flags/rejects
   */
  async flagStop(confirmationId: string) {
    const { error } = await supabase
      .from('driver_confirmations')
      .update({ 
        responded_at: new Date().toISOString(),
        action: 'flagged' 
      })
      .eq('id', confirmationId);
    
    if (error) throw new Error(error.message);
  },

  /**
   * Background CRON to check for 2-min inner and 15-min outer timeouts
   */
  async checkConfirmationsTimeout() {
    const now = Date.now();

    const { data: pending, error } = await supabase
      .from('driver_confirmations')
      .select('id, prompted_at, delivered_at')
      .is('responded_at', null)
      .is('action', null);
    if (error) throw new Error(`Failed to load pending confirmations: ${error.message}`);

    for (const conf of pending ?? []) {
      // Inner timer: 2 min after the prompt reached the app; outer: 15 min after it was sent
      const action = conf.delivered_at
        ? (now - new Date(conf.delivered_at).getTime() >= 2 * 60_000 ? 'auto_accepted' : null)
        : (now - new Date(conf.prompted_at).getTime() >= 15 * 60_000 ? 'auto_accepted_offline' : null);
      if (!action) continue;

      // Only if the driver has not answered in the meantime
      const { error: updateErr } = await supabase
        .from('driver_confirmations')
        .update({ action })
        .eq('id', conf.id)
        .is('action', null);
      if (updateErr) console.error(`[capacity] Failed to auto-resolve confirmation ${conf.id}: ${updateErr.message}`);
    }
  }
};
