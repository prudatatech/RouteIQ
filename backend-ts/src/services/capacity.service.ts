import { supabase } from '../core/supabase';
import { optimizeService } from './optimize.service';
import { v4 as uuidv4 } from 'uuid';

export const capacityService = {
  /**
   * Submit a bid for a capacity window
   */
  async submitBid(data: { vendor_id: string; window_id: string; bid_amount: number; eway_bill_ref: string; dropoff_point_id: string; weight_kg: number; load_configuration: string }) {
    // Geofencing Check: Get vehicle location and vendor location
    const { data: window } = await supabase.from('capacity_windows').select('vehicles(latitude, longitude, city)').eq('id', data.window_id).single();
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
          const osrmRes = await axios.get(`https://router.project-osrm.org/route/v1/driving/${vLng},${vLat};${vndLng},${vndLat}?overview=false`);
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
          throw new Error(`Geofencing lock: The physical driving distance is ${drivingDistanceKm}km (ETA: ${etaMins} mins), which exceeds the 50km limit from your location.`);
        }
      }
    }

    const { data: bid, error } = await supabase.from('capacity_bids').insert({
      vendor_id: data.vendor_id,
      window_id: data.window_id,
      bid_amount: data.bid_amount,
      eway_bill_ref: data.eway_bill_ref,
      dropoff_point_id: data.dropoff_point_id,
      weight_kg: data.weight_kg,
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
        status: 'created',
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
      status: 'scheduled'
    });

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
        await supabase.from('routes').insert({
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

  async resolveWindow(windowId: string) {
    // 1. Fetch window and bids
    const { data: window } = await supabase.from('capacity_windows').select('*').eq('id', windowId).single();
    if (!window) return;

    const { data: bids } = await supabase.from('capacity_bids')
      .select('*')
      .eq('window_id', windowId)
      .not('eway_bill_ref', 'is', null) // Compliance gate
      .gte('bid_amount', window.floor_price)
      .order('bid_amount', { ascending: false }); // Highest bid first

    if (bids && bids.length > 0) {
      // We have a winner!
      const winningBid = bids[0];

      // Mark bid as won, others as lost
      await supabase.from('capacity_bids').update({ status: 'won' }).eq('id', winningBid.id);
      await supabase.from('capacity_bids').update({ status: 'lost' }).eq('window_id', windowId).neq('id', winningBid.id);

      // Update window
      await supabase.from('capacity_windows').update({ winning_bid_id: winningBid.id }).eq('id', windowId);

      // (In a real system, we would inject the vendor's cargo here as a new shipment)
      
    } else {
      // No compliant bids -> Fallback to backlog
      const { data: shipments } = await supabase
        .from('shipments')
        .select('*')
        .eq('status', 'created')
        .limit(1);

      if (shipments && shipments.length > 0) {
        const match = shipments[0];
        await supabase.from('capacity_windows').update({ 
          fallback_used: true,
          fallback_shipment_id: match.id 
        }).eq('id', windowId);

        // Inject stop via optimization service
        const stopId = await optimizeService.injectCapacityStop(window.vehicle_id, match.id);
        
        if (stopId) {
          await supabase.from('driver_confirmations').insert({
            route_stop_id: stopId,
            vehicle_id: window.vehicle_id,
            prompted_at: new Date().toISOString()
          });
        }
      } else {
        // No bids and no backlog (Status: No Match)
        await supabase.from('capacity_windows').update({ fallback_used: true }).eq('id', windowId);
      }
    }
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
    const { data: bid, error: bidErr } = await supabase.from('capacity_bids').select('*').eq('id', bidId).single();
    if (bidErr || !bid) throw new Error('Bid not found');

    await supabase.from('capacity_bids').update({ status: 'rejected' }).eq('id', bidId);

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
    const now = new Date();
    
    const { data: pending } = await supabase
      .from('driver_confirmations')
      .select('*')
      .is('responded_at', null)
      .is('action', null);

    if (!pending) return;

    for (const conf of pending) {
      const promptedAt = new Date(conf.prompted_at);
      const deliveredAt = conf.delivered_at ? new Date(conf.delivered_at) : null;

      if (deliveredAt) {
        // Inner Timer (2 min)
        const diffMins = (now.getTime() - deliveredAt.getTime()) / 60000;
        if (diffMins >= 2) {
          await supabase.from('driver_confirmations').update({
            action: 'auto_accepted'
          }).eq('id', conf.id);
        }
      } else {
        // Outer Timer (15 min)
        const diffMins = (now.getTime() - promptedAt.getTime()) / 60000;
        if (diffMins >= 15) {
          await supabase.from('driver_confirmations').update({
            action: 'auto_accepted_offline'
          }).eq('id', conf.id);
        }
      }
    }
  }
};
