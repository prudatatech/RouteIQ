import { Router, Request, Response } from 'express';
import { supabase } from '../core/supabase';
import { requireAuth } from '../core/auth';
import crypto from 'crypto';

const router = Router();

// ── GET /open-loads ──
router.get('/open-loads', requireAuth, async (req: Request, res: Response) => {
  try {
    // Fetch shipments that have no active driver (status = 'created')
    const { data: shipments, error } = await supabase
      .from('shipments')
      .select('*, delivery_points(*)')
      .eq('status', 'created')
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) throw error;

    // Format for mobile app
    const openLoads = shipments?.map(s => {
      const dp = Array.isArray(s.delivery_points) ? s.delivery_points[0] : s.delivery_points;
      
      // Calculate a mock price based on weight (e.g. $0.50 per kg)
      const mockPrice = Math.round((s.total_weight_kg || 500) * 0.50);
      
      return {
        id: s.id,
        origin_name: s.origin_name || 'Warehouse Alpha',
        origin_address: s.origin_address || 'Industrial Area',
        origin_lat: s.origin_lat || 19.0760,
        origin_lng: s.origin_lng || 72.8777,
        destination_name: dp?.name || 'Customer Location',
        destination_address: dp?.address || 'Unknown Address',
        destination_lat: dp?.latitude || 19.1,
        destination_lng: dp?.longitude || 72.9,
        weight_kg: s.total_weight_kg || dp?.demand_kg || 100,
        price_usd: mockPrice,
        priority: s.priority
      };
    }) || [];

    res.json({ loads: openLoads });
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

// ── POST /bid ──
router.post('/bid', requireAuth, async (req: Request, res: Response) => {
  try {
    if (req.user!.role !== 'driver') {
      res.status(403).json({ detail: 'Only drivers can bid on marketplace loads' });
      return;
    }

    const { shipment_id } = req.body;
    if (!shipment_id) return res.status(400).json({ detail: 'shipment_id is required' });

    // 1. Get driver's vehicle and active route
    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('id, capacity_kg')
      .eq('driver_id', req.user!.user_id)
      .single();

    if (!vehicle) return res.status(404).json({ detail: 'No vehicle assigned' });

    const { data: activeRoute } = await supabase
      .from('routes')
      .select('id, route_stops(id, status, sequence, delivery_points(demand_kg))')
      .eq('vehicle_id', vehicle.id)
      .eq('status', 'active')
      .single();

    if (!activeRoute) return res.status(400).json({ detail: 'You must have an active route to bid on a return load' });

    // Calculate current payload (sum of pending stops)
    const pendingStops = (activeRoute.route_stops || []).filter((s: any) => s.status === 'pending');
    const currentPayload = pendingStops.reduce((sum: number, s: any) => {
      const dp = Array.isArray(s.delivery_points) ? s.delivery_points[0] : s.delivery_points;
      return sum + (dp?.demand_kg || 0);
    }, 0);

    const remainingSpace = vehicle.capacity_kg - currentPayload;

    // 2. Verify Shipment
    const { data: shipment } = await supabase
      .from('shipments')
      .select('*, delivery_points(*)')
      .eq('id', shipment_id)
      .single();

    if (!shipment || shipment.status !== 'created') {
      return res.status(400).json({ detail: 'Load is no longer available' });
    }

    const loadWeight = shipment.total_weight_kg || 100;
    if (loadWeight > remainingSpace) {
      return res.status(400).json({ detail: `Not enough capacity. Need ${loadWeight}kg but only have ${remainingSpace}kg space left.` });
    }

    // 3. Update Shipment Status
    await supabase.from('shipments').update({ status: 'picked_up' }).eq('id', shipment_id);

    // 4. Create Pickup Delivery Point
    const { data: pickupDp, error: pickupErr } = await supabase.from('delivery_points').insert({
      id: crypto.randomUUID(),
      name: `Pickup: ${shipment.origin_name || 'Marketplace Load'}`,
      address: shipment.origin_address || 'Origin Address',
      latitude: shipment.origin_lat || 0,
      longitude: shipment.origin_lng || 0,
      demand_kg: 0, 
      service_time_minutes: 10,
      status: 'pending',
      shipment_id: shipment.id
    }).select().single();
    
    if (pickupErr) throw pickupErr;

    // 5. Get Dropoff Delivery Point
    const dropoffDp = Array.isArray(shipment.delivery_points) ? shipment.delivery_points[0] : shipment.delivery_points;
    if (!dropoffDp) {
        throw new Error("Shipment has no dropoff point");
    }

    // 6. Calculate new sequence numbers (append to end of route)
    const nextSeq = pendingStops.length > 0 ? Math.max(...pendingStops.map((s: any) => s.sequence || 0)) + 1 : 1;

    // 7. Insert new route stops (Pickup then Dropoff)
    await supabase.from('route_stops').insert([
      {
        id: crypto.randomUUID(),
        route_id: activeRoute.id,
        delivery_point_id: pickupDp.id,
        sequence: nextSeq,
        status: 'pending'
      },
      {
        id: crypto.randomUUID(),
        route_id: activeRoute.id,
        delivery_point_id: dropoffDp.id,
        sequence: nextSeq + 1,
        status: 'pending'
      }
    ]);

    res.json({ success: true, message: 'Load accepted and dynamically routed!' });
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

export default router;
