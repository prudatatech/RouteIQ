/**
 * margixindia — Cargo Collaboration Routes
 * Ports: backend/app/api/v1/endpoints/cargo.py
 * Includes: Scenarios, Security Alerts, Backhaul, Pooling, POD, Dynamic Pricing
 */
import { Router, Request, Response } from 'express';
import { supabase } from '../core/supabase';
import { requireAuth, requireRole } from '../core/auth';
import { v4 as uuidv4 } from 'uuid';
import { settings } from '../core/config';
import { MapplsService } from '../services/mappls.service';

const router = Router();

// ── Static simulation scenarios (identical to Python) ──────
const SCENARIOS = {
  backhaul: {
    title: 'Delhi-Mumbai Return Corridor Optimization',
    description: 'A 20-ton truck carrying cargo from Delhi to Mumbai delivers 15 tons, leaving 5 tons of available capacity for its return journey. The engine matches backhaul orders returning along the corridor.',
    truck: {
      plate_number: 'DL-1GC-4922',
      capacity_kg: 20000,
      used_capacity_kg: 15000,
      available_capacity_kg: 5000,
      route: 'Delhi ➔ Mumbai (Return via Surat, Vadodara, Jaipur)',
      cargo_type: 'cold_chain',
    },
    opportunities: [
      { id: 'opp-01', shipper: 'Astra Pharma', origin: 'Surat', destination: 'Jaipur', weight_kg: 3000, cargo_type: 'cold_chain', revenue: 45000, deviation_km: 18, profitability_score: 96, compatibility: 'Excellent (Cold-Chain Verified & Capacity Fits)' },
      { id: 'opp-02', shipper: 'Veda Logistics', origin: 'Vadodara', destination: 'Delhi', weight_kg: 4500, cargo_type: 'cold_chain', revenue: 68000, deviation_km: 5, profitability_score: 98, compatibility: 'Excellent (High Revenue, Almost Direct Route)' },
      { id: 'opp-03', shipper: 'Apex Heavy Machinery', origin: 'Mumbai Outskirts', destination: 'Gurgaon', weight_kg: 8000, cargo_type: 'heavy_machinery', revenue: 110000, deviation_km: 35, profitability_score: 0, compatibility: 'Incompatible (Exceeds 5-Ton Limit & Cargo Class Mismatch)' },
      { id: 'opp-04', shipper: 'Nataraj Textiles', origin: 'Ahmedabad', destination: 'Jaipur', weight_kg: 2500, cargo_type: 'dry_bulk', revenue: 22000, deviation_km: 40, profitability_score: 74, compatibility: 'Good (Requires ventilation, minor route adjustment)' },
    ],
  },
  pooling: {
    title: 'Delhi-Rajasthan Collaborative Freight Pooling',
    description: 'Consolidate three smaller shipments from different companies heading along the same corridor into a single multi-stop vehicle instead of dispatching three separate trucks.',
    demands: [
      { id: 'pool-dem-01', company: 'Company A (Aero Parts)', origin: 'Delhi', destination: 'Jaipur', weight_tons: 3.0, volume_cbm: 8.5, value_inr: 450000, urgency: 'High' },
      { id: 'pool-dem-02', company: 'Company B (Bazaar Retail)', origin: 'Delhi', destination: 'Ajmer', weight_tons: 2.0, volume_cbm: 6.0, value_inr: 180000, urgency: 'Medium' },
      { id: 'pool-dem-03', company: 'Company C (Craft Exports)', origin: 'Delhi', destination: 'Udaipur', weight_tons: 5.0, volume_cbm: 15.0, value_inr: 890000, urgency: 'Standard' },
    ],
  },
};

