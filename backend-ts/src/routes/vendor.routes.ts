import { Router } from 'express';
import { vendorService } from '../services/vendor.service';
import { requireAuth, requireRole } from '../core/auth';
import { supabase } from '../core/supabase';
import { parseRejectionReason, sendError } from '../core/errors';

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
    sendError(req, res, error, 'error');
  }
});

// Upsert profile
router.post('/profile', requireAuth, requireRole('vendor'), async (req: any, res: any) => {
  try {
    const { companyName, gstNumber, city, address, lat, lng } = req.body;
    const profile = await vendorService.upsertProfile(req.user.user_id, companyName, gstNumber, city, address, lat, lng);
    res.json(profile);
  } catch (error: any) {
    sendError(req, res, error, 'error');
  }
});

// Submit (or resubmit) the full KYC wizard — always notifies staff (D2)
router.post('/kyc/submit', requireAuth, requireRole('vendor'), async (req: any, res: any) => {
  try {
    const { companyName, gstNumber, city, address, lat, lng, companyLogo, kycData } = req.body;
    const profile = await vendorService.submitKyc(req.user.user_id, {
      companyName, gstNumber, city, address, lat, lng, companyLogo, kycData,
    });
    res.json(profile);
  } catch (error: any) {
    sendError(req, res, error, 'error');
  }
});

// Create shipment request (Vendor)
router.post('/shipment-request', requireAuth, requireRole('vendor'), async (req: any, res: any) => {
  try {
    const { pickup, drop, capacity, metadata } = req.body;
    const request = await vendorService.createShipmentRequest(req.user.user_id, pickup, drop, capacity, metadata);
    res.json(request);
  } catch (error: any) {
    sendError(req, res, error, 'error');
  }
});

// Get pending shipment requests (Super Admin)
router.get('/shipment-request/pending', requireAuth, requireRole('superadmin', 'admin'), async (req: any, res: any) => {
  try {
    const requests = await vendorService.getPendingRequests();
    res.json(requests);
  } catch (error: any) {
    sendError(req, res, error, 'error');
  }
});

// Approve shipment request (Admin/Super Admin)
router.put('/shipment-request/:id/approve', requireAuth, requireRole('superadmin', 'admin'), async (req: any, res: any) => {
  try {
    const request = await vendorService.approveRequest(req.params.id);
    res.json(request);
  } catch (error: any) {
    sendError(req, res, error, 'error');
  }
});

// Reject shipment request (Admin/Super Admin)
router.put('/shipment-request/:id/reject', requireAuth, requireRole('superadmin', 'admin'), async (req: any, res: any) => {
  try {
    const reason = parseRejectionReason(req.body?.reason);
    const request = await vendorService.rejectRequest(req.params.id, reason);
    res.json(request);
  } catch (error: any) {
    sendError(req, res, error, 'error');
  }
});

// Reject a vendor's KYC, storing why (Admin/Super Admin)
router.put('/kyc/:id/reject', requireAuth, requireRole('superadmin', 'admin'), async (req: any, res: any) => {
  try {
    const reason = parseRejectionReason(req.body?.reason);
    const data = await vendorService.rejectKyc(req.params.id, reason);
    res.json({ success: true, data });
  } catch (error: any) {
    sendError(req, res, error, 'error');
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
    sendError(req, res, error, 'error');
  }
});

// Get market rates
router.get('/rates', requireAuth, async (req: any, res: any) => {
  try {
    const rates = await vendorService.getMarketRates();
    res.json(rates);
  } catch (error: any) {
    sendError(req, res, error, 'error');
  }
});

// Get passing routes (Vendor)
router.get('/passing-routes', requireAuth, requireRole('vendor'), async (req: any, res: any) => {
  try {
    const routes = await vendorService.getPassingRoutes(req.user.user_id);
    res.json(routes);
  } catch (error: any) {
    sendError(req, res, error, 'error');
  }
});

export default router;
