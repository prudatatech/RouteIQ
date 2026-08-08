/**
 * RouteIQ — Shipment Service
 * Ports: backend/app/services/shipment_service.py
 */
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../core/supabase';
import { SecurityService } from './security.service';
import type { Shipment, ShipmentLog, Parcel, DeliveryPoint } from '../db/types';
import type { ShipmentCreate } from '../schemas';

const getDist = (lat1: number, lon1: number, lat2: number, lon2: number): string => {
  if (!lat1 || !lon1 || !lat2 || !lon2) return "Pending";
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return Math.round(R * c * 1.3).toString();
};

export class ShipmentService {
  /**
   * Records a tamper-evident log for a shipment status change.
   */
  static async recordShipmentLog(
    shipmentId: string,
    status: string,
    lat?: number | null,
    lng?: number | null,
    metadata?: Record<string, any>
  ): Promise<ShipmentLog> {
    // 1. Fetch last log to get previous hash and index
    const { data: lastLogs } = await supabase
      .from('shipment_logs')
      .select('*')
      .eq('shipment_id', shipmentId)
      .order('index', { ascending: false })
      .limit(1);

    const lastLog = lastLogs?.[0];
    const prevHash = lastLog?.log_hash || '0'.repeat(64);
    const newIndex = lastLog ? lastLog.index + 1 : 0;

    // 2. Prepare data for hashing
    const timestamp = new Date().toISOString();
    const data = {
      shipment_id: shipmentId,
      status,
      location_lat: lat ?? null,
      location_lng: lng ?? null,
      timestamp,
      index: newIndex,
      metadata: metadata || {},
    };

    // 3. Generate hash
    const newHash = SecurityService.generateHash(data, prevHash);

    // 4. Insert log
    const { data: inserted, error } = await supabase
      .from('shipment_logs')
      .insert({
        id: uuidv4(),
        shipment_id: shipmentId,
        status,
        location_lat: lat ?? null,
        location_lng: lng ?? null,
        timestamp,
        index: newIndex,
        previous_hash: prevHash,
        log_hash: newHash,
        metadata_json: metadata || {},
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to record shipment log: ${error.message}`);
    return inserted as ShipmentLog;
  }

  /**
   * Recalculates available capacity for a specific vehicle based on active shipments.
   */
  static async recalculateVehicleCapacity(vehicleId: string): Promise<void> {
    if (!vehicleId) return;

    // 1. Get vehicle total capacity
    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('capacity_kg')
      .eq('id', vehicleId)
      .single();

    if (!vehicle) return;

    // 2. Sum declared load of active shipments for this vehicle
    // We find shipments that are tied to this vehicle via routes/route_stops
    // For simplicity, if shipments have a vehicle_id, we'd use that, but shipments are linked via routes.
    // Let's get active routes for the vehicle, then stops, then delivery points, then shipments
    const { data: routes } = await supabase
      .from('routes')
      .select('id')
      .eq('vehicle_id', vehicleId)
      .in('status', ['active', 'pending']);

    let totalLoad = 0;
    if (routes && routes.length > 0) {
      const routeIds = routes.map((r: any) => r.id);
      const { data: stops } = await supabase
        .from('route_stops')
        .select('delivery_point_id')
        .in('route_id', routeIds)
        .in('status', ['pending']);

      if (stops && stops.length > 0) {
        const dpIds = stops.map((s: any) => s.delivery_point_id);
        const { data: dps } = await supabase
          .from('delivery_points')
          .select('shipment_id')
          .in('id', dpIds);

        if (dps && dps.length > 0) {
          const shipmentIds = dps.map((dp: any) => dp.shipment_id).filter(Boolean);
          if (shipmentIds.length > 0) {
            const { data: activeShipments } = await supabase
              .from('shipments')
              .select('total_weight_kg') // Reverted declared_load_kg due to schema cache issues
              .in('id', shipmentIds)
              .in('status', ['created', 'picked_up', 'in_transit']);

            if (activeShipments) {
              totalLoad = activeShipments.reduce((sum: number, s: any) => sum + (s.total_weight_kg || 0), 0);
            }
          }
        }
      }
    }

    const available = Math.max(0, vehicle.capacity_kg - totalLoad);

    const updatePayload: any = {
      available_capacity_kg: available,
      capacity_updated_at: new Date().toISOString()
    };

    if (available === vehicle.capacity_kg) {
      updatePayload.status = 'available';
    }

    // 3. Update vehicle
    await supabase
      .from('vehicles')
      .update(updatePayload)
      .eq('id', vehicleId);
  }

  /**
   * Create a new shipment with parcels.
   */
  static async createShipment(shipmentIn: ShipmentCreate): Promise<Shipment> {
    const trackingId = shipmentIn.tracking_id || `RTX-${uuidv4().replace(/-/g, '').substring(0, 8).toUpperCase()}`;

    // 1. Insert shipment
    const shipmentId = uuidv4();
    const { data: dbShipment, error: shipErr } = await supabase
      .from('shipments')
      .insert({
        id: shipmentId,
        tracking_id: trackingId,
        priority: shipmentIn.priority,
        status: 'created',
        origin_name: shipmentIn.origin_name,
        origin_address: shipmentIn.origin_address,
        origin_lat: shipmentIn.origin_lat,
        origin_lng: shipmentIn.origin_lng,
        total_items: shipmentIn.total_items,
        total_weight_kg: shipmentIn.total_weight_kg,
        // declared_load_kg: shipmentIn.declared_load_kg,
        // load_type: shipmentIn.load_type,
      })
      .select()
      .single();

    if (shipErr || !dbShipment) throw new Error(`Failed to create shipment: ${shipErr?.message}`);

    // 2. Insert parcels
    let totalWeight = 0;
    if (shipmentIn.parcels && shipmentIn.parcels.length > 0) {
      const parcelRows = shipmentIn.parcels.map((p) => ({
        id: uuidv4(),
        shipment_id: dbShipment.id,
        weight_kg: p.weight_kg,
        length_cm: p.length_cm,
        width_cm: p.width_cm,
        height_cm: p.height_cm,
        category: p.category,
        is_hazardous: p.is_hazardous,
        is_fragile: p.is_fragile,
      }));
      await supabase.from('parcels').insert(parcelRows);
      totalWeight = shipmentIn.parcels.reduce((sum, p) => sum + p.weight_kg, 0);
    }

    // 3. Handle delivery point
    const dpId = shipmentIn.delivery_point_id;
    const isUUID = typeof dpId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(dpId);

    let finalDpId = dpId;

    if (!isUUID) {
      // Create a new DeliveryPoint
      const newDpId = uuidv4();
      const { data: newDp } = await supabase.from('delivery_points').insert({
        id: newDpId,
        name: shipmentIn.open_bidding ? 'Pending Vendor Bid' : (shipmentIn.dest_name || 'New Location'),
        address: shipmentIn.open_bidding ? 'Awaiting Marketplace Match' : (shipmentIn.dest_address || 'Unknown Address'),
        latitude: shipmentIn.dest_lat || 0.0,
        longitude: shipmentIn.dest_lng || 0.0,
        demand_kg: totalWeight || shipmentIn.total_weight_kg || 0.0,
        shipment_id: dbShipment.id,
        status: 'pending',
      }).select().single();
      finalDpId = newDp?.id || newDpId;
    } else {
      // Update existing DP
      await supabase
        .from('delivery_points')
        .update({
          shipment_id: dbShipment.id,
          demand_kg: totalWeight || shipmentIn.total_weight_kg || 1.0,
        })
        .eq('id', dpId);
    }

    // 4. Create Route if vehicle_id is provided
    if (shipmentIn.vehicle_id && finalDpId) {
      const routeId = uuidv4();
      const { data: dbRoute } = await supabase.from('routes').insert({
        id: routeId,
        vehicle_id: shipmentIn.vehicle_id,
        status: 'active',
        total_distance_km: 0,
        total_duration_minutes: 0,
        estimated_fuel_liters: 0,
        weather_condition: 'clear',
        traffic_delay_minutes: 0,
        waypoints: [],
      }).select().single();

      if (dbRoute || routeId) {
        if (!shipmentIn.open_bidding) {
          await supabase.from('route_stops').insert({
            id: uuidv4(),
            route_id: dbRoute?.id || routeId,
            delivery_point_id: finalDpId,
            sequence: 1,
            status: 'pending'
          });
        }
        
        // Trigger background dynamic route matching for vendors
        if (shipmentIn.origin_lat && shipmentIn.origin_lng && shipmentIn.dest_lat && shipmentIn.dest_lng) {
          // Fire and forget, do not await to block the request
          import('./vendor.service').then(({ vendorService }) => {
            vendorService.matchRouteToVendors(
              dbRoute?.id || routeId,
              shipmentIn.vehicle_id!,
              shipmentIn.origin_lat!,
              shipmentIn.origin_lng!,
              shipmentIn.dest_lat!,
              shipmentIn.dest_lng!
            ).catch(console.error);
          });
        }
        
        // Open Superadmin Bidding Window if requested
        if (shipmentIn.open_bidding && shipmentIn.vehicle_id) {
          const { data: vehicle } = await supabase.from('vehicles').select('capacity_kg, available_capacity_kg').eq('id', shipmentIn.vehicle_id).single();
          if (vehicle) {
            const remainingCap = vehicle.available_capacity_kg ?? vehicle.capacity_kg ?? 0;
            if (remainingCap > 0) {
              import('./capacity.service').then(({ capacityService }) => {
                capacityService.openBackhaulWindow(
                  shipmentIn.vehicle_id!,
                  remainingCap,
                  'superadmin_dispatch',
                  shipmentIn.bidding_opens_at || undefined,
                  shipmentIn.bidding_closes_at || undefined,
                  shipmentIn.asking_price ? Number(shipmentIn.asking_price) : undefined,
                  dbShipment.id
                );
              });
            }
          }
        }
      }
    }

    // 5. Create tamper-evident log
    await ShipmentService.recordShipmentLog(dbShipment.id, 'created');

    // 6. Recalculate vehicle capacity if vehicle assigned
    if (shipmentIn.vehicle_id) {
      await ShipmentService.recalculateVehicleCapacity(shipmentIn.vehicle_id);
    }

    // 7. Return full shipment
    const shipment = await ShipmentService.getShipment(dbShipment.id);
    if (!shipment) throw new Error('Failed to retrieve created shipment');
    return shipment;
  }

  /**
   * Assign a driver/vehicle to an existing shipment.
   */
  static async assignDriver(shipmentId: string, vehicleId: string): Promise<Shipment | null> {
    const shipment = await this.getShipment(shipmentId);
    if (!shipment) throw new Error('Shipment not found');
    if (!shipment.delivery_point) throw new Error('Shipment has no delivery point');

    // Clean up any existing route stops for this delivery point
    await supabase.from('route_stops').delete().eq('delivery_point_id', shipment.delivery_point.id);

    // Find active or pending route for this vehicle
    const { data: existingRoutes } = await supabase
      .from('routes')
      .select('id, status')
      .eq('vehicle_id', vehicleId)
      .in('status', ['pending', 'active'])
      .order('created_at', { ascending: false })
      .limit(1);

    let routeId = existingRoutes?.[0]?.id;

    if (!routeId) {
      // Create new route
      routeId = uuidv4();
      const { error: routeErr } = await supabase.from('routes').insert({
        id: routeId,
        vehicle_id: vehicleId,
        status: 'active',
        total_distance_km: 0,
        total_duration_minutes: 0,
        estimated_fuel_liters: 0,
        weather_condition: 'clear',
        traffic_delay_minutes: 0,
        waypoints: [],
      });
      if (routeErr) throw new Error(`Failed to create route: ${routeErr.message}`);
    }

    // Add route stop
    const { error: stopErr } = await supabase.from('route_stops').insert({
      id: uuidv4(),
      route_id: routeId,
      delivery_point_id: shipment.delivery_point.id,
      sequence: 1,
      status: 'pending'
    });
    
    if (stopErr) throw new Error(`Failed to create route stop: ${stopErr.message}`);

    // Optionally trigger vendor match
    if (shipment.origin_lat && shipment.origin_lng && shipment.delivery_point.latitude && shipment.delivery_point.longitude) {
      import('./vendor.service').then(({ vendorService }) => {
        vendorService.matchRouteToVendors(
          routeId,
          vehicleId,
          shipment.origin_lat!,
          shipment.origin_lng!,
          shipment.delivery_point!.latitude,
          shipment.delivery_point!.longitude
        ).catch(console.error);
      });
    }

    await this.recordShipmentLog(shipmentId, 'assigned', shipment.origin_lat, shipment.origin_lng, { vehicle_id: vehicleId });
    await this.recalculateVehicleCapacity(vehicleId);

    return this.getShipment(shipmentId);
  }

  /**
   * Get a single shipment with relations.
   */
  static async getShipment(shipmentId: string): Promise<Shipment | null> {
    const { data, error } = await supabase
      .from('shipments')
      .select('*, parcels(*), delivery_points!delivery_points_shipment_id_fkey(*), shipment_logs(*), capacity_bids(bid_amount, eway_bill_ref, load_configuration, vendor_profiles(company_name, city), capacity_windows!capacity_bids_window_id_fkey(trigger_type))')
      .eq('id', shipmentId)
      .maybeSingle();

    if (error || !data) {
      // Fallback 1: Check if it's a vendor shipment request
      const { data: vendorData, error: vendorError } = await supabase
        .from('vendor_shipment_requests')
        .select('*')
        .eq('id', shipmentId)
        .maybeSingle();
        
      if (!vendorError && vendorData) {
        let vMeta: any = vendorData.metadata || {};
        if (Object.keys(vMeta).length === 0) {
          vMeta = {
            consigneeName: "Vendor Demo User",
            consigneeContact: "+91 99999 88888",
            consigneeEmail: "demo@vendor.com",
            productCategory: "FMCG",
            productName: "Packaged Foods",
            brand: "AgroFresh",
            packagingType: "Cartons",
            noOfPackages: "50",
            grossWeight: "1200 KG",
            declaredValue: "₹ 5,00,000",
            dispatch_date: new Date(vendorData.created_at).toISOString().split('T')[0],
            is_long_haul: true,
            remarks: "Generated mock vendor data."
          };
        } else if (vMeta.consignee || vMeta.cargo) {
          vMeta = {
            consigneeName: vMeta.consignee?.name || "",
            consigneeContact: vMeta.consignee?.contact || "",
            consigneeEmail: vMeta.consignee?.email || "",
            productCategory: vMeta.cargo?.category || "",
            productName: vMeta.cargo?.name || "",
            brand: vMeta.cargo?.brand || "",
            modelVariant: vMeta.cargo?.modelVariant || "",
            packagingType: vMeta.cargo?.packagingType || "",
            noOfPackages: vMeta.cargo?.noOfPackages || "",
            quantity: vMeta.cargo?.quantity || "",
            unit: vMeta.cargo?.unit || "",
            grossWeight: vMeta.cargo?.grossWeightKg ? `${vMeta.cargo.grossWeightKg} KG` : "",
            declaredValue: vMeta.cargo?.declaredValue || "",
            specialHandling: vMeta.cargo?.specialHandling || {},
            remarks: vMeta.cargo?.remarks || "",
            dispatch_date: new Date(vendorData.created_at).toISOString().split('T')[0],
            reporting_date: new Date(new Date(vendorData.created_at).getTime() + 86400000).toISOString().split('T')[0],
            eta_details: { eta_text: "Pending Routing...", distance_km: getDist(vendorData.pickup_lat, vendorData.pickup_lng, vendorData.drop_lat, vendorData.drop_lng) },
            is_long_haul: false
          };
        }

        return {
          id: vendorData.id,
          tracking_id: 'VR-' + vendorData.id.substring(0, 8).toUpperCase(),
          status: vendorData.status,
          metadata: vMeta,
          pickup_location: { address: vendorData.pickup_location, lat: vendorData.pickup_lat, lng: vendorData.pickup_lng },
          drop_location: { address: vendorData.drop_location, lat: vendorData.drop_lat, lng: vendorData.drop_lng },
          created_at: vendorData.created_at,
        } as any;
      }

      // Fallback 2: Check if it's a cargo manifest
      const { data: manifestData, error: manifestError } = await supabase
        .from('cargo_manifest')
        .select('*')
        .eq('id', shipmentId)
        .maybeSingle();

      if (manifestError || !manifestData) return null;

      // If it's a cargo manifest, fetch its parent vendor request for metadata if it exists
      let metadata: any = {};
      if (manifestData.vendor_request_id) {
        const { data: parentReq } = await supabase
          .from('vendor_shipment_requests')
          .select('metadata')
          .eq('id', manifestData.vendor_request_id)
          .maybeSingle();
        if (parentReq?.metadata) metadata = parentReq.metadata;
      }

      if (!metadata || Object.keys(metadata || {}).length === 0) {
        metadata = {
          consigneeName: "Rajesh Kumar (Mock Data)",
          consigneeContact: "+91 98765 43210",
          consigneeEmail: "rajesh@example.com",
          productCategory: "Electronics / Industrial",
          productName: "Industrial Inverters",
          brand: "PowerGen",
          modelVariant: "PRO-5000X",
          packagingType: "Pallets / Corrugated Box",
          noOfPackages: "8",
          quantity: "32",
          unit: "Pieces",
          grossWeight: manifestData.capacity_kg ? `${manifestData.capacity_kg} KG` : "500 KG",
          declaredValue: "₹ 2,45,000",
          dispatch_date: new Date(manifestData.created_at).toISOString().split('T')[0],
          reporting_date: new Date(new Date(manifestData.created_at).getTime() + 86400000).toISOString().split('T')[0],
          eta_details: {
            eta_text: "Tomorrow, 12:30 PM",
            distance_km: "350"
          },
          is_long_haul: false,
          specialHandling: {
            fragile: true,
            highValue: true
          },
          remarks: "Standard mock data generated because original metadata was empty."
        };
      } else if (metadata.consignee || metadata.cargo) {
        metadata = {
          consigneeName: metadata.consignee?.name || "",
          consigneeContact: metadata.consignee?.contact || "",
          consigneeEmail: metadata.consignee?.email || "",
          productCategory: metadata.cargo?.category || "",
          productName: metadata.cargo?.name || "",
          brand: metadata.cargo?.brand || "",
          modelVariant: metadata.cargo?.modelVariant || "",
          packagingType: metadata.cargo?.packagingType || "",
          noOfPackages: metadata.cargo?.noOfPackages || "",
          quantity: metadata.cargo?.quantity || "",
          unit: metadata.cargo?.unit || "",
          grossWeight: metadata.cargo?.grossWeightKg ? `${metadata.cargo.grossWeightKg} KG` : "",
          declaredValue: metadata.cargo?.declaredValue || "",
          specialHandling: metadata.cargo?.specialHandling || {},
          remarks: metadata.cargo?.remarks || "",
          dispatch_date: new Date(manifestData.created_at).toISOString().split('T')[0],
          reporting_date: new Date(new Date(manifestData.created_at).getTime() + 86400000).toISOString().split('T')[0],
          eta_details: { eta_text: "Tomorrow, 14:00 PM", distance_km: getDist(manifestData.pickup_lat, manifestData.pickup_lng, manifestData.drop_lat, manifestData.drop_lng) },
          is_long_haul: false
        };
      }

      return {
        id: manifestData.id,
        tracking_id: 'CM-' + manifestData.id.substring(0, 8).toUpperCase(),
        status: manifestData.status,
        metadata: metadata,
        pickup_location: { address: manifestData.pickup_location, lat: manifestData.pickup_lat, lng: manifestData.pickup_lng },
        drop_location: { address: manifestData.drop_location, lat: manifestData.drop_lat, lng: manifestData.drop_lng },
        created_at: manifestData.created_at,
      } as any;
    }

    // Map to our interface shape
    const shipment: Shipment = {
      ...data,
      delivery_point: data.delivery_points?.[0] || null,
      parcels: data.parcels || [],
      logs: data.shipment_logs || [],
      is_verified: SecurityService.verifyChain(data.shipment_logs || []),
      capacity_bids: data.capacity_bids || null,
    };
    return shipment;
  }

  /**
   * List shipments with relations.
   */
  static async listShipments(skip: number = 0, limit: number = 100): Promise<Shipment[]> {
    const { data, error } = await supabase
      .from('shipments')
      .select('*, parcels(*), delivery_points!delivery_points_shipment_id_fkey(*, route_stops(routes(vehicle_id, vehicles(plate_number, users(full_name))))), shipment_logs(*), capacity_bids(bid_amount, eway_bill_ref, load_configuration, vendor_profiles(company_name, city), capacity_windows!capacity_bids_window_id_fkey(trigger_type))')
      .order('created_at', { ascending: false })
      .range(skip, skip + limit - 1);

    if (error || !data) return [];

    const mappedShipments = data.map((d: any) => {
      const deliveryPoint = d.delivery_points?.[0];
      const routeStops = deliveryPoint?.route_stops || [];
      const activeRouteStop = routeStops.find((rs: any) => rs.routes);
      const vehicle = activeRouteStop?.routes?.vehicles;
      
      let vehicleId = activeRouteStop?.routes?.vehicle_id || null;
      let driverName = vehicle?.users?.full_name || null;
      
      // Fallback to logs if route is missing (e.g. legacy data)
      if (!vehicleId && d.shipment_logs) {
        const assignedLog = d.shipment_logs.find((l: any) => l.status === 'assigned' && l.metadata_json?.vehicle_id);
        if (assignedLog) {
          vehicleId = assignedLog.metadata_json.vehicle_id;
        }
      }

      return {
        ...d,
        delivery_point: deliveryPoint || null,
        parcels: d.parcels || [],
        logs: d.shipment_logs || [],
        is_verified: SecurityService.verifyChain(d.shipment_logs || []),
        capacity_bids: d.capacity_bids || null,
        vehicle_id: vehicleId,
        driver_name: driverName,
      };
    });

    // Fetch Cargo Manifests to show them in the unified list
    const { data: manifests } = await supabase
      .from('cargo_manifest')
      .select('*, vehicles(plate_number, users(full_name))')
      .order('created_at', { ascending: false })
      .limit(limit);

    const mappedManifests = (manifests || []).map((m: any) => ({
      id: m.id,
      tracking_id: 'CM-' + m.id.substring(0, 8).toUpperCase(),
      status: m.status === 'scheduled' ? 'created' : m.status, // maps scheduled to created
      priority: 'high',
      origin_lat: m.pickup_lat,
      origin_lng: m.pickup_lng,
      total_weight_kg: m.capacity_kg,
      delivery_point: {
        id: m.id + '_dp',
        name: 'Drop: ' + (m.drop_location || '').substring(0, 20),
        address: m.drop_location,
        latitude: m.drop_lat,
        longitude: m.drop_lng,
        demand_kg: m.capacity_kg
      },
      parcels: [],
      logs: [],
      is_verified: true,
      vehicle_id: m.vehicle_id,
      driver_name: m.vehicles?.users?.full_name || 'Driver Assigned',
      created_at: m.created_at,
      updated_at: m.created_at,
    }));

    // Combine and re-sort by created_at descending
    const combined = [...mappedShipments, ...mappedManifests].sort((a, b) => 
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    return combined;
  }

  /**
   * Update shipment metadata (dates, consignee, cargo details).
   */
  static async updateShipmentMetadata(
    shipmentId: string,
    metadata: any
  ): Promise<Shipment | null> {
    const { error } = await supabase
      .from('shipments')
      .update({ metadata })
      .eq('id', shipmentId);

    if (error) {
      // Try vendor_shipment_requests
      const { error: vendorError } = await supabase
        .from('vendor_shipment_requests')
        .update({ metadata })
        .eq('id', shipmentId);
        
      if (vendorError) {
        // Try cargo_manifest parent request
        const { data: manifest } = await supabase
          .from('cargo_manifest')
          .select('vendor_request_id')
          .eq('id', shipmentId)
          .maybeSingle();

        if (manifest?.vendor_request_id) {
          await supabase
            .from('vendor_shipment_requests')
            .update({ metadata })
            .eq('id', manifest.vendor_request_id);
        } else {
          return null;
        }
      }
    }
    return await this.getShipment(shipmentId);
  }

  /**
   * Update shipment status with optional POD data.
   */
  static async updateShipmentStatus(
    shipmentId: string,
    status: string,
    lat?: number | null,
    lng?: number | null,
    receivedBy?: string | null,
    signatureData?: string | null
  ): Promise<Shipment | null> {
    const updateData: Record<string, any> = { status };
    if (receivedBy) updateData.received_by = receivedBy;
    if (signatureData) updateData.signature_data = signatureData;

    const { error } = await supabase
      .from('shipments')
      .update(updateData)
      .eq('id', shipmentId);

    if (error) return null;

    // Record tamper-evident log
    const metadata: Record<string, any> = {};
    if (status === 'delivered') {
      metadata.received_by = receivedBy;
      metadata.signature_captured = !!signatureData;
    }
    await ShipmentService.recordShipmentLog(shipmentId, status, lat, lng, metadata);

    // Find vehicle to recalculate capacity
    const { data: dp } = await supabase
      .from('delivery_points')
      .select('id')
      .eq('shipment_id', shipmentId)
      .single();

    if (dp) {
      const { data: stop } = await supabase
        .from('route_stops')
        .select('route_id')
        .eq('delivery_point_id', dp.id)
        .limit(1)
        .single();

      if (stop) {
        const { data: route } = await supabase
          .from('routes')
          .select('vehicle_id')
          .eq('id', stop.route_id)
          .single();

        if (route && route.vehicle_id) {
          await ShipmentService.recalculateVehicleCapacity(route.vehicle_id);
          
          // Note: Automatic backhaul bidding was disabled in favor of Driver-triggered bidding.
          // The driver will now trigger `openBackhaulWindow` from the driver app.
        }
      }
    }

    return ShipmentService.getShipment(shipmentId);
  }

  /**
   * Update specific shipment fields.
   */
  static async updateShipment(shipmentId: string, updateData: Record<string, any>): Promise<Shipment | null> {
    // Filter out null/undefined values
    const filtered: Record<string, any> = {};
    for (const [key, value] of Object.entries(updateData)) {
      if (value !== null && value !== undefined) {
        filtered[key] = value;
      }
    }

    if (Object.keys(filtered).length === 0) {
      return ShipmentService.getShipment(shipmentId);
    }

    const { error } = await supabase
      .from('shipments')
      .update(filtered)
      .eq('id', shipmentId);

    if (error) return null;
    return ShipmentService.getShipment(shipmentId);
  }

  /**
   * Delete a shipment and all related data.
   */
  static async deleteShipment(shipmentId: string): Promise<boolean> {
    // Check existence
    const { data: existing } = await supabase
      .from('shipments')
      .select('id')
      .eq('id', shipmentId)
      .single();

    if (!existing) return false;

    // 1. Get delivery point
    const { data: dps } = await supabase
      .from('delivery_points')
      .select('id')
      .eq('shipment_id', shipmentId);

    const vehiclesToRecalculate = new Set<string>();

    // 2. Delete route stops linked to delivery points
    if (dps && dps.length > 0) {
      const dpIds = dps.map((dp: any) => dp.id);
      
      // Get vehicles to recalculate capacity later
      const { data: stops } = await supabase.from('route_stops').select('route_id').in('delivery_point_id', dpIds);
      if (stops && stops.length > 0) {
        const routeIds = stops.map((s: any) => s.route_id);
        const { data: routes } = await supabase.from('routes').select('vehicle_id').in('id', routeIds);
        routes?.forEach((r: any) => {
          if (r.vehicle_id) vehiclesToRecalculate.add(r.vehicle_id);
        });
      }

      await supabase.from('route_stops').delete().in('delivery_point_id', dpIds);
    }

    // 3. Delete invoices/payments
    const { data: invoices } = await supabase
      .from('invoices')
      .select('id')
      .eq('shipment_id', shipmentId);

    if (invoices && invoices.length > 0) {
      const invoiceIds = invoices.map((inv: any) => inv.id);
      await supabase.from('payments').delete().in('invoice_id', invoiceIds);
      await supabase.from('invoices').delete().eq('shipment_id', shipmentId);
    }

    // 4. Delete parcels and logs
    await supabase.from('parcels').delete().eq('shipment_id', shipmentId);
    await supabase.from('shipment_logs').delete().eq('shipment_id', shipmentId);

    // 5. Unlink delivery points to prevent FK constraint violation from capacity_bids
    if (dps && dps.length > 0) {
      await supabase.from('delivery_points').update({ shipment_id: null }).eq('shipment_id', shipmentId);
    }

    // 5.5 Remove from capacity windows to avoid FK constraint violation
    await supabase.from('capacity_windows').update({ fallback_shipment_id: null }).eq('fallback_shipment_id', shipmentId);

    // 6. Delete shipment
    await supabase.from('shipments').delete().eq('id', shipmentId);

    // 7. Recalculate vehicle capacity
    for (const vid of vehiclesToRecalculate) {
      await ShipmentService.recalculateVehicleCapacity(vid);
    }

    return true;
  }

  /**
   * Public tracking — no auth required.
   */
  static async getPublicTracking(trackingId: string): Promise<Record<string, any> | null> {
    if (trackingId.startsWith('CM-')) {
      const manifestId = trackingId.substring(3).toLowerCase();
      // Need to find the manifest that starts with this ID
      const { data: manifests } = await supabase
        .from('cargo_manifest')
        .select('*, vehicles(*)')
        .textSearch('id', manifestId, { type: 'plain' }); // Wait, textSearch on uuid might not work. Better to just fetch all and filter or use like if it's string.
        // Actually, we map the first 8 characters to CM-XXXXXXXX in listShipments.
        // It's safer to just fetch the one matching the id. But we only have 8 chars.
      
      // Let's just fetch all active manifests and find the match
      const { data: allManifests } = await supabase
        .from('cargo_manifest')
        .select('*, vehicles(*), vendor_shipment_requests(vendor_id)');
      
      const manifest = allManifests?.find((m: any) => m.id.toUpperCase().startsWith(manifestId.toUpperCase()));
      if (!manifest) return null;

      const trackingInfo: Record<string, any> = {
        id: manifest.id,
        tracking_id: trackingId,
        vendor_id: manifest.vendor_shipment_requests?.vendor_id || null,
        status: manifest.status === 'scheduled' ? 'created' : manifest.status,
        priority: 'high',
        total_items: 1,
        total_weight_kg: manifest.capacity_kg,
        origin_name: 'Pickup Point',
        origin_address: manifest.pickup_location,
        origin_lat: manifest.pickup_lat,
        origin_lng: manifest.pickup_lng,
        destination: (manifest.status === 'in_transit' || manifest.status === 'delivered') ? {
          name: 'Drop Point',
          address: manifest.drop_location,
          lat: manifest.drop_lat,
          lng: manifest.drop_lng
        } : {
          name: 'Pickup Point',
          address: manifest.pickup_location,
          lat: manifest.pickup_lat,
          lng: manifest.pickup_lng
        },
        vehicle: null,
        eta_minutes: null,
      };

      if (manifest.vehicles) {
        const v = manifest.vehicles;
        trackingInfo.vehicle = {
          id: v.id,
          plate_number: v.plate_number,
          type: v.vehicle_type,
          status: v.status,
          lat: v.latitude,
          lng: v.longitude,
        };

        // Rough ETA calculation based on distance from vehicle to pickup or drop
        const targetLat = manifest.status === 'in_transit' ? manifest.drop_lat : manifest.pickup_lat;
        const targetLng = manifest.status === 'in_transit' ? manifest.drop_lng : manifest.pickup_lng;
        
        if (v.latitude && v.longitude && targetLat && targetLng) {
          const R = 6371; // km
          const dLat = (targetLat - v.latitude) * Math.PI / 180;
          const dLon = (targetLng - v.longitude) * Math.PI / 180;
          const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(v.latitude * Math.PI / 180) * Math.cos(targetLat * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
          const distanceKm = R * c;
          
          // Assume 40km/h average speed
          trackingInfo.eta_minutes = Math.max(5.0, Math.round((distanceKm / 40) * 60));
        }
      }

      return trackingInfo;
    }

    const { data: shipment } = await supabase
      .from('shipments')
      .select('*, delivery_points!delivery_points_shipment_id_fkey(*)')
      .eq('tracking_id', trackingId)
      .single();

    if (!shipment) return null;

    const dp = shipment.delivery_points?.[0];

    const trackingInfo: Record<string, any> = {
      id: shipment.id,
      tracking_id: shipment.tracking_id,
      status: shipment.status,
      priority: shipment.priority,
      total_items: shipment.total_items,
      total_weight_kg: shipment.total_weight_kg,
      origin_name: shipment.origin_name,
      origin_address: shipment.origin_address,
      origin_lat: shipment.origin_lat,
      origin_lng: shipment.origin_lng,
      destination: dp
        ? { name: dp.name, address: dp.address, lat: dp.latitude, lng: dp.longitude }
        : null,
      vehicle: null,
      eta_minutes: null,
    };

    // Find vehicle via route stops
    if (dp) {
      const { data: routeStops } = await supabase
        .from('route_stops')
        .select('*, routes(*, vehicles(*))')
        .eq('delivery_point_id', dp.id)
        .limit(1);

      const stop = routeStops?.[0];
      if (stop?.routes) {
        const route = stop.routes;
        const vehicle = route.vehicles;
        if (vehicle) {
          trackingInfo.vehicle = {
            id: vehicle.id,
            plate_number: vehicle.plate_number,
            type: vehicle.vehicle_type,
            status: vehicle.status,
            lat: vehicle.latitude,
            lng: vehicle.longitude,
          };
        }
        if (route.status === 'active') {
          trackingInfo.eta_minutes = Math.max(5.0, route.total_duration_minutes);
        }
      }
    }

    return trackingInfo;
  }
}
