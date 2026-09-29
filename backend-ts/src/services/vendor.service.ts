import { supabase } from '../core/supabase';
import { notificationService } from './notification.service';
import { HttpError } from '../core/errors';

/** Request states an admin can still act on (approve, reject or assign a vehicle). */
const OPEN_REQUEST_STATUSES = ['pending', 'approved'];

/**
 * Moves a request to `status` only if it is currently in one of `from`. The
 * conditional update is atomic per row, so two admins acting at once (or a
 * double click) cannot both succeed. Throws 404/409 when nothing was updated.
 */
async function transitionRequest(requestId: string, from: string[], update: Record<string, unknown>) {
  const { data, error } = await supabase
    .from('vendor_shipment_requests')
    .update({ ...update, updated_at: new Date().toISOString() })
    .eq('id', requestId)
    .in('status', from)
    .select()
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    const { data: existing } = await supabase.from('vendor_shipment_requests').select('status').eq('id', requestId).maybeSingle();
    if (!existing) throw new HttpError(404, 'Request not found');
    throw new HttpError(409, `Request is already ${existing.status}`);
  }
  return data;
}

/** Legal identity columns this service writes; changing one on an approved profile needs a new KYC review. */
const VENDOR_IDENTITY_FIELDS = ['company_name', 'gst_number', 'address'] as const;

