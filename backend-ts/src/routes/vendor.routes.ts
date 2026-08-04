import { Router } from 'express';
import { vendorService } from '../services/vendor.service';
import { requireAuth, requireRole } from '../core/auth';
import { supabase } from '../core/supabase';

const router = Router();

// Get profile
router.get('/profile', requireAuth, async (req: any, res: any) => {
  try {
    let profile = await vendorService.getProfile(req.user.user_id);
    if (!profile) {
      // If the vendor has no profile, return an empty template with their own ID
      profile = {
        id: req.user.user_id,
        company_name: 'New Vendor (Pending Setup)',
        gst_number: '',
        city: '',
        address: '',
        latitude: null,
        longitude: null
      };
    }
    res.json(profile);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Upsert profile
router.post('/profile', requireAuth, requireRole('vendor'), async (req: any, res: any) => {
  try {
    const { companyName, gstNumber, city, address, lat, lng } = req.body;
    const profile = await vendorService.upsertProfile(req.user.user_id, companyName, gstNumber, city, address, lat, lng);
    res.json(profile);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Create shipment request (Vendor)
router.post('/shipment-request', requireAuth, requireRole('vendor'), async (req: any, res: any) => {
  try {
    const { pickup, drop, capacity } = req.body;
    const request = await vendorService.createShipmentRequest(req.user.user_id, pickup, drop, capacity);
    res.json(request);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get pending shipment requests (Super Admin)
router.get('/shipment-request/pending', requireAuth, requireRole('superadmin', 'admin'), async (req: any, res: any) => {
  try {
    const requests = await vendorService.getPendingRequests();
    res.json(requests);
  } catch (error: any) {
    console.error('Pending Requests Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Approve shipment request (Admin/Super Admin)
router.put('/shipment-request/:id/approve', requireAuth, requireRole('superadmin', 'admin'), async (req: any, res: any) => {
  try {
    const request = await vendorService.approveRequest(req.params.id);
    res.json(request);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Reject shipment request (Admin/Super Admin)
router.put('/shipment-request/:id/reject', requireAuth, requireRole('superadmin', 'admin'), async (req: any, res: any) => {
  try {
    const request = await vendorService.rejectRequest(req.params.id);
    res.json(request);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Assign vehicle to shipment request (Admin/Super Admin)
router.put('/shipment-request/:id/assign-vehicle', requireAuth, requireRole('superadmin', 'admin'), async (req: any, res: any) => {
  try {
    const { vehicle_id, cost, cost_per_km } = req.body;
    if (!vehicle_id) return res.status(400).json({ error: 'vehicle_id is required' });
    const request = await vendorService.assignVehicleToRequest(req.params.id, vehicle_id, cost, cost_per_km);
    res.json(request);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get market rates
router.get('/rates', requireAuth, async (req: any, res: any) => {
  try {
    const rates = await vendorService.getMarketRates();
    res.json(rates);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get passing routes (Vendor)
router.get('/passing-routes', requireAuth, requireRole('vendor'), async (req: any, res: any) => {
  try {
    const routes = await vendorService.getPassingRoutes(req.user.user_id);
    res.json(routes);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
