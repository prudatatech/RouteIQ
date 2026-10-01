import { supabase } from '../core/supabase';
import { withWarnings } from './people-common';
import { checkIfscForSave } from './ifsc.service';
import crypto from 'crypto';
import { settings } from '../core/config';
import { notificationService } from './notification.service';
import { auditService, type AuditActor } from './audit.service';
import { HttpError } from '../core/errors';
import { formatINR, formatKg } from '../core/format';
import { pricingService } from './pricing.service';
import { gstinError, normalizeGstin } from '../utils/gstin';
import { OPERATING_VEHICLE_STATUSES } from '../core/transitions';
import { isDispatchable } from '../core/vehicles';
import { roadKm, toPoint, travelMinutes } from '../utils/eta';

/** GSTIN is optional for vendors; when given it must be valid. Returns it cleaned up, or ''. */
function cleanVendorGstin(raw: unknown): string {
  const gstin = normalizeGstin(raw);
  if (!gstin) return '';
  const problem = gstinError(gstin);
  if (problem) throw new HttpError(400, problem);
  return gstin;
}
import { assertOwnDocumentPaths } from '../schemas/vendor';

/** Formats a KYC document may be uploaded in, and the extension each is stored under. */
const KYC_UPLOAD_CONTENT_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

/** Request states an admin can still act on (approve, reject or assign a vehicle). */
const OPEN_REQUEST_STATUSES = ['pending', 'approved'];

/** Steps of a vendor's load the vendor is told about. */
export type LoadEvent = 'picked_up' | 'in_transit' | 'delivered';
const LOAD_EVENT_TYPES: Record<LoadEvent, string> = {
  picked_up: 'load_picked_up',
  in_transit: 'load_in_transit',
  delivered: 'request_completed',
};
const LOAD_EVENT_LABELS: Record<LoadEvent, { title: string; body: string }> = {
  picked_up: { title: 'Your load was picked up', body: 'was picked up' },
  in_transit: { title: 'Your load is on its way', body: 'is on its way' },
  delivered: { title: 'Your load was delivered', body: 'was delivered' },
};
const shortPlace = (p: string | null | undefined) => (p ?? '').split(',')[0].trim() || 'pickup';

/** How long a passing truck stays on offer to a vendor. */
const PASSING_ROUTE_TTL_HOURS = 6;

/** Requests still waiting for a vehicle: the open ones plus those out with 3PL partners. */
export const NEEDS_VEHICLE_STATUSES = ['pending', 'approved', 'escalated'];

/**
 * Moves a request to `status` only if it is currently in one of `from`. The
 * conditional update is atomic per row, so two admins acting at once (or a
 * double click) cannot both succeed. Throws 404/409 when nothing was updated.
 */
async function transitionRequest(requestId: string, from: string[], update: Record<string, unknown>) {
  const { data, error } = await supabase
    .from('vendor_shipment_requests')
    .update({ ...update, updated_at: new Date().toISOString() })
    .eq('id', requestId)
    .in('status', from)
    .select()
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    const { data: existing } = await supabase.from('vendor_shipment_requests').select('status').eq('id', requestId).maybeSingle();
    if (!existing) throw new HttpError(404, 'Request not found');
    throw new HttpError(409, `Request is already ${existing.status}`);
  }
  return data;
}

/** Legal identity columns this service writes; changing one on an approved profile needs a new KYC review. */
const VENDOR_IDENTITY_FIELDS = ['company_name', 'gst_number', 'address'] as const;

/**
 * Checks the IFSC the wizard carries and records the branch inside the KYC data
 * (`bank.ifsc_details`). An unknown IFSC is a 400; a lookup that is down only warns.
 */
async function withVerifiedBank(kycData: unknown): Promise<{ kycData: unknown; warnings: string[] }> {
  const root = (kycData ?? {}) as Record<string, any>;
  const form = (root.data ?? {}) as Record<string, any>;
  if (typeof form.bankIfscCode !== 'string' || !form.bankIfscCode.trim()) return { kycData, warnings: [] };
  const check = await checkIfscForSave(form.bankIfscCode);
  const d = check.details;
  return {
    warnings: check.warnings,
    kycData: {
      ...root,
      data: { ...form, bankIfscCode: form.bankIfscCode.trim().toUpperCase(), ...(d ? { bankName: d.bank ?? form.bankName, bankBranchName: d.branch ?? form.bankBranchName } : {}) },
      bank: { ifsc_details: d, ifsc_verified_at: check.verifiedAt, bank_name: d?.bank ?? null, branch: d?.branch ?? null },
    },
  };
}

