import { Router } from 'express';
import { vendorService } from '../services/vendor.service';
import { listVendorLoads, vendorLoadDetail } from '../services/vendor-loads.service';
import { getCachedPaymentTermsDays } from '../services/company.service';
import { effectiveDueDate, overdueDays } from '../services/invoice-detail.service';
import { requireAuth, requireRole } from '../core/auth';
import { STAFF_ROLES } from '../core/ownership';
import { supabase } from '../core/supabase';
import { manifestParcelCode } from '../core/parcelCode';
import { HttpError, parseRejectionReason, sendError } from '../core/errors';
import { isUuid, parseUuid, uuidParam } from '../core/validate';
import { rateLimitByUser } from '../core/rate-limit';
import { idempotent } from '../core/idempotency';
import { BusinessProfileSchema, LoadDraftSchema, LoadsMineQuery } from '../schemas/loads';
import {
  bulkTemplateCsv, callerOf, createLoad, getPostedLoad, listMyLoads, repostDraft, runBulk,
} from '../services/loads/loads.service';
import { getBusinessProfile, saveBusinessProfile } from '../services/loads/business-profile.service';
import { acceptQuote, listVendorQuotes } from '../services/loads/order-routing';
import {
  KycDocumentsSchema, KycSubmitSchema, ShipmentRequestSchema, VendorLocationSchema, VendorProfileSchema,
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

// The basic profile (company name, city, whether a pickup point is set) of vendors the caller may deal with: the platform
// sees any; a company only vendors whose loads or bids it can see. Never PAN, bank details or KYC documents.
router.get('/basic', requireAuth, requireRole(...STAFF_ROLES), async (req: any, res: any) => {
  try {
    const raw = typeof req.query.ids === 'string' ? req.query.ids.split(',') : [];
    res.json(await vendorService.basicProfiles(raw.filter(isUuid).slice(0, 200)));
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
      .select('id, invoice_number, shipment_id, manifest_id, vendor_request_id, amount, gst_rate, gst_amount, total, status, issued_at, due_date, paid_at, payment_method, payment_reference')
      .eq('vendor_id', req.user.user_id)
      .neq('status', 'void')
      .order('issued_at', { ascending: false });
    if (error) throw new Error(`Failed to list invoices: ${error.message}`);
    const terms = await getCachedPaymentTermsDays();
    const now = new Date();
    const rows = (data ?? []).map((r: any) => {
      const due = effectiveDueDate(r, terms);
      const late = overdueDays(r, due, now);
      return { ...r, due_date: due, overdue: late > 0, days_overdue: late };
    });
    const ids = rows.map((r: any) => r.shipment_id).filter(Boolean);
    const { data: shipments } = ids.length
      ? await supabase.from('shipments').select('id, tracking_id').in('id', ids)
      : { data: [] as any[] };
    const tracking = new Map((shipments ?? []).map((s: any) => [s.id, s.tracking_id]));
    res.json(rows.map((r: any) => ({
      ...r,
      reference: r.shipment_id
        ? (tracking.get(r.shipment_id) ?? null)
        : r.manifest_id
          ? manifestParcelCode(String(r.manifest_id))
          : `REQ-${String(r.vendor_request_id).slice(0, 8).toUpperCase()}`,
    })));
  } catch (error: any) {
    sendError(req, res, error, 'error');
  }
});

// The vendor's own loads with stage, price, truck, invoice and open problems (the "My loads" board)
router.get('/loads', requireAuth, requireRole('vendor'), async (req: any, res: any) => {
  try {
    res.json(await listVendorLoads(req.user.user_id));
  } catch (error: any) {
    sendError(req, res, error, 'error');
  }
});

// ── Posting a load (docs/load-posting-design.md section 2) ──
// Route order matters: /loads/mine, /loads/template.csv and /loads/bulk are literal paths and sit before /loads/:id.

// Post a load: the server recomputes totals, tax and e-way need. Allowed before KYC approval (the load waits for verification).
router.post('/loads', requireAuth, requireRole('vendor'), rateLimitByUser('vendor-load-post', 60, 60 * 60), idempotent('vendor-load'), async (req: any, res: any) => {
  try {
    const input = parseBody(LoadDraftSchema, req.body);
    const out = await createLoad(callerOf(req), input);
    res.status(out.duplicate ? 200 : 201).json({
      id: out.load.id,
      load_number: out.load.load_number,
      status: out.load.status,
      duplicate: out.duplicate,
      status_note: out.status_note,
      load: out.load,
      items: out.items,
      assessment: out.assessment,
    });
  } catch (error: any) {
    sendError(req, res, error, 'error');
  }
});

// The vendor organisation's posted loads, newest first (paged: ?page=1&page_size=20&status=pending)
router.get('/loads/mine', requireAuth, requireRole('vendor'), async (req: any, res: any) => {
  try {
    const q = parseBody(LoadsMineQuery, req.query);
    res.json(await listMyLoads(callerOf(req), q.page, q.page_size, q.status));
  } catch (error: any) {
    sendError(req, res, error, 'error');
  }
});

// The CSV template for a bulk upload
router.get('/loads/template.csv', requireAuth, requireRole('vendor'), (_req: any, res: any) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="margix-bulk-loads-template.csv"');
  res.send(bulkTemplateCsv());
});

