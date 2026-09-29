import { supabase } from '../core/supabase';
import { v4 as uuidv4 } from 'uuid';
import { HttpError } from '../core/errors';
import { notificationService } from './notification.service';

/** Notifications are informative; a failure must not undo the bid operation. */
function notify(send: () => Promise<unknown>) {
  send().catch((e) => console.error('[capacity] Notification failed:', e));
}

/** A PostgREST to-one embed arrives as an object (or, for some relationships, a one-element array). */
function one<T>(embed: T | T[] | null | undefined): T | null {
  return (Array.isArray(embed) ? embed[0] : embed) ?? null;
}

/**
 * What a vendor sees of an open window: enough to decide and bid, nothing that
 * identifies or locates the vehicle or its driver (no plate, phone or position).
 */
function toVendorWindow(w: any) {
  const v = one<any>(w.vehicles);
  return {
    id: w.id,
    trigger_type: w.trigger_type ?? null,
    opens_at: w.opens_at,
    closes_at: w.closes_at,
    floor_price: w.floor_price,
    vehicles: v
      ? { vehicle_type: v.vehicle_type ?? null, available_capacity_kg: v.available_capacity_kg ?? null }
      : null,
  };
}

/** A vendor's own bid; the plate is shown only once the vendor has won the window (needed for handover). */
function toVendorBid(b: any) {
  const w = one<any>(b.capacity_windows);
  const v = one<any>(w?.vehicles);
  const { capacity_windows: _omit, ...bid } = b;
  return {
    ...bid,
    capacity_windows: w
      ? {
          trigger_type: w.trigger_type ?? null,
          vehicles: v
            ? { vehicle_type: v.vehicle_type ?? null, ...(b.status === 'won' ? { plate_number: v.plate_number ?? null } : {}) }
            : null,
        }
      : null,
  };
}

