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

    