// Bulk upload: { file_name?, csv } with up to 50 rows, one load per row. Valid rows are posted, the report lists the errors.
router.post('/loads/bulk', requireAuth, requireRole('vendor'), rateLimitByUser('vendor-load-bulk', 10, 60 * 60), async (req: any, res: any) => {
  try {
    const { file_name, csv } = req.body ?? {};
    if (typeof csv !== 'string' || !csv.trim()) throw new HttpError(400, 'Send the file contents as csv text');
    if (csv.length > 500_000) throw new HttpError(400, 'The file is too large');
    const name = typeof file_name === 'string' ? file_name.slice(0, 200) : null;
    res.status(201).json(await runBulk(callerOf(req), name, csv));
  } catch (error: any) {
    sendError(req, res, error, 'error');
  }
});

// A posted load as a draft for the form (dates cleared). Creates nothing.
router.post('/loads/:id/repost', requireAuth, requireRole('vendor'), async (req: any, res: any) => {
  try {
    res.json({ draft: await repostDraft(callerOf(req), uuidParam(req.params.id, 'Load not found')) });
  } catch (error: any) {
    sendError(req, res, error, 'error');
  }
});

// The quotes on the vendor's load: company name and completed trips, amount, validity, ETA, notes (withdrawn ones are left out)
router.get('/loads/:id/quotes', requireAuth, requireRole('vendor'), async (req: any, res: any) => {
  try {
    res.json(await listVendorQuotes(callerOf(req), uuidParam(req.params.id, 'Load not found')));
  } catch (error: any) {
    sendError(req, res, error, 'error');
  }
});

// Pick a quote: awards the load to that company (atomic, only one award can happen), declines the other quotes
router.post('/loads/:id/quotes/:quoteId/accept', requireAuth, requireRole('vendor'), async (req: any, res: any) => {
  try {
    res.json(await acceptQuote(callerOf(req), uuidParam(req.params.id, 'Load not found'), uuidParam(req.params.quoteId, 'Quote not found')));
  } catch (error: any) {
    sendError(req, res, error, 'error');
  }
});

// One load. A posted load answers { ...board fields (vendor only), load, items }. A load the caller may not see (not their
// vendor organisation, not the carrier of its manifest, not a platform admin) is a 404. Return-trip space (a bid) keeps its old shape.
router.get('/loads/:id', requireAuth, requireRole('vendor', ...STAFF_ROLES), async (req: any, res: any) => {
  try {
    const id = uuidParam(req.params.id, 'Load not found');
    const caller = callerOf(req);
    const posted = await getPostedLoad(caller, id);
    if (!posted) {
      if (caller.role !== 'vendor') throw new HttpError(404, 'Load not found');
      res.json(await vendorLoadDetail(caller.userId, id));
      return;
    }
    let board: object = {};
    if (caller.role === 'vendor') {
      // getPostedLoad has checked organisation access, so a colleague in the same vendor business sees the poster's board too
      const poster = (posted.load as { vendor_id?: string | null }).vendor_id ?? caller.userId;
      try { board = await vendorLoadDetail(poster, id); } catch (e) { if (!(e instanceof HttpError) || e.status !== 404) throw e; }
    }
    res.json({ ...board, load: posted.load, items: posted.items });
  } catch (error: any) {
    sendError(req, res, error, 'error');
  }
});