export const capacityService = {
  /**
   * Open capacity windows as vendors see them (see toVendorWindow).
   */
  async listOpenWindowsForVendors() {
    const { data, error } = await supabase
      .from('capacity_windows')
      .select('id, trigger_type, opens_at, closes_at, floor_price, vehicles(vehicle_type, available_capacity_kg)')
      .gt('closes_at', new Date().toISOString())
      .is('winning_bid_id', null)
      .order('opens_at', { ascending: false });
    if (error) throw new Error(`Failed to load open windows: ${error.message}`);
    return (data ?? []).map(toVendorWindow);
  },

  /**
   * A vendor's bids, newest first (see toVendorBid).
   */
  async listVendorBids(vendorId: string) {
    const { data, error } = await supabase
      .from('capacity_bids')
      .select('*, capacity_windows!capacity_bids_window_id_fkey(trigger_type, vehicles(vehicle_type, plate_number))')
      .eq('vendor_id', vendorId)
      .order('submitted_at', { ascending: false });
    if (error) throw new Error(`Failed to load bids: ${error.message}`);
    return (data ?? []).map(toVendorBid);
  },

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
      .select('id, opens_at, closes_at, floor_price, winning_bid_id, vehicles(plate_number, latitude, longitude, available_capacity_kg)')
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

    notify(() => notificationService.notifyStaff(
      'New Capacity Bid',
      `A vendor bid ₹${bidAmount} for ${weightKg} kg on ${windowVehicle?.plate_number ?? 'a vehicle'}.`,
      'capacity_bid',
      { bid_id: bid.id, window_id: data.window_id }
    ));
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
      status: 'open',
      fallback_shipment_id: sourceShipmentId || null
    }).select().single();

    if (error) throw new Error(error.message);

    // Removed 60s auto-resolver setTimeout. Bids now wait for manual Superadmin approval.

    return window;
  },

  /**
   * Staff open a bidding window on a vehicle from the console.
   * The capacity offered is what the vehicle has free right now.
   */
  async openWindowForStaff(input: { vehicleId: string; floorPrice: number; durationMinutes: number; shipmentId?: string | null; createdBy?: string | null }) {
    const { vehicleId, floorPrice, durationMinutes, shipmentId } = input;
    if (!Number.isFinite(floorPrice) || floorPrice < 0) throw new HttpError(400, 'floor_price must be zero or more');
    if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 24 * 60) {
      throw new HttpError(400, 'duration_minutes must be a whole number from 5 to 1440');
    }

    const { data: vehicle, error: vehicleErr } = await supabase
      .from('vehicles').select('id, plate_number, available_capacity_kg').eq('id', vehicleId).maybeSingle();
    if (vehicleErr) throw new Error(`Failed to load vehicle: ${vehicleErr.message}`);
    if (!vehicle) throw new HttpError(404, 'Vehicle not found');
    const freeKg = Number(vehicle.available_capacity_kg) || 0;
    if (freeKg <= 0) throw new HttpError(400, 'This vehicle has no free capacity to offer');

    if (shipmentId) {
      const { data: shipment, error: shipmentErr } = await supabase.from('shipments').select('id').eq('id', shipmentId).maybeSingle();
      if (shipmentErr) throw new Error(`Failed to load shipment: ${shipmentErr.message}`);
      if (!shipment) throw new HttpError(404, 'Shipment not found');
    }

    const { data: running, error: runningErr } = await supabase
      .from('capacity_windows').select('id')
      .eq('vehicle_id', vehicleId).eq('status', 'open').is('winning_bid_id', null)
      .gt('closes_at', new Date().toISOString());
    if (runningErr) throw new Error(`Failed to check existing windows: ${runningErr.message}`);
    if (running && running.length > 0) throw new HttpError(409, 'This vehicle already has an open bidding window');

    const opensAt = new Date();
    const closesAt = new Date(opensAt.getTime() + durationMinutes * 60_000);
    const window = await this.openBackhaulWindow(
      vehicleId, freeKg, 'superadmin_dispatch', opensAt.toISOString(), closesAt.toISOString(), floorPrice, shipmentId ?? undefined,
    );
    if (input.createdBy) {
      await supabase.from('capacity_windows').update({ created_by: input.createdBy }).eq('id', window.id);
    }
    const { error: flagErr } = await supabase
      .from('vehicles').update({ bidding_window_open: true, bidding_window_closes_at: closesAt.toISOString() }).eq('id', vehicleId);
    if (flagErr) console.error(`[capacity] Failed to flag vehicle ${vehicleId} as bidding: ${flagErr.message}`);
    return window;
  },

  /**
   * Windows for the console: recent first, with the vehicle, the linked shipment and how many bids wait.
   */
  async listWindowsForStaff(limit = 50) {
    const { data, error } = await supabase
      .from('capacity_windows')
      .select('id, vehicle_id, opens_at, closes_at, floor_price, winning_bid_id, fallback_shipment_id, trigger_type, status, resolved_at, vehicles(plate_number, vehicle_type, available_capacity_kg)')
      .order('opens_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(`Failed to load windows: ${error.message}`);
    const windows = data ?? [];
    const ids = windows.map((w: any) => w.id);
    const shipmentIds = windows.map((w: any) => w.fallback_shipment_id).filter(Boolean);

    const [bids, shipments] = await Promise.all([
      ids.length
        ? supabase.from('capacity_bids').select('id, window_id, status').in('window_id', ids)
        : Promise.resolve({ data: [], error: null } as any),
      shipmentIds.length
        ? supabase.from('shipments').select('id, tracking_id').in('id', shipmentIds)
        : Promise.resolve({ data: [], error: null } as any),
    ]);
    if (bids.error) throw new Error(`Failed to load bid counts: ${bids.error.message}`);
    if (shipments.error) throw new Error(`Failed to load linked shipments: ${shipments.error.message}`);

    const counts = new Map<string, { total: number; pending: number }>();
    for (const b of bids.data ?? []) {
      const c = counts.get(b.window_id) ?? { total: 0, pending: 0 };
      c.total += 1;
      if (b.status === 'pending') c.pending += 1;
      counts.set(b.window_id, c);
    }
    const tracking = new Map((shipments.data ?? []).map((s: any) => [s.id, s.tracking_id]));

    const now = Date.now();
    return windows.map((w: any) => ({
      ...w,
      vehicles: one(w.vehicles),
      // A window past its end that the scheduler has not closed yet counts as closed
      state: w.status !== 'open' ? w.status : (w.winning_bid_id || new Date(w.closes_at).getTime() <= now ? 'closed' : 'open'),
      bid_count: counts.get(w.id)?.total ?? 0,
      pending_bid_count: counts.get(w.id)?.pending ?? 0,
      shipment_tracking_id: w.fallback_shipment_id ? tracking.get(w.fallback_shipment_id) ?? null : null,
    }));
  },

  /**
   * Ends a window. Safe to call twice: only a window that is still 'open' is changed.
   *   - 'closed': stops new bids. Pending bids stay for staff to approve or reject.
   *   - 'cancelled': stops new bids and turns pending bids down.
   * Returns null when the window was already closed or cancelled.
   */
  async endWindow(windowId: string, mode: 'closed' | 'cancelled') {
    const nowIso = new Date().toISOString();
    const { data: window, error } = await supabase
      .from('capacity_windows')
      .update({ status: mode, resolved_at: nowIso, closes_at: nowIso })
      .eq('id', windowId)
      .eq('status', 'open')
      .select('id, vehicle_id, winning_bid_id')
      .maybeSingle();
    if (error) throw new Error(`Failed to end window ${windowId}: ${error.message}`);
    if (!window) return null;

    // The vehicle stops advertising unless a different window is still running for it
    const { data: others } = await supabase
      .from('capacity_windows').select('id')
      .eq('vehicle_id', window.vehicle_id).eq('status', 'open').is('winning_bid_id', null)
      .gt('closes_at', nowIso);
    if (!others || others.length === 0) {
      const { error: flagErr } = await supabase
        .from('vehicles').update({ bidding_window_open: false, bidding_window_closes_at: null }).eq('id', window.vehicle_id);
      if (flagErr) console.error(`[capacity] Failed to clear bidding flag on ${window.vehicle_id}: ${flagErr.message}`);
    }

    if (mode === 'cancelled') {
      const { data: turnedDown, error: bidErr } = await supabase
        .from('capacity_bids')
        .update({ status: 'rejected', rejection_reason: 'The bidding window was cancelled' })
        .eq('window_id', windowId)
        .eq('status', 'pending')
        .select('id, vendor_id, bid_amount');
      if (bidErr) throw new Error(`Failed to reject bids on window ${windowId}: ${bidErr.message}`);
      for (const bid of turnedDown ?? []) {
        notify(() => notificationService.sendNotification(
          bid.vendor_id, 'Bid Rejected',
          `Your bid of ₹${bid.bid_amount} was not accepted. The bidding window was cancelled.`,
          'bid_rejected', { bid_id: bid.id },
        ));
      }
    }
    return window;
  },

  /**
   * Scheduler step for one window: closes it, and tells staff if bids are waiting
   * for a decision. Idempotent (see endWindow); returns false if it was already ended.
   */
  async resolveWindow(windowId: string) {
    const closed = await this.endWindow(windowId, 'closed');
    if (!closed) return false;
    const { data: pending } = await supabase
      .from('capacity_bids').select('id').eq('window_id', windowId).eq('status', 'pending');
    if (pending && pending.length > 0) {
      notify(() => notificationService.notifyStaff(
        'Bidding window closed',
        `A bidding window has closed with ${pending.length} bid${pending.length === 1 ? '' : 's'} waiting for your decision.`,
        'capacity_window_closed',
        { window_id: windowId },
      ));
    }
    return true;
  },

  /**
   * Scheduler: closes every open window whose end time has passed. Returns how many it closed.
   */
  async resolveExpiredWindows() {
    const { data, error } = await supabase
      .from('capacity_windows')
      .select('id')
      .eq('status', 'open')
      .lte('closes_at', new Date().toISOString());
    if (error) throw new Error(`Failed to load expired windows: ${error.message}`);
    let closed = 0;
    for (const w of data ?? []) {
      try {
        if (await this.resolveWindow(w.id)) closed += 1;
      } catch (e: any) {
        console.error(`[capacity] Failed to close window ${w.id}: ${e.message}`);
      }
    }
    return closed;
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
    const { data: losingBids, error: loseErr } = await supabase
      .from('capacity_bids')
      .update({ status: 'lost' })
      .eq('window_id', windowId)
      .eq('status', 'pending')
      .select('id, vendor_id');
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

    notify(() => notificationService.sendNotification(
      bid.vendor_id,
      'Bid Accepted',
      `Your bid of ₹${bid.bid_amount} for ${bid.weight_kg} kg was accepted. The truck has been routed to your pickup.`,
      'bid_accepted',
      { bid_id: bid.id, shipment_id: finalShipmentId }
    ));
    for (const lost of losingBids ?? []) {
      notify(() => notificationService.sendNotification(
        lost.vendor_id,
        'Bid Not Selected',
        'Another bid was accepted for this truck. Watch Live Corridors for new capacity.',
        'bid_lost',
        { bid_id: lost.id }
      ));
    }

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
  async rejectBid(bidId: string, reason: string) {
    const { data: bid, error: rejectErr } = await supabase
      .from('capacity_bids')
      .update({ status: 'rejected', rejection_reason: reason })
      .eq('id', bidId)
      .eq('status', 'pending')
      .select('id, vendor_id, bid_amount')
      .maybeSingle();
    if (rejectErr) throw new Error(`Failed to reject bid ${bidId}: ${rejectErr.message}`);
    if (!bid) {
      const { data: existing } = await supabase.from('capacity_bids').select('status').eq('id', bidId).maybeSingle();
      if (!existing) throw new HttpError(404, 'Bid not found');
      throw new HttpError(409, `Bid is already ${existing.status}`);
    }

    notify(() => notificationService.sendNotification(
      bid.vendor_id,
      'Bid Rejected',
      `Your bid of ₹${bid.bid_amount} was not accepted. Reason: ${reason}`,
      'bid_rejected',
      { bid_id: bid.id }
    ));
    return { id: bidId, status: 'rejected', rejection_reason: reason };
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
