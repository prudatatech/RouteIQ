/**
 * margixindia — Shipment Routes
 * Ports: backend/app/api/v1/endpoints/shipments.py
 */
import { Router, Request, Response } from 'express';
import { supabase } from '../core/supabase';
import { requireAuth, requireRole } from '../core/auth';
import { ShipmentCreateSchema } from '../schemas';
import { ShipmentService } from '../services/shipment.service';
import { SecurityService } from '../services/security.service';

const router = Router();

// ── POST / ─────────────────────────────────────────────────
router.post('/', requireAuth, requireRole('superadmin', 'admin', 'manager'), async (req: Request, res: Response) => {
  try {
    const parsed = ShipmentCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ detail: parsed.error.issues[0].message });
      return;
    }
    const shipment = await ShipmentService.createShipment(parsed.data);
    res.status(201).json(shipment);
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

// ── GET / ──────────────────────────────────────────────────
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const skip = parseInt(req.query.skip as string) || 0;
    const limit = parseInt(req.query.limit as string) || 100;
    const shipments = await ShipmentService.listShipments(skip, limit);
    res.json(shipments);
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

// ── GET /track/:tracking_id (PUBLIC — no auth) ─────────────
router.get('/track/:tracking_id', requireAuth, async (req: Request, res: Response) => {
  try {
    const info = await ShipmentService.getPublicTracking(req.params.tracking_id);
    if (!info) {
      res.status(404).json({ detail: 'Shipment with this tracking ID not found' });
      return;
    }

    const user = (req as any).user;
    const isAdmin = ['admin', 'superadmin'].includes(user.role);
    if (!isAdmin && user.user_id !== info.vendor_id) {
      res.status(403).json({ detail: 'Forbidden: You do not have access to this tracking information.' });
      return;
    }

    res.json(info);
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

// ── GET /track/:tracking_id/route (PUBLIC — Google Maps Directions Proxy) ──
router.get('/track/:tracking_id/route', requireAuth, async (req: Request, res: Response) => {
  try {
    const lat = req.query.lat as string;
    const lng = req.query.lng as string;
    const dLat = req.query.dLat as string;
    const dLng = req.query.dLng as string;

    if (!lat || !lng || !dLat || !dLng) {
      res.status(400).json({ detail: 'Missing coordinates' });
      return;
    }

    // Fetch directly from Google Maps API to get both polyline and duration
    const { settings } = await import('../core/config');
    const axios = (await import('axios')).default;

    if (!settings.GOOGLE_MAPS_API_KEY) {
      res.status(500).json({ detail: 'Google Maps API key not configured' });
      return;
    }

    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${lat},${lng}&destination=${dLat},${dLng}&key=${settings.GOOGLE_MAPS_API_KEY}`;
    const response = await axios.get(url);

    if (response.data.status !== 'OK' || !response.data.routes?.[0]) {
      res.status(404).json({ detail: 'Route not found' });
      return;
    }

    const route = response.data.routes[0];
    const polyline = route.overview_polyline.points;
    let durationSeconds = 0;

    if (route.legs && route.legs.length > 0) {
      durationSeconds = route.legs.reduce((acc: number, leg: any) => acc + (leg.duration?.value || 0), 0);
    }

    const polylineModule = await import('@mapbox/polyline');
    const decoded = polylineModule.default.decode(polyline);
    const geojsonCoords = decoded.map(coord => [coord[1], coord[0]]);

    res.json({ coordinates: geojsonCoords, raw_polyline: polyline, duration_seconds: durationSeconds });
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

// ── GET /:shipment_id ──────────────────────────────────────
router.get('/:shipment_id', requireAuth, async (req: Request, res: Response) => {
  try {
    const shipment = await ShipmentService.getShipment(req.params.shipment_id);
    if (!shipment) {
      res.status(404).json({ detail: 'Shipment not found' });
      return;
    }
    res.json(shipment);
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

// ── PUT /:shipment_id/metadata ─────────────────────────────
router.put('/:shipment_id/metadata', requireAuth, requireRole('superadmin', 'admin'), async (req: Request, res: Response) => {
  try {
    const metadata = req.body;
    if (!metadata) {
      res.status(400).json({ detail: 'Metadata body is required' });
      return;
    }

    const shipment = await ShipmentService.updateShipmentMetadata(
      req.params.shipment_id, metadata
    );
    if (!shipment) {
      res.status(404).json({ detail: 'Shipment not found' });
      return;
    }
    res.json(shipment);
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

// ── PATCH /:shipment_id (status update with POD) ───────────
router.patch('/:shipment_id', requireAuth, async (req: Request, res: Response) => {
  try {
    const status = req.body.status as string;
    const lat = req.body.lat ? parseFloat(req.body.lat as string) : undefined;
    const lng = req.body.lng ? parseFloat(req.body.lng as string) : undefined;
    const receivedBy = req.body.received_by as string | undefined;
    const signatureData = req.body.signature_data as string | undefined;

    if (!status || !['created', 'picked_up', 'in_transit', 'delivered', 'cancelled'].includes(status)) {
      res.status(400).json({ detail: 'Invalid status value' });
      return;
    }

    const shipment = await ShipmentService.updateShipmentStatus(
      req.params.shipment_id, status, lat, lng, receivedBy, signatureData
    );
    if (!shipment) {
      res.status(404).json({ detail: 'Shipment not found' });
      return;
    }
    res.json(shipment);
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

// ── GET /:shipment_id/verify ───────────────────────────────
router.get('/:shipment_id/verify', async (req: Request, res: Response) => {
  try {
    const shipment = await ShipmentService.getShipment(req.params.shipment_id);
    if (!shipment) {
      res.status(404).json({ detail: 'Shipment not found' });
      return;
    }
    const isValid = SecurityService.verifyChain(shipment.logs || []);
    res.json({
      shipment_id: req.params.shipment_id,
      is_valid: isValid,
      log_count: (shipment.logs || []).length,
      last_status: shipment.status,
    });
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

// ── DELETE /:shipment_id ───────────────────────────────────
router.delete('/:shipment_id', requireAuth, requireRole('superadmin', 'admin', 'manager'), async (req: Request, res: Response) => {
  try {
    const success = await ShipmentService.deleteShipment(req.params.shipment_id);
    if (!success) {
      res.status(404).json({ detail: 'Shipment not found' });
      return;
    }
    res.json({ message: 'Shipment deleted successfully' });
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

// ── PATCH /:shipment_id/edit ───────────────────────────────
router.patch('/:shipment_id/edit', requireAuth, requireRole('superadmin', 'admin', 'manager'), async (req: Request, res: Response) => {
  try {
    const shipment = await ShipmentService.updateShipment(req.params.shipment_id, req.body);
    if (!shipment) {
      res.status(404).json({ detail: 'Shipment not found' });
      return;
    }
    res.json(shipment);
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

// ── GET /:shipment_id/assign-options ───────────────────────
router.get('/:shipment_id/assign-options', requireAuth, requireRole('superadmin', 'admin', 'manager'), async (req: Request, res: Response) => {
  try {
    const mode = req.query.mode as string;
    const shipment = await ShipmentService.getShipment(req.params.shipment_id);
    if (!shipment) {
      res.status(404).json({ detail: 'Shipment not found' });
      return;
    }

    // Fetch all vehicles
    const { data: vehicles, error } = await supabase.from('vehicles').select('*').in('status', ['available', 'idle', 'on_route']);
    if (error) throw error;

    let options = vehicles || [];

    if (mode === 'near' && shipment.origin_lat && shipment.origin_lng) {
      // Calculate haversine distance
      const toRad = (value: number) => (value * Math.PI) / 180;
      const calcDist = (lat1: number, lon1: number, lat2: number, lon2: number) => {
        const R = 6371; // km
        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
          Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
      };

      options = options.map(v => {
        if (v.latitude && v.longitude) {
          const dist = calcDist(shipment.origin_lat!, shipment.origin_lng!, v.latitude, v.longitude);
          return { ...v, distance_km: dist };
        }
        return { ...v, distance_km: 999999 };
      });
      options.sort((a, b) => (a.distance_km || 0) - (b.distance_km || 0));
    }

    res.json(options);
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

// ── POST /:shipment_id/assign ──────────────────────────────
router.post('/:shipment_id/assign', requireAuth, requireRole('superadmin', 'admin', 'manager'), async (req: Request, res: Response) => {
  try {
    const { vehicle_id } = req.body;
    if (!vehicle_id) {
      res.status(400).json({ detail: 'vehicle_id is required' });
      return;
    }
    const shipment = await ShipmentService.assignDriver(req.params.shipment_id, vehicle_id);
    if (!shipment) {
      res.status(404).json({ detail: 'Shipment not found or could not be assigned' });
      return;
    }
    res.json(shipment);
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

export default router;