export const vendorService = {
  /**
   * Save or update a vendor's own profile. Changing a legal identity field on
   * an approved profile sends it back to KYC review, as the database field
   * guard does for direct client edits (20260929000100).
   */
  async upsertProfile(vendorId: string, companyName: string, gstNumber: string, city: string, address: string, lat: number, lng: number) {
    const changes: Record<string, unknown> = {
      id: vendorId,
      company_name: companyName,
      gst_number: gstNumber,
      city: city,
      address: address,
      latitude: lat,
      longitude: lng,
      updated_at: new Date().toISOString()
    };

    const { data: current, error: currentErr } = await supabase
      .from('vendor_profiles')
      .select(['kyc_status', ...VENDOR_IDENTITY_FIELDS].join(', '))
      .eq('id', vendorId)
      .maybeSingle();
    if (currentErr) throw new Error(currentErr.message);
    const existing = current as Record<string, unknown> | null;
    if (existing?.kyc_status === 'approved'
        && VENDOR_IDENTITY_FIELDS.some(f => (changes[f] ?? null) !== (existing[f] ?? null))) {
      Object.assign(changes, { kyc_status: 'submitted', kyc_reviewed_at: null, kyc_reviewed_by: null });
    }

    const { data, error } = await supabase.from('vendor_profiles').upsert(changes).select().single();

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
  async createShipmentRequest(vendorId: string, pickup: any, drop: any, capacity: number, metadata: any = {}) {
    // 1. Calculate ETA and Distance
    const distanceKm = Math.sqrt(
      Math.pow(pickup.lat - drop.lat, 2) + Math.pow(pickup.lng - drop.lng, 2)
    ) * 111; // Approx km

    // Assume average speed of 40km/h for trucks
    const drivingHours = distanceKm / 40;
    
    // Add 20% buffer for halts/rests + 2 hours loading/unloading
    const totalHours = (drivingHours * 1.2) + 2;
    
    const isLongHaul = distanceKm > 500 || totalHours > 12; // Anomaly threshold

    const dispatchDate = new Date(); // Dispatching today/now
    const reportingDate = new Date();
    reportingDate.setHours(reportingDate.getHours() + Math.ceil(totalHours));

    // Enrich metadata with ETA and Consignor/Transporter rules
    const enrichedMetadata = {
      ...metadata,
      transporter: "Route IQ",
      consignor_id: vendorId, // We'll assume the client fetches actual vendor name if needed
      routing: {
        estimated_distance_km: Math.round(distanceKm),
        estimated_driving_hours: drivingHours.toFixed(1),
        total_estimated_hours: totalHours.toFixed(1),
        is_long_haul: isLongHaul,
        dispatch_date: dispatchDate.toISOString(),
        reporting_date: reportingDate.toISOString()
      },
      alerts: isLongHaul ? ['Requires Fuel Up Check', 'Strict Anomaly Monitoring'] : []
    };

    const { data, error } = await supabase.from('vendor_shipment_requests').insert({
      vendor_id: vendorId,
      pickup_location: pickup.address,
      pickup_lat: pickup.lat,
      pickup_lng: pickup.lng,
      drop_location: drop.address,
      drop_lat: drop.lat,
      drop_lng: drop.lng,
      required_capacity_kg: capacity,
      status: 'pending',
      metadata: enrichedMetadata
    }).select().single();

    if (error) throw new Error(error.message);

    // Notify super admins
    await notificationService.notifySuperAdmins(
      'New Vendor Request',
      `Vendor requested a ${capacity}kg shipment (${enrichedMetadata.cargo?.category || 'General'}) from ${pickup.address} to ${drop.address}. ETA: ${totalHours.toFixed(1)} hrs.`,
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
    const data = await transitionRequest(requestId, ['pending'], { status: 'approved' });

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
  async rejectRequest(requestId: string, reason: string) {
    const data = await transitionRequest(requestId, OPEN_REQUEST_STATUSES, { status: 'rejected', rejection_reason: reason });

    // Notify the vendor
    await notificationService.sendNotification(
      data.vendor_id,
      'Request Rejected',
      `Your shipment request from ${data.pickup_location} has been rejected by admins. Reason: ${reason}`,
      'request_rejected',
      { request_id: data.id }
    );

    return data;
  },

  /**
   * Staff rejects a vendor's KYC, storing why. Only a submission still
   * waiting for review can be decided, so a vendor who edits mid-review (or
   * a second reviewer) is not overwritten.
   */
  async rejectKyc(vendorId: string, reason: string) {
    const { data, error } = await supabase
      .from('vendor_profiles')
      .update({ kyc_status: 'rejected', kyc_rejection_reason: reason, kyc_reviewed_at: new Date().toISOString() })
      .eq('id', vendorId)
      .eq('kyc_status', 'submitted')
      .select('id, company_name')
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new HttpError(409, 'This KYC is no longer waiting for review');

    await notificationService.sendNotification(
      vendorId,
      'KYC Rejected',
      `Your KYC was not approved. Reason: ${reason}`,
      'kyc_rejected',
      { vendor_id: vendorId }
    );

    return data;
  },

  /**
   * Admin assigns a vehicle to a vendor request and creates a cargo manifest entry
   */
  async assignVehicleToRequest(requestId: string, vehicleId: string, cost?: number, costPerKm?: number) {
    const { data: before, error: beforeErr } = await supabase
      .from('vendor_shipment_requests').select('status').eq('id', requestId).maybeSingle();
    if (beforeErr) throw new Error(beforeErr.message);
    if (!before) throw new HttpError(404, 'Request not found');

    // Claim the request for this vehicle; fails if it was already assigned or closed
    const req = await transitionRequest(requestId, OPEN_REQUEST_STATUSES, {
      status: 'assigned',
      assigned_vehicle_id: vehicleId,
      ...(cost !== undefined ? { cost } : {}),
      ...(costPerKm !== undefined ? { cost_per_km: costPerKm } : {})
    });

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
      // Release the claim so the request can be assigned again
      await supabase.from('vendor_shipment_requests')
        .update({ status: before.status, assigned_vehicle_id: null, updated_at: new Date().toISOString() })
        .eq('id', requestId)
        .eq('status', 'assigned');
      throw new Error(`Failed to create manifest: ${manifestErr.message}`);
    }

    // Get vehicle to update load and notify driver
    const { data: vehicle } = await supabase.from('vehicles').select('driver_id, capacity_kg, current_load_kg, available_capacity_kg').eq('id', vehicleId).single();

    if (vehicle) {
      const newLoad = (vehicle.current_load_kg || 0) + req.required_capacity_kg;
      const newAvail = Math.max(0, (vehicle.available_capacity_kg ?? vehicle.capacity_kg) - req.required_capacity_kg);
      
      await supabase.from('vehicles').update({
        current_load_kg: newLoad,
        available_capacity_kg: newAvail,
        status: 'on_route'
      }).eq('id', vehicleId);
    }

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
      
      const { data: vehicleData } = await supabase.from('vehicles').select('vehicle_type, capacity_kg, available_capacity_kg').eq('id', vehicleId).single();
      // Vendors are not told which vehicle it is (plate) until they win capacity on it
      const vehicleDesc = vehicleData?.vehicle_type ? `A ${vehicleData.vehicle_type}` : 'A truck';
      
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
      .in('status', ['assigned', 'fulfilled'])
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
      .in('status', ['available', 'on_route', 'idle']);

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
      // Only what the card shows: never the full route or vehicle (plate, driver phone, live position)
      .select('*, routes(id, vehicles(vehicle_type))')
      .eq('vendor_id', vendorId)
      .eq('status', 'notified')
      .order('created_at', { ascending: false });
      
    if (error) throw new Error(error.message);
    return data;
  }
};
