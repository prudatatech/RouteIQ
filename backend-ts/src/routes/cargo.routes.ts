/**
 * margixindia — Cargo Collaboration Routes
 * Ports: backend/app/api/v1/endpoints/cargo.py
 * Includes: Scenarios, Security Alerts, Backhaul, Pooling, POD, Dynamic Pricing
 */
import { Router, Request, Response } from 'express';
import { supabase } from '../core/supabase';
import { requireAuth, requireRole } from '../core/auth';
import { STAFF_ROLES } from '../core/ownership';
import { sendError, HttpError } from '../core/errors';
import { ShipmentService } from '../services/shipment.service';
import { v4 as uuidv4 } from 'uuid';
import { settings } from '../core/config';
import { MapplsService } from '../services/mappls.service';

const router = Router();

/**
 * Fetch a real depot to use as the reference point for pooling/backhaul
 * distance math. Returns null when no depot is configured — callers must
 * treat that as "cannot compute" rather than falling back to a guessed
 * location.
 */
async function getReferenceDepot(): Promise<{ id: string; name: string; latitude: number; longitude: number } | null> {
  const { data } = await supabase
    .from('depots')
    .select('id, name, latitude, longitude')
    .not('latitude', 'is', null)
    .not('longitude', 'is', null)
    .limit(1)
    .maybeSingle();
  return data || null;
}