// The vendor's business profile (name, GSTIN, address, email...) and whether it is complete
router.get('/business-profile', requireAuth, requireRole('vendor'), async (req: any, res: any) => {
  try {
    res.json(await getBusinessProfile(callerOf(req)));
  } catch (error: any) {
    sendError(req, res, error, 'error');
  }
});

router.put('/business-profile', requireAuth, requireRole('vendor'), async (req: any, res: any) => {
  try {
    res.json(await saveBusinessProfile(callerOf(req), parseBody(BusinessProfileSchema, req.body)));
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
    res.json(await vendorService.cancelRequest(req.user.user_id, uuidParam(req.params.id, 'Request not found')));
  } catch (error: any) {
    sendError(req, res, error, 'error');
  }
});

// Accept a load at a price (staff, managers included)
router.put('/shipment-request/:id/approve', requireAuth, requireRole(...STAFF_ROLES), async (req: any, res: any) => {
  try {
    const { cost, cost_per_km } = req.body ?? {};
    const request = await vendorService.approveRequest(uuidParam(req.params.id, 'Request not found'), cost, cost_per_km, req.user.user_id);
    res.json(request);
  } catch (error: any) {
    sendError(req, res, error, 'error');
  }
});

// Reject shipment request (Admin/Super Admin)
router.put('/shipment-request/:id/reject', requireAuth, requireRole(...STAFF_ROLES), async (req: any, res: any) => {
  try {
    const reason = parseRejectionReason(req.body?.reason);
    const request = await vendorService.rejectRequest(uuidParam(req.params.id, 'Request not found'), reason);
    res.json(request);
  } catch (error: any) {
    sendError(req, res, error, 'error');
  }
});

// Approve a vendor's KYC (platform only: the effective role is superadmin, i.e. acting as the platform): tells the vendor and is audited
router.put('/kyc/:id/approve', requireAuth, requireRole('superadmin'), async (req: any, res: any) => {
  try {
    const data = await vendorService.approveKyc(req.params.id, req.user);
    res.json({ success: true, data });
  } catch (error: any) {
    sendError(req, res, error, 'error');
  }
});

// Reject a vendor's KYC, storing why (platform only)
router.put('/kyc/:id/reject', requireAuth, requireRole('superadmin'), async (req: any, res: any) => {
  try {
    const reason = parseRejectionReason(req.body?.reason);
    const data = await vendorService.rejectKyc(req.params.id, reason, req.user);
    res.json({ success: true, data });
  } catch (error: any) {
    sendError(req, res, error, 'error');
  }
});

// Set a vendor's pickup location for them (Admin/Super Admin), e.g. when a bid can't be awarded without one
router.put('/:id/location', requireAuth, requireRole('superadmin', 'admin'), async (req: any, res: any) => {
  try {
    const input = parseBody(VendorLocationSchema, req.body);
    res.json(await vendorService.setLocation(req.params.id, input, req.user));
  } catch (error: any) {
    sendError(req, res, error, 'error');
  }
});

// Assign vehicle to shipment request (Admin/Super Admin)
router.put('/shipment-request/:id/assign-vehicle', requireAuth, requireRole(...STAFF_ROLES), async (req: any, res: any) => {
  try {
    const { vehicle_id, cost, cost_per_km } = req.body ?? {};
    if (typeof vehicle_id !== 'string' || !vehicle_id) throw new HttpError(400, 'vehicle_id is required');
    parseUuid(vehicle_id, 'vehicle_id');
    const request = await vendorService.assignVehicleToRequest(uuidParam(req.params.id, 'Request not found'), vehicle_id, cost, cost_per_km);
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
