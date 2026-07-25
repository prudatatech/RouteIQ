import { Router } from 'express';
import { capacityService } from '../services/capacity.service';
import { requireAuth, requireRole } from '../core/auth';

const router = Router();

// POST /api/v1/capacity/bids
router.post('/bids', requireAuth, requireRole('vendor', 'admin'), async (req, res) => {
  try {
    let { vendor_id, window_id, bid_amount, eway_bill_ref, dropoff_point_id, dropoff_name, dropoff_address, dropoff_lat, dropoff_lng, weight_kg, load_configuration } = req.body;
    
    // ensure vendor_id matches logged in user unless admin
    if (req.user!.role !== 'admin' && req.user!.role !== 'superadmin' && req.user!.user_id !== vendor_id) {
      return res.status(403).json({ error: 'You can only bid for your own vendor account.' });
    }

    // Fallback for admins testing the UI: use a real vendor ID if they don't have one
    if (req.user!.role === 'admin' || req.user!.role === 'superadmin') {
      const { supabase } = await import('../core/supabase');
      const { data: vProfile } = await supabase.from('vendor_profiles').select('id').eq('id', vendor_id).single();
      if (!vProfile) {
        const { data: anyVendor } = await supabase.from('vendor_profiles').select('id').limit(1).single();
        if (anyVendor) {
          vendor_id = anyVendor.id;
        }
      }
    }

    // If dropoff_point_id is missing but we have name and coords, create the delivery point on the fly!
    if (!dropoff_point_id && dropoff_name) {
      const { supabase } = await import('../core/supabase');
      const { v4: uuidv4 } = await import('uuid');
      const newDpId = uuidv4();
      await supabase.from('delivery_points').insert({
        id: newDpId,
        name: dropoff_name,
        address: dropoff_address || dropoff_name,
        latitude: dropoff_lat || 0.0,
        longitude: dropoff_lng || 0.0,
        demand_kg: weight_kg || 1.0,
      });
      dropoff_point_id = newDpId;
    }

    const bid = await capacityService.submitBid({
      vendor_id,
      window_id,
      bid_amount,
      eway_bill_ref,
      dropoff_point_id,
      weight_kg,
      load_configuration
    });
    res.json(bid);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// GET /api/v1/capacity/nearby-vendors
router.get('/nearby-vendors', requireAuth, async (req, res) => {
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
    res.status(500).json({ error: error.message });
  }
});

// GET /api/v1/capacity/windows/:id/bid-count
router.get('/windows/:id/bid-count', async (req, res) => {
  try {
    const { supabase } = await import('../core/supabase');
    const { count, error } = await supabase
      .from('capacity_bids')
      .select('*', { count: 'exact', head: true })
      .eq('window_id', req.params.id);
    
    if (error) throw error;
    res.json({ count: count || 0 });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/v1/capacity/driver/open-backhaul-window
router.post('/driver/open-backhaul-window', requireAuth, requireRole('driver', 'admin', 'superadmin'), async (req, res) => {
  try {
    const { vehicle_id, available_capacity_kg, trigger_type } = req.body;
    if (!vehicle_id || !available_capacity_kg || !trigger_type) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    const window = await capacityService.openBackhaulWindow(vehicle_id, available_capacity_kg, trigger_type);
    res.json(window);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// POST /api/v1/capacity/driver/toggle-matching
router.post('/driver/toggle-matching', requireAuth, requireRole('driver'), async (req, res) => {
  try {
    const { vehicle_id, enabled } = req.body;
    await capacityService.toggleMatching(vehicle_id, enabled);
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// POST /api/v1/capacity/driver/ack-stop
router.post('/driver/ack-stop', requireAuth, requireRole('driver'), async (req, res) => {
  try {
    const { confirmation_id } = req.body;
    await capacityService.ackStopDelivery(confirmation_id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// POST /api/v1/capacity/driver/flag-stop
router.post('/driver/flag-stop', requireAuth, requireRole('driver'), async (req, res) => {
  try {
    const { confirmation_id } = req.body;
    await capacityService.flagStop(confirmation_id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// GET /api/v1/capacity/windows/:id/upcoming-stops
router.get('/windows/:id/upcoming-stops', requireAuth, async (req, res) => {
  try {
    const { supabase } = await import('../core/supabase');
    const { data: window } = await supabase.from('capacity_windows').select('vehicle_id').eq('id', req.params.id).single();
    if (!window) return res.status(404).json({ error: 'Window not found' });
    
    let routeStops: any[] = [];
    const { data: route } = await supabase.from('routes').select('id').eq('vehicle_id', window.vehicle_id).eq('status', 'active').single();
    if (route) {
      const { data: stops } = await supabase.from('route_stops').select('delivery_points(*)').eq('route_id', route.id).eq('status', 'pending');
      routeStops = stops?.map(s => s.delivery_points).filter(Boolean) || [];
    }

      // Inject Vendor Primary Hub if the requester is a vendor
      if (req.user) {
        let { data: vendor } = await supabase.from('vendor_profiles').select('*').eq('id', req.user.user_id).single();
        
        // Fallback for admins testing the vendor portal
        if (!vendor && (req.user.role === 'admin' || req.user.role === 'superadmin')) {
          const { data: anyVendor } = await supabase.from('vendor_profiles').select('*').limit(1).single();
          vendor = anyVendor;
        }

        if (vendor) {
          const companyName = vendor.company_name || 'Unknown Vendor';
          const address = vendor.address || vendor.city || 'Default Hub Address';
          const lat = vendor.latitude || 0;
          const lng = vendor.longitude || 0;
        
        let existingHub = null;
        const { data: hubs } = await supabase.from('delivery_points').select('*').eq('latitude', lat).eq('longitude', lng).limit(1);
        if (hubs && hubs.length > 0) {
          existingHub = hubs[0];
        } else {
          const hubName = `Primary Hub (${companyName})`;
          const { data: newHub } = await supabase.from('delivery_points').insert({
            name: hubName,
            address: address,
            latitude: lat,
            longitude: lng
          }).select('*').single();
          existingHub = newHub;
        }

        if (existingHub) {
          let distanceKm = 0;
          let etaMins = 0;
          
          // Calculate exact OSRM detour from current vehicle location to the hub
          const { data: vehicle } = await supabase.from('vehicles').select('latitude, longitude').eq('id', window.vehicle_id).single();
          if (vehicle?.latitude && vehicle?.longitude && lat && lng) {
            try {
              const axios = require('axios');
              const osrmRes = await axios.get(`https://router.project-osrm.org/route/v1/driving/${vehicle.longitude},${vehicle.latitude};${lng},${lat}?overview=false`);
              if (osrmRes.data.routes && osrmRes.data.routes.length > 0) {
                const routeData = osrmRes.data.routes[0];
                distanceKm = Math.round(routeData.distance / 1000 * 10) / 10;
                etaMins = Math.round(routeData.duration / 60);
              }
            } catch (e: any) {
              console.error("OSRM Error:", e.message);
            }
          }

          const hubStop = { ...existingHub, name: `${existingHub.name} [Detour: +${distanceKm}km, +${etaMins}m ETA]` };
          routeStops.unshift(hubStop);
        }
        }
      }
      
      routeStops.push({ id: 'mock-123', name: 'Mock UI Test', address: 'Visible from backend' });
      console.log("Returning routeStops length:", routeStops.length);
      res.json(routeStops);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
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
    res.status(400).json({ error: error.message });
  }
});

// POST /api/v1/capacity/bids/:id/approve
router.post('/bids/:id/approve', requireAuth, requireRole('superadmin', 'admin'), async (req, res) => {
  try {
    const bid = await capacityService.approveBid(req.params.id);
    res.json(bid);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// POST /api/v1/capacity/bids/:id/reject
router.post('/bids/:id/reject', requireAuth, requireRole('superadmin', 'admin'), async (req, res) => {
  try {
    const bid = await capacityService.rejectBid(req.params.id);
    res.json(bid);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