// ── GET /shipments ─────────────────────────────────────────
router.get('/shipments', requireAuth, async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabase.from('shipments').select('*');
    if (error) { res.status(500).json({ detail: error.message }); return; }
    res.json(data || []);
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

// ── GET /scenarios ─────────────────────────────────────────
router.get('/scenarios', requireAuth, async (_req: Request, res: Response) => {
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
      deviation_km: Math.floor(Math.random() * 50) + 5,
      profitability_score: Math.floor(Math.random() * 30) + 70,
      compatibility: 'Good',
      origin_lat: s.origin_lat,
      origin_lng: s.origin_lng,
      dest_lat: s.dest_lat,
      dest_lng: s.dest_lng
    }));

    const v = vehicles && vehicles.length > 0 ? vehicles[0] : null;
    const truck = v ? {
      plate_number: v.plate_number,
      capacity_kg: v.capacity_kg,
      used_capacity_kg: Math.floor(v.capacity_kg * 0.75),
      available_capacity_kg: Math.floor(v.capacity_kg * 0.25),
      route: 'Active Route',
      cargo_type: 'general',
    } : SCENARIOS.backhaul.truck;

    res.json({
      backhaul: {
        title: 'Dynamic Backhaul Matching',
        description: 'Live matching based on active vehicles and pending orders.',
        truck,
        opportunities: backhaulOpportunities.length > 0 ? backhaulOpportunities : SCENARIOS.backhaul.opportunities
      },
      pooling: {
        title: 'Dynamic Freight Pooling',
        description: 'Consolidate multiple active LTL orders into a single multi-stop run.',
        demands: poolingDemands.length > 0 ? poolingDemands : SCENARIOS.pooling.demands
      }
    });
  } catch (e: any) {
    // fallback
    res.json(SCENARIOS);
  }
});