// ── GET /shipments ─────────────────────────────────────────
router.get('/shipments', requireAuth, requireRole(...STAFF_ROLES), async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabase.from('shipments').select('*');
    if (error) throw error;
    res.json(data || []);
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── GET /scenarios ─────────────────────────────────────────
router.get('/scenarios', requireAuth, requireRole(...STAFF_ROLES), async (req: Request, res: Response) => {
  try {
    const { data: shipments, error } = await supabase
      .from('shipments')
      .select('*')
      .in('status', ['created', 'pending'])
      .order('created_at', { ascending: false })
      .limit(10);
      
    if (error) { throw error; }

    const { data: vehicles } = await supabase
      .from('vehicles')
      .select('*')
      .in('status', ['on_route', 'available'])
      .limit(1);

    const activeShipments = shipments || [];
    
    // Split into pooling (first half) and backhaul (second half)
    const poolData = activeShipments.slice(0, Math.ceil(activeShipments.length / 2));
    const backhaulData = activeShipments.slice(Math.ceil(activeShipments.length / 2));

    const poolingDemands = poolData.map((s: any) => ({
      id: s.id,
      company: s.origin_name || 'Unknown Shipper',
      origin: s.origin_address?.split(',')[0] || 'Unknown',
      destination: s.dest_address?.split(',')[0] || 'Unknown',
      weight_tons: parseFloat(((s.total_weight_kg || 1000) / 1000).toFixed(2)),
      volume_cbm: parseFloat((((s.total_weight_kg || 1000) / 1000) * 2.5).toFixed(1)),
      value_inr: (s.total_weight_kg || 1000) * 150,
      urgency: s.priority || 'medium',
      origin_lat: s.origin_lat,
      origin_lng: s.origin_lng,
      dest_lat: s.dest_lat,
      dest_lng: s.dest_lng
    }));

    const backhaulOpportunities = backhaulData.map((s: any) => ({
      id: s.id,
      shipper: s.origin_name || 'Unknown',
      origin: s.origin_address?.split(',')[0] || 'Unknown',
      destination: s.dest_address?.split(',')[0] || 'Unknown',
      weight_kg: s.total_weight_kg || 3000,
      cargo_type: s.load_type === 'full' ? 'heavy_machinery' : 'dry_bulk',
      revenue: (s.total_weight_kg || 3000) * 15,
      origin_lat: s.origin_lat,
      origin_lng: s.origin_lng,
      dest_lat: s.dest_lat,
      dest_lng: s.dest_lng
    }));

    const v = vehicles && vehicles.length > 0 ? vehicles[0] : null;
    const truck = v ? {
      plate_number: v.plate_number,
      capacity_kg: v.capacity_kg,
      used_capacity_kg: Math.max(0, v.capacity_kg - (v.available_capacity_kg ?? v.capacity_kg)),
      available_capacity_kg: v.available_capacity_kg ?? v.capacity_kg,
      route: 'Active Route',
      cargo_type: 'general',
    } : null;

    res.json({
      backhaul: {
        title: 'Dynamic Backhaul Matching',
        description: 'Live matching based on active vehicles and pending orders.',
        truck,
        opportunities: backhaulOpportunities
      },
      pooling: {
        title: 'Dynamic Freight Pooling',
        description: 'Consolidate multiple active LTL orders into a single multi-stop run.',
        demands: poolingDemands
      }
    });
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── GET /security-alerts ───────────────────────────────────
router.get('/security-alerts', requireAuth, requireRole(...STAFF_ROLES), async (req: Request, res: Response) => {
  try {
    const { data: alerts, error } = await supabase
      .from('maintenance_alerts')
      .select('*, vehicles(plate_number)')
      .eq('is_resolved', false);

    if (error) throw error;

    res.json(
      (alerts || []).map((a: any) => ({
        id: a.id,
        timestamp: a.created_at,
        vehicle_id: a.vehicle_id,
        plate_number: a.vehicles?.plate_number || null,
        type: a.alert_type,
        severity: a.severity,
        message: a.description,
        status: 'active',
      }))
    );
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── POST /trigger-alert ────────────────────────────────────
router.post('/trigger-alert', requireAuth, requireRole('admin', 'superadmin', 'manager'), async (req: Request, res: Response) => {
  try {
    const vehicleId = req.body.vehicle_id;
    if (!vehicleId) {
      throw new HttpError(400, 'vehicle_id is required');
    }

    const { data: vehicle, error: vehicleErr } = await supabase
      .from('vehicles')
      .select('id, plate_number')
      .eq('id', vehicleId)
      .maybeSingle();
    if (vehicleErr) throw vehicleErr;
    if (!vehicle) {
      throw new HttpError(400, `Vehicle ${vehicleId} not found`);
    }

    const alertType = req.body.type || 'tamper_detected';
    const message = req.body.message || 'Manual security alert triggered by operator.';
    const severity = alertType === 'tamper_detected' ? 'critical' : 'high';

    const { data: inserted, error } = await supabase
      .from('maintenance_alerts')
      .insert({
        vehicle_id: vehicle.id,
        alert_type: alertType,
        severity,
        description: message,
        is_resolved: false,
      })
      .select()
      .single();

    if (error) throw error;

    res.json({
      status: 'success',
      alert: {
        id: inserted?.id || '',
        timestamp: inserted?.created_at,
        plate_number: vehicle.plate_number,
        type: alertType,
        severity,
        message,
        status: 'active',
      },
    });
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── POST /resolve-alert/:alert_id ──────────────────────────
router.post('/resolve-alert/:alert_id', requireAuth, requireRole('admin', 'superadmin', 'manager'), async (req: Request, res: Response) => {
  try {
    const { data: existing } = await supabase
      .from('maintenance_alerts')
      .select('id')
      .eq('id', req.params.alert_id)
      .single();

    if (!existing) {
      res.status(404).json({ detail: 'Alert not found' });
      return;
    }

    const resolvedAt = new Date().toISOString();
    await supabase
      .from('maintenance_alerts')
      .update({ is_resolved: true, resolved_at: resolvedAt })
      .eq('id', req.params.alert_id);

    res.json({
      status: 'success',
      alert: { id: req.params.alert_id, status: 'resolved', resolved_at: resolvedAt },
    });
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── POST /optimize-pooling ─────────────────────────────────
router.post('/optimize-pooling', requireAuth, requireRole(...STAFF_ROLES), async (req: Request, res: Response) => {
  try {
    const demands = req.body;
    if (!demands || !Array.isArray(demands) || demands.length === 0) {
      res.status(400).json({ detail: 'No pooling demands provided' });
      return;
    }

    const missingCoords = demands.filter((d: any) => d.dest_lat == null || d.dest_lng == null);
    if (missingCoords.length > 0) {
      res.status(422).json({
        detail: `Cannot compute a pooling route: missing destination coordinates for ${missingCoords.map((d: any) => d.company || d.id).join(', ')}`,
      });
      return;
    }

    const depot = await getReferenceDepot();
    if (!depot) {
      res.status(422).json({ detail: 'No depot is configured; cannot compute a pooling route.' });
      return;
    }

    const totalWeight = demands.reduce((s: number, d: any) => s + (d.weight_tons || 0), 0);
    const totalVolume = demands.reduce((s: number, d: any) => s + (d.volume_cbm || 0), 0);

    const mlPayload = {
      locations: [
        { id: 'depot', lat: depot.latitude, lng: depot.longitude, demand_kg: 0 },
        ...demands.map((d: any) => ({
          id: d.id,
          lat: d.dest_lat,
          lng: d.dest_lng,
          demand_kg: (d.weight_tons || 1) * 1000
        }))
      ],
      vehicles: [{
        id: 'pool-truck',
        capacity_kg: 20000,
        start_lat: depot.latitude,
        start_lng: depot.longitude
      }],
      algorithm: "ortools"
    };

    let mlData: any = null;
    try {
      const resp = await fetch(`${settings.ML_SERVICE_URL}/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mlPayload),
        signal: AbortSignal.timeout(10_000),
      });
      if (resp.ok) mlData = await resp.json();
    } catch (e) {
      console.warn('ML Service unreachable for pooling optimization');
    }

    // Calculate real distances using Mappls
    let separateTripsDistance: number | null = null;
    let consolidatedDistance: number | null = mlData?.total_distance_km ?? null;
    const depotCoord = `${depot.longitude},${depot.latitude}`;

    try {
      const coords = [depotCoord, ...demands.map((d: any) => `${d.dest_lng},${d.dest_lat}`)];

      // 1. Separate trips: sum of distances from depot to each destination
      const sepMatrix = await MapplsService.getDistanceMatrix(coords, [0], demands.map((_: any, i: number) => i + 1));
      if (sepMatrix?.distances?.[0]) {
        const oneWay = sepMatrix.distances[0].reduce((sum: number, dist: number) => sum + (dist / 1000), 0);
        // Multiply by 2 for round trips if each truck must return to depot
        separateTripsDistance = oneWay * 2;
      }

      // 2. Consolidated route distance
      if (mlData?.routes?.[0]?.stop_ids) {
        const stopIds = mlData.routes[0].stop_ids;
        const routeCoords = stopIds.map((id: string) => {
          if (id === 'depot') return depotCoord;
          const d = demands.find((x: any) => x.id === id);
          return `${d?.dest_lng},${d?.dest_lat}`;
        });

        const sources = Array.from({length: routeCoords.length - 1}, (_, i) => i);
        const destinations = Array.from({length: routeCoords.length - 1}, (_, i) => i + 1);

        const poolMatrix = await MapplsService.getDistanceMatrix(routeCoords, sources, destinations);
        if (poolMatrix?.distances) {
          let totalDist = 0;
          for (let i = 0; i < routeCoords.length - 1; i++) {
             totalDist += (poolMatrix.distances[i][0] / 1000) || 0; // The destination is always index 0 in the returned sub-array because we ask for 1 dest per source
          }
          consolidatedDistance = totalDist;
        }
      }
    } catch (e: any) {
      console.warn('Mappls Distance Matrix error:', e.message);
    }

    if (separateTripsDistance == null || consolidatedDistance == null) {
      res.status(502).json({ detail: 'Distance calculation is unavailable right now (ML/Mappls services unreachable). Try again shortly.' });
      return;
    }
    const finalSeparateTripsDistance: number = separateTripsDistance;
    const finalConsolidatedDistance: number = consolidatedDistance;

    const separateTripsCost = finalSeparateTripsDistance * 42.0;
    const consolidatedCost = finalConsolidatedDistance * 52.0;
    const distanceSaved = finalSeparateTripsDistance - finalConsolidatedDistance;
    const costSaved = separateTripsCost - consolidatedCost;
    const savingsPct = costSaved > 0 ? ((costSaved / separateTripsCost) * 100.0) : 0;
    const co2SavedKg = distanceSaved * 0.85;

    const stopsSequence = mlData?.routes?.[0]?.stop_ids
      ? mlData.routes[0].stop_ids.map((id: string) => {
          if (id === 'depot') return { name: depot.name, type: 'Origin Pickup', load_in_kg: totalWeight * 1000 };
          const d = demands.find((x: any) => x.id === id);
          return {
            name: d ? (d.destination || d.company) : id,
            type: 'Unload',
            unload_in_kg: d ? (d.weight_tons || 0) * 1000 : 0
          };
        })
      : [
          { name: depot.name, type: 'Origin Pickup', load_in_kg: totalWeight * 1000 },
          ...demands.map((d: any) => ({
            name: d.destination || d.company,
            type: 'Unload',
            unload_in_kg: (d.weight_tons || 0) * 1000
          })),
        ];

    const sharedDiscounts = demands.map((d: any) => {
      const origPrice = (d.weight_tons || 1) * 8000;
      const discountedPrice = Math.floor(origPrice * 0.72);
      return {
        company: d.company || 'Generic Corp',
        original_price: origPrice,
        pooling_price: discountedPrice,
        savings: origPrice - discountedPrice,
        savings_pct: 28,
      };
    });

    res.json({
      total_weight_tons: totalWeight,
      total_volume_cbm: totalVolume,
      separate_trips_distance_km: parseFloat(finalSeparateTripsDistance.toFixed(1)),
      consolidated_distance_km: parseFloat(finalConsolidatedDistance.toFixed(1)),
      distance_saved_km: parseFloat(distanceSaved.toFixed(1)),
      separate_trips_cost_inr: parseFloat(separateTripsCost.toFixed(2)),
      consolidated_cost_inr: parseFloat(consolidatedCost.toFixed(2)),
      cost_saved_inr: parseFloat(costSaved.toFixed(2)),
      savings_pct: parseFloat(savingsPct.toFixed(1)),
      co2_saved_kg: parseFloat(co2SavedKg.toFixed(1)),
      stops_sequence: stopsSequence,
      shared_pricing: sharedDiscounts,
    });
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── POST /backhaul-match ───────────────────────────────────
router.post('/backhaul-match', requireAuth, requireRole(...STAFF_ROLES), async (req: Request, res: Response) => {
  try {
    const opportunityId = req.body.opportunity_id;
    const availableCapacityKg = req.body.available_capacity_kg || 5000;

    const { data } = await supabase.from('shipments').select('*').eq('id', opportunityId).maybeSingle();
    if (!data) {
      res.status(404).json({ detail: 'Opportunity not found' });
      return;
    }

    const opp: any = {
      id: data.id,
      shipper: data.origin_name || 'Unknown Shipper',
      origin: data.origin_address?.split(',')[0] || 'Unknown',
      destination: data.dest_address?.split(',')[0] || 'Unknown',
      weight_kg: data.total_weight_kg || 3000,
      cargo_type: data.load_type === 'full' ? 'heavy_machinery' : 'dry_bulk',
      revenue: (data.total_weight_kg || 3000) * 15,
      origin_lat: data.origin_lat,
      origin_lng: data.origin_lng,
      dest_lat: data.dest_lat,
      dest_lng: data.dest_lng,
    };

    if (opp.weight_kg > availableCapacityKg) {
      res.json({
        status: 'rejected',
        reason: `Capacity Overload: Opportunity weight ${opp.weight_kg}kg exceeds remaining vehicle capacity of ${availableCapacityKg}kg.`,
      });
      return;
    }

    // Real added-distance: driving distance from the reference depot to the
    // opportunity's origin/destination via Mappls. No route data + no
    // coordinates means we cannot honestly report a deviation.
    if (opp.origin_lat == null || opp.origin_lng == null || opp.dest_lat == null || opp.dest_lng == null) {
      res.status(422).json({ detail: 'Cannot compute backhaul match: opportunity is missing origin/destination coordinates.' });
      return;
    }

    const depot = await getReferenceDepot();
    if (!depot) {
      res.status(422).json({ detail: 'No depot is configured; cannot compute a backhaul match.' });
      return;
    }

    let deviationKm: number | null = null;
    try {
      const coords = [
        `${depot.longitude},${depot.latitude}`,
        `${opp.origin_lng},${opp.origin_lat}`,
        `${opp.dest_lng},${opp.dest_lat}`,
      ];
      const matrix = await MapplsService.getDistanceMatrix(coords, [0, 1], [1, 2]);
      const depotToOrigin = matrix?.distances?.[0]?.[0];
      const originToDest = matrix?.distances?.[1]?.[0];
      if (typeof depotToOrigin === 'number' && typeof originToDest === 'number') {
        deviationKm = (depotToOrigin + originToDest) / 1000;
      }
    } catch (e: any) {
      console.warn('Mappls Distance Matrix error (backhaul-match):', e.message);
    }

    if (deviationKm == null) {
      res.status(502).json({ detail: 'Route distance calculation is unavailable right now (Mappls unreachable). Try again shortly.' });
      return;
    }

    const additionalFuelLiters = deviationKm / 4.0;
    const fuelCost = additionalFuelLiters * 90;
    const netProfit = opp.revenue - fuelCost;

    res.json({
      status: 'accepted',
      opportunity_id: opp.id,
      shipper: opp.shipper,
      cargo_type: opp.cargo_type,
      weight_kg: opp.weight_kg,
      revenue_gained_inr: opp.revenue,
      added_distance_km: parseFloat(deviationKm.toFixed(1)),
      added_fuel_liters: parseFloat(additionalFuelLiters.toFixed(1)),
      fuel_cost_inr: parseFloat(fuelCost.toFixed(1)),
      net_profit_inr: parseFloat(netProfit.toFixed(1)),
      new_route_waypoints: [
        `${depot.name} (Return Route Start)`,
        `${opp.origin} (Pickup shared-load from ${opp.shipper})`,
        `${opp.destination} (Deliver shared-load)`,
      ],
    });
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── POST /verify-pod — staff confirms a delivery ────────────
router.post('/verify-pod', requireAuth, requireRole(...STAFF_ROLES), async (req: Request, res: Response) => {
  try {
    const trackingId = typeof req.body.tracking_id === 'string' ? req.body.tracking_id.trim() : '';
    const recipientName = typeof req.body.recipient_name === 'string' ? req.body.recipient_name.trim() : '';
    if (!trackingId || !recipientName) {
      res.status(400).json({ detail: 'Tracking ID and recipient name are required' });
      return;
    }

    const { data: shipment, error } = await supabase
      .from('shipments')
      .select('id, status')
      .eq('tracking_id', trackingId)
      .maybeSingle();
    if (error) throw error;
    if (!shipment) {
      res.status(404).json({ detail: 'Shipment not found' });
      return;
    }
    if (shipment.status === 'delivered' || shipment.status === 'cancelled') {
      res.status(409).json({ detail: `Shipment is already ${shipment.status}` });
      return;
    }

    const updated = await ShipmentService.updateShipmentStatus(shipment.id, 'delivered', null, null, recipientName);
    if (!updated) throw new Error(`Failed to mark shipment ${shipment.id} delivered`);

    res.json({
      status: 'delivered',
      tracking_id: trackingId,
      recipient_name: recipientName,
      delivered_at: new Date().toISOString(),
      confirmed_by: req.user!.user_id,
    });
  } catch (e) {
    sendError(req, res, e);
  }
});

// ── GET /pricing-recommendations ───────────────────────────
router.get('/pricing-recommendations', requireAuth, async (req: Request, res: Response) => {
  try {
    const distanceKm = parseFloat(req.query.distance_km as string) || 300;
    const weightKg = parseFloat(req.query.weight_kg as string) || 5000;
    const cargoType = (req.query.cargo_type as string) || 'general';
    const congestionIndex = parseFloat(req.query.congestion_index as string) || 0.4;
    const weatherSeverity = parseFloat(req.query.weather_severity as string) || 0.1;

    const weightTons = weightKg / 1000.0;
    const baseRate = distanceKm * 15.0;
    const loadRate = distanceKm * weightTons * 2.0;

    const cargoMultipliers: Record<string, number> = {
      cold_chain: 1.35,
      hazardous: 1.50,
      dry_bulk: 1.0,
      general: 1.1,
    };
    const multiplier = cargoMultipliers[cargoType] || 1.1;
    const subtotal = (baseRate + loadRate) * multiplier;
    const congestionFee = subtotal * (congestionIndex * 0.15);
    const weatherSurcharge = subtotal * (weatherSeverity * 0.20);
    const poolingDiscount = subtotal * 0.25;
    const totalPrice = subtotal + congestionFee + weatherSurcharge;

    res.json({
      base_charge_inr: parseFloat(baseRate.toFixed(2)),
      weight_charge_inr: parseFloat(loadRate.toFixed(2)),
      cargo_type_multiplier: multiplier,
      congestion_surcharge_inr: parseFloat(congestionFee.toFixed(2)),
      weather_surcharge_inr: parseFloat(weatherSurcharge.toFixed(2)),
      recommended_freight_rate_inr: parseFloat(totalPrice.toFixed(2)),
      collaborative_sharing_rate_inr: parseFloat((totalPrice - poolingDiscount).toFixed(2)),
      estimated_savings_inr: parseFloat(poolingDiscount.toFixed(2)),
      price_valid_until: new Date().toISOString(),
    });
  } catch (e: any) {
    sendError(req, res, e);
  }
});

export default router;
