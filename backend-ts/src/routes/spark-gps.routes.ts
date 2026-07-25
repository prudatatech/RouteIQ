/**
 * RouteIQ — Spark GPS Push API Routes
 * Ports: backend/app/api/v1/endpoints/spark_gps.py
 * 
 * This endpoint receives hardware GPS data pushed from SparkGPS/Roadcast devices.
 * No auth required — devices push directly.
 */
import { Router, Request, Response } from 'express';
import { supabase } from '../core/supabase';

const router = Router();

// ── POST / — Receive Spark GPS push ────────────────────────
router.post('/', async (req: Request, res: Response) => {
  try {
    const vehicleNo = req.body.vehicleNo;
    if (!vehicleNo) {
      res.status(400).json({ detail: 'vehicleNo missing' });
      return;
    }

    // Find vehicle by plate number
    const { data: vehicle, error: vErr } = await supabase
      .from('vehicles')
      .select('id')
      .eq('plate_number', vehicleNo)
      .single();

    if (vErr || !vehicle) {
      res.status(404).json({ detail: 'Vehicle not found' });
      return;
    }

    const lat = req.body.lat;
    const lng = req.body.lng;
    if (lat === undefined || lat === null || lng === undefined || lng === null) {
      res.status(400).json({ detail: 'lat/lng missing' });
      return;
    }

    const { data: point, error } = await supabase
      .from('gps_points')
      .insert({
        vehicle_id: vehicle.id,
        latitude: lat,
        longitude: lng,
        accuracy: null,
        recorded_at: req.body.timestamp || new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) {
      res.status(500).json({ detail: error.message });
      return;
    }

    res.status(201).json({ status: 'success', gps_point_id: point?.id });
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

export default router;