// ── GET /security-alerts ───────────────────────────────────
router.get('/security-alerts', requireAuth, async (_req: Request, res: Response) => {
  try {
    const { data: alerts, error } = await supabase
      .from('maintenance_alerts')
      .select('*')
      .eq('is_resolved', false);

    if (error) { res.status(500).json({ detail: error.message }); return; }

    res.json(
      (alerts || []).map((a: any) => ({
        id: a.id,
        timestamp: a.created_at,
        vehicle_id: a.vehicle_id,
        type: a.alert_type,
        severity: a.severity,
        message: a.description,
        status: 'active',
      }))
    );
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

// ── POST /trigger-alert ────────────────────────────────────
router.post('/trigger-alert', requireAuth, requireRole('admin', 'superadmin', 'manager'), async (req: Request, res: Response) => {
  try {
    const alertType = req.body.type || 'tamper_detected';
    const plateNumber = req.body.plate_number || 'DL-1GC-4922';
    const message = req.body.message || 'Simulated security alert triggered by operator.';
    const severity = alertType === 'tamper_detected' ? 'critical' : 'high';
    const cargoId = `SH-${Math.floor(10000 + Math.random() * 90000)}`;

    const { data: inserted, error } = await supabase
      .from('maintenance_alerts')
      .insert({
        vehicle_id: uuidv4(),
        alert_type: alertType,
        severity,
        description: message,
        is_resolved: false,
      })
      .select()
      .single();

    if (error) { res.status(500).json({ detail: error.message }); return; }

    res.json({
      status: 'success',
      alert: {
        id: inserted?.id || '',
        timestamp: inserted?.created_at,
        plate_number: plateNumber,
        type: alertType,
        severity,
        message,
        cargo_id: cargoId,
        status: 'active',
      },
    });
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
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
    res.status(500).json({ detail: e.message });
  }
});

// ── POST /optimize-pooling ─────────────────────────────────
router.post('/optimize-pooling', requireAuth, async (req: Request, res: Response) => {
  try {
    const demands = req.body;
    if (!demands || !Array.isArray(demands) || demands.length === 0) {
      res.status(400).json({ detail: 'No pooling demands provided' });
      return;
    }

    const totalWeight = demands.reduce((s: number, d: any) => s + (d.weight_tons || 0), 0);
    const totalVolume = demands.reduce((s: number, d: any) => s + (d.volume_cbm || 0), 0);

    const mlPayload = {
      locations: [
        { id: 'depot', lat: 28.6139, lng: 77.2090, demand_kg: 0 },
        ...demands.map(d => ({
          id: d.id,
          lat: d.dest_lat || (Math.random() * 2 + 25),
          lng: d.dest_lng || (Math.random() * 2 + 73),
          demand_kg: (d.weight_tons || 1) * 1000
        }))
      ],
      vehicles: [{
        id: 'pool-truck',
        capacity_kg: 20000,
        start_lat: 28.6139,
        start_lng: 77.2090
      }],
      algorithm: "ortools"
    };

    let mlData: any = null;
    try {
      const resp = await fetch(`${settings.ML_SERVICE_URL}/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mlPayload)
      });
      if (resp.ok) mlData = await resp.json();
    } catch (e) {
      console.warn('ML Service unreachable, using fallback calculations');
    }

    // Calculate real distances using Mappls
    let separateTripsDistance = 1330.0;
    let consolidatedDistance = mlData?.total_distance_km || 670.0;

    try {
      const coords = [`77.2090,28.6139`, ...demands.map((d: any) => `${d.dest_lng || 77.2},${d.dest_lat || 28.6}`)];
      
      // 1. Separate trips: sum of distances from depot to each destination
      const sepMatrix = await MapplsService.getDistanceMatrix(coords, [0], demands.map((_, i) => i + 1));
      if (sepMatrix?.distances?.[0]) {
        separateTripsDistance = sepMatrix.distances[0].reduce((sum: number, dist: number) => sum + (dist / 1000), 0);
        // Multiply by 2 for round trips if each truck must return to depot
        separateTripsDistance *= 2; 
      }

      // 2. Consolidated route distance
      if (mlData?.routes?.[0]?.stop_ids) {
        const stopIds = mlData.routes[0].stop_ids;
        const routeCoords = stopIds.map((id: string) => {
          if (id === 'depot') return `77.2090,28.6139`;
          const d = demands.find((x: any) => x.id === id);
          return `${d?.dest_lng || 77.2},${d?.dest_lat || 28.6}`;
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

    const separateTripsCost = separateTripsDistance * 42.0;
    const consolidatedCost = consolidatedDistance * 52.0;
    const distanceSaved = separateTripsDistance - consolidatedDistance;
    const costSaved = separateTripsCost - consolidatedCost;
    const savingsPct = costSaved > 0 ? ((costSaved / separateTripsCost) * 100.0) : 0;
    const co2SavedKg = distanceSaved * 0.85;

    const stopsSequence = mlData?.routes?.[0]?.stop_ids?.map((id: string, idx: number) => {
      if (id === 'depot') return { name: 'Origin Depot', type: 'Origin Pickup', load_in_kg: totalWeight * 1000 };
      const d = demands.find(x => x.id === id);
      return { 
        name: d ? (d.destination || d.company) : id, 
        type: 'Unload', 
        unload_in_kg: d ? (d.weight_tons * 1000) : 0 
      };
    }) || [
      { name: 'Delhi Depot', type: 'Origin Pickup', load_in_kg: totalWeight * 1000 },
      { name: 'Destination 1', type: 'Partial Unload', unload_in_kg: 3000 },
      { name: 'Final Unload', type: 'Final Unload', unload_in_kg: 2000 },
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
      separate_trips_distance_km: parseFloat(separateTripsDistance.toFixed(1)),
      consolidated_distance_km: parseFloat(consolidatedDistance.toFixed(1)),
      distance_saved_km: parseFloat(distanceSaved.toFixed(1)),
      separate_trips_cost_inr: parseFloat(separateTripsCost.toFixed(2)),
      consolidated_cost_inr: parseFloat(consolidatedCost.toFixed(2)),
      cost_saved_inr: parseFloat(costSaved.toFixed(2)),
      savings_pct: parseFloat(savingsPct.toFixed(1)),
      co2_saved_kg: parseFloat(co2SavedKg.toFixed(1)),
      stops_sequence: stopsSequence,
      shared_pricing: sharedDiscounts,
      profitability_index: 92.5,
    });
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

// ── POST /backhaul-match ───────────────────────────────────
router.post('/backhaul-match', requireAuth, async (req: Request, res: Response) => {
  try {
    const opportunityId = req.body.opportunity_id;
    const availableCapacityKg = req.body.available_capacity_kg || 5000;

    let opp: any = SCENARIOS.backhaul.opportunities.find((o) => o.id === opportunityId);
    
    // Attempt to fetch from DB if not in static scenarios
    if (!opp) {
      const { data } = await supabase.from('shipments').select('*').eq('id', opportunityId).single();
      if (data) {
        opp = {
          id: data.id,
          shipper: data.origin_name || 'Unknown Shipper',
          origin: data.origin_address?.split(',')[0] || 'Unknown',
          destination: data.dest_address?.split(',')[0] || 'Unknown',
          weight_kg: data.total_weight_kg || 3000,
          cargo_type: data.load_type === 'full' ? 'heavy_machinery' : 'dry_bulk',
          revenue: (data.total_weight_kg || 3000) * 15,
          deviation_km: Math.floor(Math.random() * 50) + 5,
          profitability_score: Math.floor(Math.random() * 30) + 70,
        };
      }
    }

    if (!opp) {
      res.status(404).json({ detail: 'Opportunity not found' });
      return;
    }

    if (opp.weight_kg > availableCapacityKg) {
      res.json({
        status: 'rejected',
        reason: `Capacity Overload: Opportunity weight ${opp.weight_kg}kg exceeds remaining vehicle capacity of ${availableCapacityKg}kg.`,
        profitability_score: 0,
      });
      return;
    }

    // Call ML service for true route deviation or ETA prediction
    let deviationKm = opp.deviation_km || 20;
    try {
      const mlResp = await fetch(`${settings.ML_SERVICE_URL}/predict-eta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          distance_km: opp.deviation_km || 20,
          vehicle_type: 'truck'
        })
      });
      if (mlResp.ok) {
        // Just as an example, we can use the ML response to adjust our profitability score based on time
        const mlData = await mlResp.json();
      }
    } catch (e) {
      console.warn("ML service for backhaul unreachable, using fast heuristic");
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
      added_distance_km: deviationKm,
      added_fuel_liters: parseFloat(additionalFuelLiters.toFixed(1)),
      fuel_cost_inr: parseFloat(fuelCost.toFixed(1)),
      net_profit_inr: parseFloat(netProfit.toFixed(1)),
      new_route_waypoints: [
        'Mumbai (Unload Original)',
        `${opp.origin} (Pickup shared-load from ${opp.shipper})`,
        `${opp.destination} (Deliver shared-load)`,
        'Delhi Depot (Final Return Terminus)',
      ],
      profitability_score: opp.profitability_score || 85,
    });
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

// ── POST /verify-pod ───────────────────────────────────────
router.post('/verify-pod', requireAuth, async (req: Request, res: Response) => {
  try {
    const trackingId = req.body.tracking_id;
    const otp = req.body.otp;
    const lat = req.body.latitude;
    const lng = req.body.longitude;
    const photoUploaded = req.body.photo_uploaded || false;

    if (!trackingId) {
      res.status(400).json({ detail: 'Tracking ID required' });
      return;
    }

    const { data: shipment, error } = await supabase
      .from('shipments')
      .select('*')
      .eq('tracking_id', trackingId)
      .single();

    if (error || !shipment) {
      res.status(404).json({ detail: 'Shipment not found' });
      return;
    }

    // Master OTP 2026 or fallback to first 4 chars of ID
    if (otp !== '2026' && otp !== shipment.id.substring(0, 4)) {
      res.status(400).json({ detail: 'Invalid OTP code. Please verify code sent to recipient.' });
      return;
    }

    if (!lat || !lng) {
      res.status(400).json({ detail: 'GPS coordinates required for proof-of-delivery geo-tagging.' });
      return;
    }
    if (!photoUploaded) {
      res.status(400).json({ detail: 'Verification photo missing. Please take a cargo offload photo.' });
      return;
    }

    const targetLat = shipment.dest_lat || 24.5854;
    const targetLng = shipment.dest_lng || 73.7125;
    const distanceOffset = Math.sqrt(Math.pow(lat - targetLat, 2) + Math.pow(lng - targetLng, 2)) * 111.0;
    
    // Check if within 50km for demo
    if (distanceOffset > 50) {
      res.status(400).json({ detail: `Out of range. You are ${distanceOffset.toFixed(1)}km away from the destination.` });
      return;
    }

    const blockchainHash = `0x${uuidv4().replace(/-/g, '')}${uuidv4().replace(/-/g, '')}`.substring(0, 66);

    // Update DB
    await supabase.from('shipments').update({
      status: 'delivered',
      signature_data: blockchainHash
    }).eq('id', shipment.id);

    res.json({
      status: 'verified',
      tracking_id: trackingId,
      verified_at: new Date().toISOString(),
      recipient_name: shipment.received_by || 'Verified Recipient',
      gps_match_offset_meters: parseFloat((distanceOffset * 1000).toFixed(1)),
      gps_status: 'Within Geo-fenced Proximity Limit',
      blockchain_receipt: blockchainHash,
      message: 'Proof of Delivery successfully sealed & written to logistics ledger.',
    });
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

// ── GET /pricing-recommendations ───────────────────────────
router.get('/pricing-recommendations', async (req: Request, res: Response) => {
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
    res.status(500).json({ detail: e.message });
  }
});

export default router;
