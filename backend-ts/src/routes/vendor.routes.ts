import { Router } from 'express';
import { vendorService } from '../services/vendor.service';
import { requireAuth, requireRole } from '../core/auth';
import { STAFF_ROLES } from '../core/ownership';
import { supabase } from '../core/supabase';
import { HttpError, parseRejectionReason, sendError } from '../core/errors';
import { rateLimitByUser } from '../core/rate-limit';
import {
  KycDocumentsSchema, KycSubmitSchema, ShipmentRequestSchema, VendorProfileSchema,
  assertKycContent, parseBody,
} from '../schemas/vendor';

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
    const { companyName, gstNumber, city, address, lat, lng } = parseBody(VendorProfileSchema, req.body);
    const profile = await vendorService.upsertProfile(req.user.user_id, companyName, gstNumber, city, address, lat, lng);
    res.json(profile);
  } catch (error: any) {
    sendError(req, res, error, 'error');
  }
});

// Submit (or resubmit) the full KYC wizard — always notifies staff (D2)
router.post('/kyc/submit', requireAuth, requireRole('vendor'), async (req: any, res: any) => {
  try {
    const input = parseBody(KycSubmitSchema, req.body);
    assertKycContent(req.user.user_id, input);
    const { companyName, gstNumber, city, address, lat, lng, companyLogo, kycData } = input;
    const profile = await vendorService.submitKyc(req.user.user_id, {
      companyName, gstNumber, city, address, lat, lng, companyLogo, kycData,
    });
    res.json(profile);
  } catch (error: any) {
    sendError(req, res, error, 'error');
  }
});

// Signed upload URL for one KYC document (the file goes straight to storage)
router.post('/kyc/upload-url', requireAuth, requireRole('vendor'), rateLimitByUser('vendor-kyc-upload', 60, 60 * 60), async (req: any, res: any) => {
  try {
    const { key, content_type, size } = req.body ?? {};
    res.json(await vendorService.createKycUploadUrl(req.user.user_id, { key, contentType: content_type, size }));
  } catch (error: any) {
    sendError(req, res, error, 'error');
  }
});

// Save the vendor's uploaded documents on their profile
router.put('/kyc/documents', requireAuth, requireRole('vendor'), async (req: any, res: any) => {
  try {
    const input = parseBody(KycDocumentsSchema, req.body);
    res.json(await vendorService.saveKycDocuments(req.user.user_id, input));
  } catch (error: any) {
    sendError(req, res, error, 'error');
  }
});

// The vendor's own invoices (issued when their load is delivered)
router.get('/invoices', requireAuth, requireRole('vendor'), async (req: any, res: any) => {
  try {
    const { data, error } = await supabase
      .from('invoices')
      .select('id, invoice_number, shipment_id, manifest_id, amount, gst_rate, gst_amount, total, status, issued_at, paid_at')
      .eq('vendor_id', req.user.user_id)
      .neq('status', 'void')
      .order('issued_at', { ascending: false });
    if (error) throw new Error(`Failed to list invoices: ${error.message}`);
    const rows = data ?? [];
    const ids = rows.map((r: any) => r.shipment_id).filter(Boolean);
    const { data: shipments } = ids.length
      ? await supabase.from('shipments').select('id, tracking_id').in('id', ids)
      : { data: [] as any[] };
    const tracking = new Map((shipments ?? []).map((s: any) => [s.id, s.tracking_id]));
    res.json(rows.map((r: any) => ({
      ...r,
      reference: r.shipment_id ? (tracking.get(r.shipment_id) ?? null) : `CM-${String(r.manifest_id).slice(0, 8).toUpperCase()}`,
    })));
  } catch (error: any) {
    sendError(req, res, error, 'error');
  }
});

// Create shipment request (Vendor)
router.post('/shipment-request', requireAuth, requireRole('vendor'), async (req: any, res: any) => {
  try {
    const { pickup, drop, capacity, metadata } = parseBody(ShipmentRequestSchema, req.body);
    const request = await vendorService.createShipmentRequest(req.user.user_id, pickup, drop, capacity, metadata);
    res.json(request);
  } catch (error: any) {
    sendError(req, res, error, 'error');
  }
});

// Requests that still need a decision or a vehicle (staff, managers included): the "Needs a vehicle" set
router.get('/shipment-request/pending', requireAuth, requireRole(...STAFF_ROLES), async (req: any, res: any) => {
  try {
    const requests = await vendorService.getPendingRequests();
    res.json(requests);
  } catch (error: any) {
    sendError(req, res, error, 'error');
  }
});

// Withdraw a load the vendor posted, while it has no vehicle yet
router.put('/shipment-request/:id/cancel', requireAuth, requireRole('vendor'), async (req: any, res: any) => {
  try {
    res.json(await vendorService.cancelRequest(req.user.user_id, req.params.id));
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

// Approve a vendor's KYC (Admin/Super Admin): tells the vendor and is audited
router.put('/kyc/:id/approve', requireAuth, requireRole('superadmin', 'admin'), async (req: any, res: any) => {
  try {
    const data = await vendorService.approveKyc(req.params.id, req.user);
    res.json({ success: true, data });
  } catch (error: any) {
    sendError(req, res, error, 'error');
  }
});

// Reject a vendor's KYC, storing why (Admin/Super Admin)
router.put('/kyc/:id/reject', requireAuth, requireRole('superadmin', 'admin'), async (req: any, res: any) => {
  try {
    const reason = parseRejectionReason(req.body?.reason);
    const data = await vendorService.rejectKyc(req.params.id, reason, req.user);
    res.json({ success: true, data });
  } catch (error: any) {
    sendError(req, res, error, 'error');
  }
});

// Assign vehicle to shipment request (Admin/Super Admin)
router.put('/shipment-request/:id/assign-vehicle', requireAuth, requireRole('superadmin', 'admin'), async (req: any, res: any) => {
  try {
    const { vehicle_id, cost, cost_per_km } = req.body ?? {};
    if (typeof vehicle_id !== 'string' || !vehicle_id) throw new HttpError(400, 'vehicle_id is required');
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
