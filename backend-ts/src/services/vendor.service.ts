import { supabase } from '../core/supabase';
import { notificationService } from './notification.service';

export const vendorService = {
  /**
   * Save or update vendor profile coordinates and details
   */
  async upsertProfile(vendorId: string, companyName: string, gstNumber: string, city: string, address: string, lat: number, lng: number) {
    const { data, error } = await supabase.from('vendor_profiles').upsert({
      id: vendorId,
      company_name: companyName,
      gst_number: gstNumber,
      city: city,
      address: address,
      latitude: lat,
      longitude: lng,
      updated_at: new Date().toISOString()
    }).select().single();

    if (error) throw new Error(error.message);
    return data;
  },

  /**
   * Fetch a vendor profile
   */
  async getProfile(vendorId: string) {
    const { data, error } = await supabase.from('vendor_profiles').select('*').eq('id', vendorId).single();
    if (error && error.code !== 'PGRST116') throw new Error(error.message);
    return data;
  },

  /**
   * Vendor creates a custom shipment request
   */
  async createShipmentRequest(vendorId: string, pickup: any, drop: any, capacity: number) {
    const { data, error } = await supabase.from('vendor_shipment_requests').insert({
      vendor_id: vendorId,
      pickup_location: pickup.address,
      pickup_lat: pickup.lat,
      pickup_lng: pickup.lng,
      drop_location: drop.address,
      drop_lat: drop.lat,
      drop_lng: drop.lng,
      required_capacity_kg: capacity,
      status: 'pending'
    }).select().single();

    if (error) throw new Error(error.message);

    // Notify super admins
    await notificationService.notifySuperAdmins(
      'New Vendor Request',
      `Vendor requested a ${capacity}kg shipment from ${pickup.address} to ${drop.address}.`,
      'vendor_request',
      { request_id: data.id }
    );

    return data;
  },

  /**
   * Super admin fetches all pending requests
   */
  async getPendingRequests() {
    const { data: requests, error } = await supabase.from('vendor_shipment_requests').select('*').in('status', ['pending', 'approved']).order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    
    if (!requests || requests.length === 0) return [];
    
    const vendorIds = [...new Set(requests.map(r => r.vendor_id))];
    const { data: profiles, error: profError } = await supabase
      .from('vendor_profiles')
      .select('id, company_name')
      .in('id', vendorIds);
      
    if (profError) throw new Error(profError.message);
    
    const profileMap = profiles.reduce((acc: any, p: any) => {
      acc[p.id] = p;
      return acc;
    }, {});
    
    return requests.map(r => ({
      ...r,
      vendor_profiles: profileMap[r.vendor_id] || null
    }));
  },

  /**
   * Super admin approves a vendor shipment request
   */
  async approveRequest(requestId: string) {
    const { data, error } = await supabase.from('vendor_shipment_requests').update({
      status: 'approved',
      updated_at: new Date().toISOString()
    }).eq('id', requestId).select().single();

    if (error) throw new Error(error.message);

    // Notify the vendor
    await notificationService.sendNotification(
      data.vendor_id,
      'Request Approved',
      `Your shipment request from ${data.pickup_location} has been approved by admins.`,
      'request_approved',
      { request_id: data.id }
    );

    return data;
  },

  /**
   * Super admin rejects a vendor shipment request
   */
  async rejectRequest(requestId: string) {
    const { data, error } = await supabase.from('vendor_shipment_requests').update({
      status: 'rejected',
      updated_at: new Date().toISOString()
    }).eq('id', requestId).select().single();

    if (error) throw new Error(error.message);

    // Notify the vendor
    await notificationService.sendNotification(
      data.vendor_id,
      'Request Rejected',
      `Your shipment request from ${data.pickup_location} has been rejected by admins.`,
      'request_rejected',
      { request_id: data.id }
    );

    return data;
  },

  /**
   * Admin assigns a vehicle to a vendor request and creates a cargo manifest entry
   */
  async assignVehicleToRequest(requestId: string, vehicleId: string, cost?: number, costPerKm?: number) {
    // Get the request details
    const { data: req, error: reqErr } = await supabase
      .from('vendor_shipment_requests')
      .select('*')
      .eq('id', requestId)
      .single();
    if (reqErr) throw new Error(reqErr.message);

    // Update request status. Since 'assigned' might violate CHECK constraint if migration 018 wasn't run,
    // we use 'fulfilled' which is a valid status in the original schema and removes it from the pending list.
    const updatePayload: any = {
      status: 'fulfilled', // Workaround for check constraint
      updated_at: new Date().toISOString()
    };
    
    // Try setting assigned_vehicle_id if column exists
    try {
      await supabase.from('vendor_shipment_requests').update({
        ...updatePayload,
        assigned_vehicle_id: vehicleId,
        ...(cost !== undefined ? { cost } : {}),
        ...(costPerKm !== undefined ? { cost_per_km: costPerKm } : {})
      }).eq('id', requestId);
    } catch (_) { 
      // Column may not exist, fall back to simple update
      await supabase.from('vendor_shipment_requests').update(updatePayload).eq('id', requestId);
    }

    // Insert into cargo_manifest
    const { error: manifestErr } = await supabase.from('cargo_manifest').insert({
      vehicle_id: vehicleId,
      vendor_request_id: requestId,
      pickup_location: req.pickup_location,
      pickup_lat: req.pickup_lat,
      pickup_lng: req.pickup_lng,
      drop_location: req.drop_location,
      drop_lat: req.drop_lat,
      drop_lng: req.drop_lng,
      capacity_kg: req.required_capacity_kg,
      status: 'scheduled',
      created_at: new Date().toISOString()
    });

    if (manifestErr) {
      console.error('Failed to create cargo_manifest:', manifestErr);
      throw new Error(`Failed to create manifest: ${manifestErr.message}`);
    }

    // Get Driver ID for notification
    const { data: vehicle } = await supabase.from('vehicles').select('driver_id').eq('id', vehicleId).single();

    if (vehicle?.driver_id) {
      // Notify the driver instantly so the listener triggers
      await notificationService.sendNotification(
        vehicle.driver_id,
        'New Cargo Assigned',
        `A new pickup has been scheduled at ${req.pickup_location}.`,
        'cargo_assigned',
        { request_id: requestId, vehicle_id: vehicleId }
      );
    }

    // Notify the vendor
    await notificationService.sendNotification(
      req.vendor_id,
      'Vehicle Assigned!',
      `A vehicle has been assigned to your shipment request from ${req.pickup_location}.`,
      'vehicle_assigned',
      { request_id: requestId, vehicle_id: vehicleId }
    );
    
    return { success: true };
  },

  /**
   * Match a newly created route to nearby vendors
   */
  async matchRouteToVendors(routeId: string, vehicleId: string, originLat: number, originLng: number, destLat: number, destLng: number) {
    try {
      const { mapsService } = await import('./maps.service');
      const polylineEncoded = await mapsService.getRoutePolyline(originLat, originLng, destLat, destLng);
      if (!polylineEncoded) return;
      
      const sampledPoints = mapsService.samplePolylinePoints(polylineEncoded, 15);
      
      const { data, error } = await supabase.rpc('match_vendors_to_route', {
        route_points: sampledPoints,
        radius_km: 50.0
      });
      
      if (error || !data || data.length === 0) return;
      
      const { data: vehicleData } = await supabase.from('vehicles').select('plate_number, capacity_kg, available_capacity_kg').eq('id', vehicleId).single();
      const vehicleDesc = vehicleData?.plate_number ? `Truck ${vehicleData.plate_number}` : 'A truck';
      
      // Notify matched vendors
      for (const match of data) {
        // Insert opportunity
        await supabase.from('vendor_route_opportunities').upsert({
          route_id: routeId,
          vendor_id: match.vendor_id,
          eta_minutes: Math.round(match.min_distance_km), // Rough ETA approximation
          available_capacity_kg: vehicleData?.available_capacity_kg ?? vehicleData?.capacity_kg ?? 0
        }, { onConflict: 'route_id, vendor_id' });
        
        await notificationService.sendNotification(
          match.vendor_id,
          'Passing Capacity Available!',
          `${vehicleDesc} is passing within ${Math.round(match.min_distance_km)}km of you! Want to drop something?`,
          'passing_route',
          { route_id: routeId }
        );
      }
    } catch (err: any) {
      console.error('Failed to match vendors to route:', err.message);
    }
  },

  /**
   * Get current market rates — aggregated from recent shipments
   */
  async getMarketRates() {
    // Try to compute average from recent assigned shipments
    const { data: recent } = await supabase
      .from('vendor_shipment_requests')
      .select('cost, cost_per_km, required_capacity_kg')
      .eq('status', 'assigned')
      .order('updated_at', { ascending: false })
      .limit(20);

    let avgCostPerKm = 18; // Default ₹18/km
    let avgCostPerKg = 2.5; // Default ₹2.5/kg
    let totalAssigned = 0;

    if (recent && recent.length > 0) {
      const withCost = recent.filter((r: any) => r.cost_per_km && r.cost_per_km > 0);
      if (withCost.length > 0) {
        avgCostPerKm = Math.round(withCost.reduce((sum: number, r: any) => sum + r.cost_per_km, 0) / withCost.length * 100) / 100;
      }
      const withKg = recent.filter((r: any) => r.cost && r.required_capacity_kg);
      if (withKg.length > 0) {
        avgCostPerKg = Math.round(withKg.reduce((sum: number, r: any) => sum + (r.cost / r.required_capacity_kg), 0) / withKg.length * 100) / 100;
      }
      totalAssigned = recent.length;
    }

    // Count active fleet vehicles
    const { count: fleetCount } = await supabase
      .from('vehicles')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active');

    return {
      avg_cost_per_km: avgCostPerKm,
      avg_cost_per_kg: avgCostPerKg,
      active_fleet: fleetCount || 0,
      recent_shipments: totalAssigned,
      currency: 'INR',
      updated_at: new Date().toISOString()
    };
  },

  /**
   * Fetch passing route opportunities for a vendor
   */
  async getPassingRoutes(vendorId: string) {
    const { data, error } = await supabase
      .from('vendor_route_opportunities')
      .select('*, routes(*, vehicles(*))')
      .eq('vendor_id', vendorId)
      .eq('status', 'notified')
      .order('created_at', { ascending: false });
      
    if (error) throw new Error(error.message);
    return data;
  }
};
