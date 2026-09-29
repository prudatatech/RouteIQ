import { Router } from 'express';
import { capacityService } from '../services/capacity.service';
import { requireAuth, requireRole } from '../core/auth';
import { STAFF_ROLES, canAccessConfirmation, canAccessVehicle, isStaff } from '../core/ownership';
import { sendError } from '../core/errors';

const router = Router();

// POST /api/v1/capacity/bids
router.post('/bids', requireAuth, requireRole('vendor', 'admin'), async (req, res) => {
  try {
    let { vendor_id, window_id, bid_amount, eway_bill_ref, dropoff_point_id, dropoff_name, dropoff_address, dropoff_lat, dropoff_lng, weight_kg, load_configuration } = req.body;

    const { supabase } = await import('../core/supabase');

    if (req.user!.role === 'vendor') {
      // Vendors always bid as themselves, and only once their KYC is approved
      vendor_id = req.user!.user_id;
      const { data: profile, error: profileErr } = await supabase.from('vendor_profiles').select('kyc_status').eq('id', vendor_id).maybeSingle();
      if (profileErr) throw profileErr;
      if (profile?.kyc_status !== 'approved') {
        return res.status(403).json({ error: 'Complete KYC verification before bidding' });
      }
    } else {
      // Admins bid on behalf of an explicit, existing vendor
      if (!vendor_id) {
        return res.status(400).json({ error: 'vendor_id is required' });
      }
      const { data: vProfile } = await supabase.from('vendor_profiles').select('id').eq('id', vendor_id).maybeSingle();
      if (!vProfile) {
        return res.status(400).json({ error: 'Vendor not found' });
      }
    }

    if (!window_id) {
      return res.status(400).json({ error: 'window_id is required' });
    }
    const weightKg = Number(weight_kg);
    if (!Number.isFinite(weightKg) || weightKg <= 0) {
      return res.status(400).json({ error: 'weight_kg must be a positive number' });
    }
    if (eway_bill_ref !== undefined && eway_bill_ref !== null && eway_bill_ref !== '') {
      eway_bill_ref = String(eway_bill_ref).replace(/\s+/g, '');
      if (!/^\d{12}$/.test(eway_bill_ref)) {
        return res.status(400).json({ error: 'E-way bill number must be 12 digits' });
      }
    } else {
      eway_bill_ref = null;
    }

    let createdPointId: string | null = null;
    if (dropoff_point_id) {
      const { data: point } = await supabase.from('delivery_points').select('id').eq('id', dropoff_point_id).maybeSingle();
      if (!point) {
        return res.status(400).json({ error: 'Drop-off point not found' });
      }
    } else {
      // New drop-off location chosen by the vendor
      const lat = Number(dropoff_lat);
      const lng = Number(dropoff_lng);
      if (!dropoff_name || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) {
        return res.status(400).json({ error: 'A drop-off location with valid coordinates is required' });
      }
      const { data: point, error: pointErr } = await supabase.from('delivery_points').insert({
        name: String(dropoff_name).slice(0, 255),
        address: dropoff_address || dropoff_name,
        latitude: lat,
        longitude: lng,
        demand_kg: weightKg,
      }).select('id').single();
      if (pointErr) throw pointErr;
      dropoff_point_id = point.id;
      createdPointId = point.id;
    }

    let bid;
    try {
      bid = await capacityService.submitBid({
        vendor_id,
        window_id,
        bid_amount,
        eway_bill_ref,
        dropoff_point_id,
        weight_kg: weightKg,
        load_configuration
      });
    } catch (e) {
      // Don't leave the drop-off point behind when the bid is rejected
      if (createdPointId) await supabase.from('delivery_points').delete().eq('id', createdPointId);
      throw e;
    }
    res.json(bid);
  } catch (error: any) {
    sendError(req, res, error, 'error');
  }
});

// GET /api/v1/capacity/windows/open — open windows without vehicle/driver details
router.get('/windows/open', requireAuth, requireRole('vendor', ...STAFF_ROLES), async (req, res) => {
  try {
    res.json(await capacityService.listOpenWindowsForVendors());
  } catch (error: any) {
    sendError(req, res, error, 'error');
  }
});

// GET /api/v1/capacity/bids/mine — the caller's own bids
router.get('/bids/mine', requireAuth, requireRole('vendor', ...STAFF_ROLES), async (req, res) => {
  try {
    res.json(await capacityService.listVendorBids(req.user!.user_id));
  } catch (error: any) {
    sendError(req, res, error, 'error');
  }
});

// GET /api/v1/capacity/nearby-vendors
router.get('/nearby-vendors', requireAuth, requireRole(...STAFF_ROLES), async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat as string);
    const lng = parseFloat(req.query.lng as string);
    const radiusKm = parseFloat(req.query.radius as string) || 50;

    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ error: 'Valid lat and lng query params are required' });
    }

    const { supabase } = await import('../core/supabase');
    
    // For simplicity, we just fetch all vendors and filter them in memory
    // In production, you'd use PostGIS or the calculate_distance RPC we have
    const { data: vendors, error } = await supabase.from('vendor_profiles').select('id, company_name, city, latitude, longitude');
    
    if (error) throw error;
    
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

    const nearby = (vendors || [])
      .filter(v => v.latitude && v.longitude)
      .map(v => ({
        ...v,
        distance_km: calcDist(lat, lng, v.latitude, v.longitude)
      }))
      .filter(v => v.distance_km <= radiusKm)
      .sort((a, b) => a.distance_km - b.distance_km);

    res.json(nearby);
  } catch (error: any) {
    sendError(req, res, error, 'error');
  }
});