export const vendorService = {
  /**
   * Save or update a vendor's own profile. Changing a legal identity field on
   * an approved profile sends it back to KYC review, as the database field
   * guard does for direct client edits (20260929000100).
   */
  async upsertProfile(vendorId: string, companyName: string, gstNumber: string, city: string, address: string, lat: number, lng: number) {
    gstNumber = cleanVendorGstin(gstNumber);
    const changes: Record<string, unknown> = {
      id: vendorId,
      company_name: companyName,
      gst_number: gstNumber,
      city: city,
      address: address,
      latitude: lat,
      longitude: lng,
      updated_at: new Date().toISOString()
    };

    const { data: current, error: currentErr } = await supabase
      .from('vendor_profiles')
      .select(['kyc_status', ...VENDOR_IDENTITY_FIELDS].join(', '))
      .eq('id', vendorId)
      .maybeSingle();
    if (currentErr) throw new Error(currentErr.message);
    const existing = current as Record<string, unknown> | null;
    if (existing?.kyc_status === 'approved'
        && VENDOR_IDENTITY_FIELDS.some(f => (changes[f] ?? null) !== (existing[f] ?? null))) {
      Object.assign(changes, { kyc_status: 'submitted', kyc_reviewed_at: null, kyc_reviewed_by: null });
    }

    const { data, error } = await supabase.from('vendor_profiles').upsert(changes).select().single();

    if (error) throw new Error(error.message);

    // Tell superadmins (the only role with the KYC page) whenever this save is what sent the profile to KYC review (D2).
    // A notification failure must not undo the profile save.
    if (data?.kyc_status === 'submitted' && existing?.kyc_status !== 'submitted') {
      try {
        await notificationService.notifySuperAdmins(
          'KYC submitted',
          `${companyName} submitted KYC details for review.`,
          'kyc_submitted',
          { profile_id: vendorId },
        );
      } catch (e) {
        console.error('[vendor] KYC notification failed:', e);
      }
    }

    return data;
  },

  /**
   * Staff set the pickup point of a vendor who has none, so a won bid can be routed to them.
   * Only the point (and city) change: the company details are the vendor's own and stay under KYC.
   */
  async setLocation(vendorId: string, input: { lat: number; lng: number; city?: string }, actor: AuditActor) {
    const changes: Record<string, unknown> = { latitude: input.lat, longitude: input.lng, updated_at: new Date().toISOString() };
    if (input.city) changes.city = input.city;
    const { data, error } = await supabase
      .from('vendor_profiles').update(changes).eq('id', vendorId).select('id, company_name, city, latitude, longitude').maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new HttpError(404, 'Vendor not found');
    await auditService.record('staff-console', actor, 'vendor_location_set', { vendor_id: vendorId, lat: input.lat, lng: input.lng });
    return data;
  },

  /**
   * Submit (or resubmit) the vendor's full KYC wizard: company, contact,
   * bank and document details, plus the wizard's own draft blob (`kycData`).
   * Always moves the profile to `kyc_status: 'submitted'` and notifies superadmins
   * (the KYC page is superadmin-only) so this is the one path that should be used for a KYC submission —
   * never a direct Supabase write from the client, which would skip the
   * notification.
   */
  async submitKyc(vendorId: string, payload: {
    companyName: string;
    gstNumber: string;
    city: string;
    address: string;
    lat: number;
    lng: number;
    companyLogo?: string | null;
    kycData: unknown;
  }) {
    payload = { ...payload, gstNumber: cleanVendorGstin(payload.gstNumber) };
    const { kycData, warnings } = await withVerifiedBank(payload.kycData);
    payload = { ...payload, kycData };
    const { data: existing, error: currentErr } = await supabase
      .from('vendor_profiles')
      .select('kyc_status')
      .eq('id', vendorId)
      .maybeSingle();
    if (currentErr) throw new Error(currentErr.message);

    const changes = {
      id: vendorId,
      company_name: payload.companyName,
      gst_number: payload.gstNumber || '',
      city: payload.city,
      address: payload.address,
      latitude: payload.lat,
      longitude: payload.lng,
      company_logo: payload.companyLogo ?? null,
      kyc_data: payload.kycData,
      kyc_status: 'submitted',
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase.from('vendor_profiles').upsert(changes).select().single();
    if (error) throw new Error(error.message);

    // A notification failure must not undo the profile save.
    if (existing?.kyc_status !== 'submitted') {
      try {
        await notificationService.notifySuperAdmins(
          'KYC submitted',
          `${payload.companyName} submitted KYC details for review.`,
          'kyc_submitted',
          { profile_id: vendorId },
        );
      } catch (e) {
        console.error('[vendor] KYC notification failed:', e);
      }
    }

    return withWarnings(data, warnings);
  },

  /**
   * Fetch a vendor profile
   */
  async getProfile(vendorId: string) {
    const { data, error } = await supabase.from('vendor_profiles').select('*').eq('id', vendorId).single();
    if (error && error.code !== 'PGRST116') throw new Error(error.message);
    return data;
  },

  /**
   * Vendor creates a custom shipment request
   */
  async createShipmentRequest(
    vendorId: string,
    pickup: { address: string; lat: number; lng: number },
    drop: { address: string; lat: number; lng: number },
    capacity: number,
    metadata: Record<string, any> = {},
  ) {
    // Posting loads needs an approved KYC, the same rule as bidding
    const { data: profile, error: profileErr } = await supabase.from('vendor_profiles').select('kyc_status').eq('id', vendorId).maybeSingle();
    if (profileErr) throw new Error(profileErr.message);
    if (profile?.kyc_status !== 'approved') {
      throw new HttpError(403, 'Complete KYC verification before posting a load');
    }

    // 1. Calculate ETA and Distance
    const distanceKm = roadKm(pickup, drop) ?? 0;

    // Assume average speed of 40km/h for trucks
    const drivingHours = distanceKm / 40;
    
    // Add 20% buffer for halts/rests + 2 hours loading/unloading
    const totalHours = (drivingHours * 1.2) + 2;
    
    const isLongHaul = distanceKm > 500 || totalHours > 12; // Anomaly threshold

    const dispatchDate = new Date(); // Dispatching today/now
    const reportingDate = new Date();
    reportingDate.setHours(reportingDate.getHours() + Math.ceil(totalHours));

    // Enrich metadata with ETA and Consignor/Transporter rules
    const enrichedMetadata: Record<string, any> = {
      ...metadata,
      transporter: "Route IQ",
      consignor_id: vendorId, // We'll assume the client fetches actual vendor name if needed
      routing: {
        estimated_distance_km: Math.round(distanceKm),
        estimated_driving_hours: drivingHours.toFixed(1),
        total_estimated_hours: totalHours.toFixed(1),
        is_long_haul: isLongHaul,
        dispatch_date: dispatchDate.toISOString(),
        reporting_date: reportingDate.toISOString()
      },
      alerts: isLongHaul ? ['Requires Fuel Up Check', 'Strict Anomaly Monitoring'] : []
    };

    const { data, error } = await supabase.from('vendor_shipment_requests').insert({
      vendor_id: vendorId,
      pickup_location: pickup.address,
      pickup_lat: pickup.lat,
      pickup_lng: pickup.lng,
      drop_location: drop.address,
      drop_lat: drop.lat,
      drop_lng: drop.lng,
      required_capacity_kg: capacity,
      status: 'pending',
      metadata: enrichedMetadata
    }).select().single();

    if (error) throw new Error(error.message);

    // Notify every active admin/superadmin, not just superadmins (D2)
    await notificationService.notifyStaff(
      'New vendor load',
      `A vendor posted a ${formatKg(capacity)} load (${enrichedMetadata.cargo?.category || 'General'}) from ${pickup.address} to ${drop.address}. ETA: ${totalHours.toFixed(1)} hrs.`,
      'vendor_request',
      { request_id: data.id }
    );

    return data;
  },

  /**
   * Requests that still need a decision or a vehicle: the same set as the
   * "Needs a vehicle" tab (pending, approved and escalated), so the badge and
   * the dashboard count match the list.
   */
  async getPendingRequests() {
    const { data: requests, error } = await supabase.from('vendor_shipment_requests').select('*').in('status', NEEDS_VEHICLE_STATUSES).order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    
    if (!requests || requests.length === 0) return [];
    
    const vendorIds = [...new Set(requests.map(r => r.vendor_id))];
    const { data: profiles, error: profError } = await supabase
      .from('vendor_profiles')
      .select('id, company_name')
      .in('id', vendorIds);
      
    if (profError) throw new Error(profError.message);
    
    const profileMap = profiles.reduce((acc: any, p: any) => {
      acc[p.id] = p;
      return acc;
    }, {});
    
    return requests.map(r => ({
      ...r,
      vendor_profiles: profileMap[r.vendor_id] || null
    }));
  },

  /**
   * Staff accept a vendor's load at a price. The price is required (a flat amount, or a rate per km that
   * is turned into an amount on the road distance) unless the request already carries one. A vehicle can
   * be assigned only after this.
   */
  async approveRequest(requestId: string, cost?: number | null, costPerKm?: number | null) {
    for (const [label, amount] of [['Price', cost], ['Rate per km', costPerKm]] as const) {
      if (amount !== undefined && amount !== null && (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > 10_000_000)) {
        throw new HttpError(400, `${label} must be a number between 0 and 10,000,000`);
      }
    }
    const { data: before, error: beforeErr } = await supabase
      .from('vendor_shipment_requests')
      .select('status, cost, pickup_lat, pickup_lng, drop_lat, drop_lng')
      .eq('id', requestId).maybeSingle();
    if (beforeErr) throw new Error(beforeErr.message);
    if (!before) throw new HttpError(404, 'Request not found');

    const ratePerKm = costPerKm && costPerKm > 0 ? costPerKm : undefined;
    let agreed: number | undefined = cost && cost > 0 ? cost : undefined;
    if (agreed === undefined && ratePerKm !== undefined) {
      const km = roadKm(toPoint(before.pickup_lat, before.pickup_lng), toPoint(before.drop_lat, before.drop_lng));
      if (km === null || km <= 0) throw new HttpError(400, "This load has no usable pickup and drop-off coordinates, so a rate per km can't be turned into a price. Enter a flat price.");
      agreed = Math.round(ratePerKm * km * 100) / 100;
    }
    const existing = Number(before.cost);
    const price = agreed ?? (Number.isFinite(existing) && existing > 0 ? existing : undefined);
    if (price === undefined) throw new HttpError(400, 'Enter a price (a flat amount, or a rate per km) to accept this load.');

    const data = await transitionRequest(requestId, ['pending'], {
      status: 'approved',
      cost: price,
      ...(ratePerKm !== undefined ? { cost_per_km: ratePerKm } : {}),
    });

    // Notify the vendor
    await notificationService.sendNotification(
      data.vendor_id,
      'Load accepted',
      `Accepted at ${formatINR(price)}. We'll assign a truck next.`,
      'request_approved',
      { request_id: data.id, cost: price }
    );

    return data;
  },

  /**
   * Super admin rejects a vendor shipment request
   */
  async rejectRequest(requestId: string, reason: string) {
    const data = await transitionRequest(requestId, OPEN_REQUEST_STATUSES, { status: 'rejected', rejection_reason: reason });

    // Notify the vendor
    await notificationService.sendNotification(
      data.vendor_id,
      'Load rejected',
      `Your load from ${data.pickup_location} was rejected. Reason: ${reason}`,
      'request_rejected',
      { request_id: data.id }
    );

    return data;
  },

  /**
   * A vendor withdraws a load they posted, while no vehicle has been assigned
   * yet (pending or approved). Only the vendor's own request can be cancelled;
   * staff are told so nobody keeps looking for a vehicle for it.
   */
  async cancelRequest(vendorId: string, requestId: string) {
    const { data: existing, error: loadErr } = await supabase
      .from('vendor_shipment_requests').select('id, vendor_id, status, pickup_location, drop_location').eq('id', requestId).maybeSingle();
    if (loadErr) throw new Error(loadErr.message);
    // Someone else's request looks the same as a missing one
    if (!existing || existing.vendor_id !== vendorId) throw new HttpError(404, 'Request not found');
    if (!OPEN_REQUEST_STATUSES.includes(String(existing.status))) {
      const why = existing.status === 'escalated'
        ? 'It is with 3PL partners right now. Contact support to cancel it.'
        : `It is already ${String(existing.status).replace(/_/g, ' ')}.`;
      throw new HttpError(409, `This load can no longer be cancelled. ${why}`);
    }
    const data = await transitionRequest(requestId, OPEN_REQUEST_STATUSES, { status: 'cancelled' });
    try {
      await notificationService.notifyStaff(
        'Vendor cancelled a load',
        `The vendor cancelled the load from ${data.pickup_location} to ${data.drop_location}.`,
        'vendor_request_cancelled',
        { request_id: data.id },
      );
    } catch (e) {
      console.error('[vendor] Cancellation notification failed:', e);
    }
    return data;
  },

  /**
   * Tells the vendor about a step of their load: `picked_up`, `in_transit` or `delivered`.
   * Takes the cargo manifest of an assigned load; a manifest that came from a
   * won capacity bid (no vendor request) tells the bidder instead. Never throws:
   * a missed notification must not fail the driver's action. Safe to call twice
   * for the same step (the second call sends nothing).
   */
  async notifyVendorLoadEvent(manifestId: string, event: LoadEvent): Promise<void> {
    try {
      const { data: manifest } = await supabase
        .from('cargo_manifest').select('id, vendor_request_id, pickup_location, drop_location').eq('id', manifestId).maybeSingle();
      if (!manifest?.vendor_request_id) return;
      await this.notifyVendorRequestEvent(manifest.vendor_request_id, event, manifest.pickup_location, manifest.drop_location);
    } catch (e) {
      console.error(`[vendor] Load event ${event} for manifest ${manifestId} failed:`, e);
    }
  },

  /** Same as notifyVendorLoadEvent, for a request id (used for loads a 3PL partner carries). */
  async notifyVendorRequestEvent(requestId: string, event: LoadEvent, pickup?: string | null, drop?: string | null, by?: string): Promise<void> {
    try {
      const { data: request } = await supabase
        .from('vendor_shipment_requests').select('id, vendor_id, pickup_location, drop_location').eq('id', requestId).maybeSingle();
      if (!request?.vendor_id) return;
      const type = LOAD_EVENT_TYPES[event];
      const { data: already } = await supabase
        .from('notifications').select('id, data').eq('user_id', request.vendor_id).eq('type', type).limit(50);
      const sent = (already ?? []).some((n: any) => n.data?.request_id === requestId);
      if (sent) return;
      const route = `${shortPlace(pickup ?? request.pickup_location)} to ${shortPlace(drop ?? request.drop_location)}`;
      const label = LOAD_EVENT_LABELS[event];
      await notificationService.sendNotification(
        request.vendor_id,
        label.title,
        `Your load from ${route} ${label.body}${by ? ` (${by})` : ''}.`,
        type,
        { request_id: requestId },
      );
    } catch (e) {
      console.error(`[vendor] Load event ${event} for request ${requestId} failed:`, e);
    }
  },

  /**
   * Staff approves a vendor's KYC. Only a submission still waiting for review
   * can be decided, so a vendor who edits mid-review (or a second reviewer)
   * is not overwritten. Tells the vendor and leaves an audit entry.
   */
  async approveKyc(vendorId: string, actor: AuditActor) {
    const { data, error } = await supabase
      .from('vendor_profiles')
      .update({
        kyc_status: 'approved',
        kyc_rejection_reason: null,
        kyc_reviewed_at: new Date().toISOString(),
        kyc_reviewed_by: actor.user_id,
      })
      .eq('id', vendorId)
      .eq('kyc_status', 'submitted')
      .select('id, company_name')
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) {
      const { data: existing } = await supabase.from('vendor_profiles').select('id').eq('id', vendorId).maybeSingle();
      if (!existing) throw new HttpError(404, 'Vendor not found');
      throw new HttpError(409, 'This KYC is no longer waiting for review');
    }

    // The decision stands even if telling the vendor fails
    try {
      await notificationService.sendNotification(
        vendorId,
        'KYC approved',
        'Your KYC was approved. You can now bid for space and post loads.',
        'kyc_approved',
        { vendor_id: vendorId },
      );
    } catch (e) {
      console.error('[vendor] KYC approval notification failed:', e);
    }
    await auditService.record('staff-console', actor, 'kyc_approved', { vendor_id: vendorId, company_name: data.company_name });
    return data;
  },

  /**
   * Staff rejects a vendor's KYC, storing why. Only a submission still
   * waiting for review can be decided, so a vendor who edits mid-review (or
   * a second reviewer) is not overwritten.
   */
  async rejectKyc(vendorId: string, reason: string, actor?: AuditActor) {
    const { data, error } = await supabase
      .from('vendor_profiles')
      .update({
        kyc_status: 'rejected',
        kyc_rejection_reason: reason,
        kyc_reviewed_at: new Date().toISOString(),
        ...(actor ? { kyc_reviewed_by: actor.user_id } : {}),
      })
      .eq('id', vendorId)
      .eq('kyc_status', 'submitted')
      .select('id, company_name')
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new HttpError(409, 'This KYC is no longer waiting for review');

    await notificationService.sendNotification(
      vendorId,
      'KYC rejected',
      `Your KYC was not approved. Reason: ${reason}`,
      'kyc_rejected',
      { vendor_id: vendorId }
    );
    if (actor) {
      await auditService.record('staff-console', actor, 'kyc_rejected', { vendor_id: vendorId, company_name: data.company_name, reason });
    }

    return data;
  },

  /**
   * Signed upload URL for one KYC document, at a path chosen here inside the
   * vendor's own folder. The bucket only accepts PDF, JPG and PNG; the size is
   * checked here before the URL is issued.
   */
  async createKycUploadUrl(vendorId: string, input: { key: unknown; contentType: unknown; size: unknown }) {
    const { key, contentType, size } = input;
    if (typeof key !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(key)) {
      throw new HttpError(400, 'Choose which document this is before uploading');
    }
    const extension = typeof contentType === 'string' ? KYC_UPLOAD_CONTENT_TYPES[contentType.toLowerCase()] : undefined;
    if (!extension) throw new HttpError(415, 'Upload a PDF, JPG or PNG file');
    const bytes = Number(size);
    if (!Number.isInteger(bytes) || bytes <= 0) throw new HttpError(400, 'File size is required');
    if (bytes > settings.TPL_UPLOAD_MAX_BYTES) {
      throw new HttpError(413, `File must be at most ${Math.floor(settings.TPL_UPLOAD_MAX_BYTES / 1024 / 1024 * 10) / 10} MB`);
    }
    const path = `${vendorId}/${key}_${crypto.randomUUID()}.${extension}`;
    const { data, error } = await supabase.storage.from(settings.KYC_DOCUMENTS_BUCKET).createSignedUploadUrl(path);
    if (error || !data) throw new Error(`Failed to create upload URL: ${error?.message}`);
    return { path: data.path, token: data.token, signed_url: data.signedUrl };
  },

  /**
   * Save the vendor's uploaded KYC documents on their profile before they
   * submit the form. Changing the documents of an approved profile sends it
   * back to review (as any change to its legal identity does) and tells staff.
   */
  async saveKycDocuments(
    vendorId: string,
    input: { docUrls?: Record<string, string>; otherDocs?: { name: string; path: string }[] },
  ) {
    assertOwnDocumentPaths(vendorId, input.docUrls, input.otherDocs);

    const { data: profile, error: loadErr } = await supabase
      .from('vendor_profiles')
      .select('company_name, kyc_status, kyc_data')
      .eq('id', vendorId)
      .maybeSingle();
    if (loadErr) throw new Error(loadErr.message);
    if (!profile) throw new HttpError(404, 'Set up your company profile first');

    const current = (profile.kyc_data ?? {}) as { data?: Record<string, unknown>; otherDocs?: unknown[] } & Record<string, unknown>;
    const kycData = {
      ...current,
      data: { ...(current.data ?? {}), ...(input.docUrls !== undefined ? { docUrls: input.docUrls } : {}) },
      otherDocs: input.otherDocs ?? current.otherDocs ?? [],
    };
    const changes: Record<string, unknown> = { kyc_data: kycData, updated_at: new Date().toISOString() };
    const backToReview = profile.kyc_status === 'approved';
    if (backToReview) Object.assign(changes, { kyc_status: 'submitted', kyc_reviewed_at: null, kyc_reviewed_by: null });

    const { data, error } = await supabase
      .from('vendor_profiles')
      .update(changes)
      .eq('id', vendorId)
      .select()
      .single();
    if (error) throw new Error(error.message);

    if (backToReview) {
      try {
        await notificationService.notifySuperAdmins(
          'KYC submitted',
          `${profile.company_name} changed its KYC documents and needs a new review.`,
          'kyc_submitted',
          { profile_id: vendorId },
        );
      } catch (e) {
        console.error('[vendor] KYC notification failed:', e);
      }
    }
    return data;
  },

  /**
   * Admin assigns a vehicle to a vendor request and creates a cargo manifest entry.
   * The vehicle must be in an operating status and have the free capacity the load needs.
   * A price per km alone becomes a total (rate x road distance) when the distance is known.
   */
  async assignVehicleToRequest(requestId: string, vehicleId: string, cost?: number | null, costPerKm?: number | null) {
    for (const [label, amount] of [['Cost', cost], ['Cost per km', costPerKm]] as const) {
      if (amount !== undefined && amount !== null && (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > 10_000_000)) {
        throw new HttpError(400, `${label} must be a number between 0 and 10,000,000`);
      }
    }
    const flatPrice = cost ?? undefined;
    const ratePerKm = costPerKm ?? undefined;

    const { data: assignee, error: assigneeErr } = await supabase
      .from('vehicles').select('id, status, plate_number, capacity_kg, current_load_kg, available_capacity_kg, driver_id').eq('id', vehicleId).maybeSingle();
    if (assigneeErr) throw new Error(assigneeErr.message);
    if (!assignee) throw new HttpError(404, 'Vehicle not found');
    if (!assignee.driver_id) throw new HttpError(409, `${assignee.plate_number ?? 'This vehicle'} has no driver. Give it a driver before assigning a load.`);
    if (!isDispatchable(assignee)) {
      throw new HttpError(409, `This vehicle is ${assignee.status === 'maintenance' || assignee.status === 'archived' ? `in ${assignee.status}` : 'not ready for dispatch'} and can't take a load`);
    }

    const { data: before, error: beforeErr } = await supabase
      .from('vendor_shipment_requests')
      .select('status, required_capacity_kg, pickup_lat, pickup_lng, drop_lat, drop_lng')
      .eq('id', requestId).maybeSingle();
    if (beforeErr) throw new Error(beforeErr.message);
    if (!before) throw new HttpError(404, 'Request not found');
    if (before.status === 'pending') throw new HttpError(409, 'Accept the request with a price first. A vehicle can be assigned after that.');

    // Free capacity: what the vehicle reports, else its rated capacity less what it already carries
    const required = Number(before.required_capacity_kg) || 0;
    const rated = Number(assignee.capacity_kg);
    const free = assignee.available_capacity_kg != null
      ? Number(assignee.available_capacity_kg)
      : Number.isFinite(rated) && rated > 0 ? rated - (Number(assignee.current_load_kg) || 0) : null;
    if (free !== null && required > free) {
      throw new HttpError(409, `This vehicle has ${Math.max(0, Math.round(free)).toLocaleString('en-IN')} kg free and the load needs ${required.toLocaleString('en-IN')} kg`);
    }

    // The agreed amount: a flat price wins; a rate per km needs the distance to become an amount
    const km = roadKm(
      toPoint(before.pickup_lat, before.pickup_lng),
      toPoint(before.drop_lat, before.drop_lng),
    );
    let agreed = flatPrice;
    if (agreed === undefined && ratePerKm !== undefined && ratePerKm > 0) {
      if (km === null || km <= 0) throw new HttpError(400, "This load has no usable pickup and drop-off coordinates, so a rate per km can't be turned into an amount. Enter a flat price.");
      agreed = Math.round(ratePerKm * km * 100) / 100;
    }

    // Claim the request for this vehicle; fails if it was already assigned or closed
    const req = await transitionRequest(requestId, OPEN_REQUEST_STATUSES, {
      status: 'assigned',
      assigned_vehicle_id: vehicleId,
      ...(agreed !== undefined ? { cost: agreed } : {}),
      ...(ratePerKm !== undefined ? { cost_per_km: ratePerKm } : {})
    });

    // Tell the pricing engine which price was agreed, so later quotes can learn from it
    const quoteId = (req.metadata as Record<string, unknown> | null)?.quote_id;
    if (typeof quoteId === 'string' && typeof agreed === 'number' && agreed > 0) {
      await pricingService.recordOutcome(quoteId, { accepted_amount: agreed, request_id: requestId });
    }

    // Insert into cargo_manifest
    const { error: manifestErr } = await supabase.from('cargo_manifest').insert({
      vehicle_id: vehicleId,
      vendor_request_id: requestId,
      pickup_location: req.pickup_location,
      pickup_lat: req.pickup_lat,
      pickup_lng: req.pickup_lng,
      drop_location: req.drop_location,
      drop_lat: req.drop_lat,
      drop_lng: req.drop_lng,
      capacity_kg: req.required_capacity_kg,
      status: 'scheduled',
      created_at: new Date().toISOString()
    });

    if (manifestErr) {
      console.error('Failed to create cargo_manifest:', manifestErr);
      // Release the claim so the request can be assigned again
      await supabase.from('vendor_shipment_requests')
        .update({ status: before.status, assigned_vehicle_id: null, updated_at: new Date().toISOString() })
        .eq('id', requestId)
        .eq('status', 'assigned');
      throw new Error(`Failed to create manifest: ${manifestErr.message}`);
    }

    // The load now sits on the vehicle. A vendor load has no trip to hold back in Dispatch, so
    // assigning it always sends it: the vehicle goes on the road (only from an operating status,
    // checked above, so a vehicle that went into maintenance meanwhile is left alone) and the driver is told.
    const newLoad = (Number(assignee.current_load_kg) || 0) + required;
    const newAvail = Math.max(0, (free ?? 0) - required);
    await supabase.from('vehicles').update({
      current_load_kg: newLoad,
      available_capacity_kg: newAvail,
      status: 'on_route',
    }).eq('id', vehicleId).in('status', [...OPERATING_VEHICLE_STATUSES]);

    if (assignee.driver_id) {
      // Notify the driver instantly so the listener triggers
      await notificationService.sendNotification(
        assignee.driver_id,
        'New pickup assigned',
        `A new pickup has been scheduled at ${req.pickup_location}.`,
        'cargo_assigned',
        { request_id: requestId, vehicle_id: vehicleId }
      );
    }

    // Notify the vendor, with the price that was agreed
    await notificationService.sendNotification(
      req.vendor_id,
      'Vehicle assigned',
      `A vehicle has been assigned to your load from ${req.pickup_location}.${agreed !== undefined && agreed > 0 ? ` Agreed price: ${formatINR(agreed)}.` : ''}`,
      'vehicle_assigned',
      { request_id: requestId, vehicle_id: vehicleId, ...(agreed !== undefined ? { cost: agreed } : {}) }
    );

    return { success: true, cost: agreed ?? null };
  },

  /**
   * Match a newly created route to nearby vendors
   */
  async matchRouteToVendors(routeId: string, vehicleId: string, originLat: number, originLng: number, destLat: number | null, destLng: number | null) {
    try {
      // With no known destination the truck is matched on where it is now
      let sampledPoints: { lat: number; lng: number }[] = [{ lat: originLat, lng: originLng }];
      if (destLat != null && destLng != null) {
        const { mapsService } = await import('./maps.service');
        const polylineEncoded = await mapsService.getRoutePolyline(originLat, originLng, destLat, destLng);
        if (!polylineEncoded) return;
        sampledPoints = mapsService.samplePolylinePoints(polylineEncoded, 15);
      }

      const { data, error } = await supabase.rpc('match_vendors_to_route', {
        route_points: sampledPoints,
        radius_km: 50.0
      });
      
      if (error || !data || data.length === 0) return;
      
      const { data: vehicleData } = await supabase.from('vehicles').select('vehicle_type, capacity_kg, available_capacity_kg').eq('id', vehicleId).single();
      // Vendors are not told which vehicle it is (plate) until they win capacity on it
      const vehicleDesc = vehicleData?.vehicle_type ? `A ${vehicleData.vehicle_type}` : 'A truck';

      // Time for the truck to reach each vendor, from its position now
      const { data: vendorPlaces } = await supabase
        .from('vendor_profiles').select('id, latitude, longitude').in('id', data.map((m: any) => m.vendor_id));
      const placeOf = new Map((vendorPlaces ?? []).map((v: any) => [v.id, v]));
      const truck = { lat: originLat, lng: originLng };

      // Notify matched vendors
      for (const match of data) {
        const place: any = placeOf.get(match.vendor_id);
        const eta = travelMinutes(truck, toPoint(place?.latitude, place?.longitude));
        // Insert opportunity
        await supabase.from('vendor_route_opportunities').upsert({
          route_id: routeId,
          vendor_id: match.vendor_id,
          eta_minutes: eta,
          status: 'notified',
          available_capacity_kg: vehicleData?.available_capacity_kg ?? vehicleData?.capacity_kg ?? 0
        }, { onConflict: 'route_id, vendor_id' });

        await notificationService.sendNotification(
          match.vendor_id,
          'Space passing your way',
          `${vehicleDesc} is passing within ${Math.round(match.min_distance_km)} km of you. Want to send something?`,
          'passing_route',
          { route_id: routeId }
        );
      }
    } catch (err: any) {
      console.error('Failed to match vendors to route:', err.message);
    }
  },

  /**
   * Get current market rates — aggregated from recent shipments
   */
  async getMarketRates() {
    // Average over recent priced loads: assigned ones and delivered ones (a delivery writes `completed`)
    // The recent loads and the fleet count do not depend on each other: one round trip
    const [{ data: recent }, { count: fleetCount }] = await Promise.all([
      supabase
        .from('vendor_shipment_requests')
        .select('cost, cost_per_km, required_capacity_kg')
        .in('status', ['assigned', 'assigned_to_partner', 'completed', 'fulfilled'])
        .order('updated_at', { ascending: false })
        .limit(20),
      // Count active fleet vehicles
      supabase
        .from('vehicles')
        .select('id', { count: 'exact', head: true })
        .in('status', ['available', 'on_route', 'idle']),
    ]);

    let avgCostPerKm = 18; // Default ₹18/km
    let avgCostPerKg = 2.5; // Default ₹2.5/kg
    let totalAssigned = 0;

    if (recent && recent.length > 0) {
      const withCost = recent.filter((r: any) => r.cost_per_km && r.cost_per_km > 0);
      if (withCost.length > 0) {
        avgCostPerKm = Math.round(withCost.reduce((sum: number, r: any) => sum + r.cost_per_km, 0) / withCost.length * 100) / 100;
      }
      const withKg = recent.filter((r: any) => r.cost && r.required_capacity_kg);
      if (withKg.length > 0) {
        avgCostPerKg = Math.round(withKg.reduce((sum: number, r: any) => sum + (r.cost / r.required_capacity_kg), 0) / withKg.length * 100) / 100;
      }
      totalAssigned = recent.length;
    }

    return {
      avg_cost_per_km: avgCostPerKm,
      avg_cost_per_kg: avgCostPerKg,
      active_fleet: fleetCount || 0,
      recent_shipments: totalAssigned,
      currency: 'INR',
      updated_at: new Date().toISOString()
    };
  },

  /**
   * Fetch passing route opportunities for a vendor. An opportunity is only
   * good for a few hours: older ones are marked `ignored` and not shown.
   */
  async getPassingRoutes(vendorId: string) {
    const cutoff = new Date(Date.now() - PASSING_ROUTE_TTL_HOURS * 3600_000).toISOString();
    const { error: expireErr } = await supabase
      .from('vendor_route_opportunities')
      .update({ status: 'ignored', updated_at: new Date().toISOString() })
      .eq('vendor_id', vendorId)
      .eq('status', 'notified')
      .lt('created_at', cutoff);
    if (expireErr) console.error('[vendor] Could not expire old passing routes:', expireErr.message);

    const { data, error } = await supabase
      .from('vendor_route_opportunities')
      // Only what the card shows: never the full route or vehicle (plate, driver phone, live position)
      .select('*, routes(id, vehicles(vehicle_type))')
      .eq('vendor_id', vendorId)
      .eq('status', 'notified')
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return data;
  }
};