// GET /api/v1/capacity/windows/:id/bid-count
router.get('/windows/:id/bid-count', requireAuth, async (req, res) => {
  try {
    const { supabase } = await import('../core/supabase');
    if (req.user!.role === 'driver') {
      const { data: window } = await supabase.from('capacity_windows').select('vehicle_id').eq('id', req.params.id).maybeSingle();
      if (!window || !(await canAccessVehicle(req.user!, window.vehicle_id))) {
        res.status(403).json({ error: 'Not authorized for this window' });
        return;
      }
    } else if (!isStaff(req.user) && req.user!.role !== 'vendor') {
      res.status(403).json({ error: 'Not authorized' });
      return;
    }
    const { count, error } = await supabase
      .from('capacity_bids')
      .select('*', { count: 'exact', head: true })
      .eq('window_id', req.params.id);
    
    if (error) throw error;
    res.json({ count: count || 0 });
  } catch (error: any) {
    sendError(req, res, error, 'error');
  }
});

// POST /api/v1/capacity/driver/open-backhaul-window
router.post('/driver/open-backhaul-window', requireAuth, requireRole('driver', 'admin', 'superadmin'), async (req, res) => {
  try {
    const { vehicle_id, available_capacity_kg, trigger_type } = req.body;
    if (!vehicle_id || !available_capacity_kg || !trigger_type) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    if (!(await canAccessVehicle(req.user!, vehicle_id))) {
      return res.status(403).json({ error: 'Not authorized for this vehicle' });
    }
    const window = await capacityService.openBackhaulWindow(vehicle_id, available_capacity_kg, trigger_type);
    res.json(window);
  } catch (error: any) {
    sendError(req, res, error, 'error');
  }
});

// POST /api/v1/capacity/driver/toggle-matching
router.post('/driver/toggle-matching', requireAuth, requireRole('driver'), async (req, res) => {
  try {
    const { vehicle_id, enabled } = req.body;
    if (!vehicle_id || !(await canAccessVehicle(req.user!, vehicle_id))) {
      return res.status(403).json({ error: 'Not authorized for this vehicle' });
    }
    await capacityService.toggleMatching(vehicle_id, enabled);
    res.json({ success: true });
  } catch (error: any) {
    sendError(req, res, error, 'error');
  }
});

// POST /api/v1/capacity/driver/ack-stop
router.post('/driver/ack-stop', requireAuth, requireRole('driver'), async (req, res) => {
  try {
    const { confirmation_id } = req.body;
    if (!confirmation_id || !(await canAccessConfirmation(req.user!, confirmation_id))) {
      return res.status(403).json({ error: 'Not authorized for this confirmation' });
    }
    await capacityService.ackStopDelivery(confirmation_id);
    res.json({ success: true });
  } catch (error: any) {
    sendError(req, res, error, 'error');
  }
});

// POST /api/v1/capacity/driver/flag-stop
router.post('/driver/flag-stop', requireAuth, requireRole('driver'), async (req, res) => {
  try {
    const { confirmation_id } = req.body;
    if (!confirmation_id || !(await canAccessConfirmation(req.user!, confirmation_id))) {
      return res.status(403).json({ error: 'Not authorized for this confirmation' });
    }
    await capacityService.flagStop(confirmation_id);
    res.json({ success: true });
  } catch (error: any) {
    sendError(req, res, error, 'error');
  }
});

// GET /api/v1/capacity/bids/pending
router.get('/bids/pending', requireAuth, requireRole('superadmin', 'admin'), async (req, res) => {
  try {
    const { supabase } = await import('../core/supabase');
    const { data, error } = await supabase
      .from('capacity_bids')
      .select('*, vendor_profiles(company_name, city), delivery_points(name, address), capacity_windows!capacity_bids_window_id_fkey(vehicles(plate_number))')
      .eq('status', 'pending')
      .order('submitted_at', { ascending: false });
      
    if (error) throw new Error(error.message);
    res.json(data);
  } catch (error: any) {
    sendError(req, res, error, 'error');
  }
});

// POST /api/v1/capacity/bids/:id/approve
router.post('/bids/:id/approve', requireAuth, requireRole('superadmin', 'admin'), async (req, res) => {
  try {
    const bid = await capacityService.approveBid(req.params.id);
    res.json(bid);
  } catch (error: any) {
    sendError(req, res, error, 'error');
  }
});

// POST /api/v1/capacity/bids/:id/reject
router.post('/bids/:id/reject', requireAuth, requireRole('superadmin', 'admin'), async (req, res) => {
  try {
    const bid = await capacityService.rejectBid(req.params.id);
    res.json(bid);
  } catch (error: any) {
    sendError(req, res, error, 'error');
  }
});

export default router;
