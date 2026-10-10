import crypto from 'crypto';
import { checkIfscForSave, type IfscCheck } from './ifsc.service';
import { withWarnings } from './people-common';
import { supabase } from '../core/supabase';
import { settings } from '../core/config';
import { cacheDelete, cacheGet, cacheSet } from '../core/redis';
import { HttpError } from '../core/errors';
import { notificationService, PLATFORM } from './notification.service';
import { emailService, fromAddress } from './email.service';
import { gstinError, normalizeGstin } from '../utils/gstin';
import { auditService, type AuditActor } from './audit.service';
import { EMAIL_PATTERN, assertApplicationFields, assertPartnerSettings } from '../schemas/tpl';
import { formatRate, type RateUnit } from '../utils/corridor-match';

const OTP_TTL_SECONDS = 300;
const OTP_MAX_ATTEMPTS = 5;

const otpKey = (email: string) => `otp:tpl:${email.toLowerCase()}`;

const CUSTOM_ID_PATTERN = /^[a-z0-9_]{5,20}$/;

/** Documents a 3PL applicant or partner can upload. */
export const TPL_DOCUMENT_TYPES = ['PAN Card', 'GST Certificate', 'Cancelled Cheque', 'Signed Rate Agreement'] as const;

/** Accepted upload formats and the file extension each is stored under. */
export const TPL_UPLOAD_CONTENT_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

/** Folder of a new application's documents (applicant has no account yet). */
const applicationFolder = (customId: string) => `tpl-applications/${customId}`;

/**
 * Reject document paths the applicant was not issued: every path must lie in
 * one of `folders` or already be one of the partner's documents.
 */
function assertDocumentPaths(documents: unknown, folders: string[], existing: string[] = []): void {
  if (documents == null) return;
  if (!Array.isArray(documents)) throw new HttpError(400, 'documents must be a list');
  for (const d of documents) {
    const url = typeof d?.url === 'string' ? d.url : '';
    const inFolder = folders.some(f => url.startsWith(`${f}/`) && !url.slice(f.length + 1).includes('/'));
    if (!url || (!inFolder && !existing.includes(url))) {
      throw new HttpError(400, 'Upload documents through the application form');
    }
  }
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/** A 10-digit Indian mobile number (optional leading +91 or 0), or null when empty. */
function parseMobile(value: unknown): string | null {
  if (value == null || value === '') return null;
  const digits = String(value).replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');
  if (!/^[6-9]\d{9}$/.test(digits)) throw new HttpError(400, 'Enter a valid 10-digit mobile number');
  return digits;
}

/**
 * Database rows for a partner's corridors as the forms send them. A rate is stored as a number and
 * a unit; `proposed_rate` keeps the readable text ("₹41,200 per trip"). With no number, an earlier
 * free-text rate the form passes back (`legacy_rate`) is kept as it was, and never used to price a load.
 */
function corridorRows(partnerId: string, corridors: any[]) {
  return corridors.map((c: any) => {
    const hasRate = c.rate !== undefined && c.rate !== null && c.rate !== '';
    const amount = hasRate ? Number(c.rate) : null;
    const unit: RateUnit | null = hasRate ? (c.rate_unit as RateUnit) : null;
    return {
      partner_id: partnerId,
      corridor_name: c.name,
      vehicle_types: c.vehicles ? c.vehicles.split(',').map((v: string) => v.trim()).filter(Boolean) : [],
      rate_amount: amount,
      rate_unit: unit,
      proposed_rate: amount !== null && unit ? formatRate({ amount, unit }) : (typeof c.legacy_rate === 'string' && c.legacy_rate.trim() ? c.legacy_rate.trim() : null),
      priority: c.priority,
    };
  });
}

/** Partner columns filled from the IFSC lookup; cleared when no IFSC was given. */
async function ifscColumns(ifsc: unknown): Promise<{ columns: Record<string, any>; check: IfscCheck | null }> {
  if (typeof ifsc !== 'string' || !ifsc.trim()) {
    return { columns: { bank_name: null, bank_branch: null, bank_ifsc_details: null, bank_ifsc_verified_at: null }, check: null };
  }
  const check = await checkIfscForSave(ifsc);
  const d = check.details;
  return {
    check,
    columns: { bank_name: d?.bank ?? null, bank_branch: d?.branch ?? null, bank_ifsc_details: d, bank_ifsc_verified_at: check.verifiedAt },
  };
}

export const tplService = {
  /**
   * Submit a new 3PL onboarding application
   */
  async onboard(data: any) {
    const { custom_id, companyName, pan, gst, msmeStatus, bankAccount, bankIfsc, slaCommitment, taxTreatment, corridors, documents, operatingFrom, fleetSize, truckType, user_id } = data;
    const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
    const isQuick = !!fleetSize;
    if (!companyName || !email || (!isQuick && !pan)) throw new HttpError(400, 'Company name, email and PAN are required');
    if (!EMAIL_PATTERN.test(email)) throw new HttpError(400, 'Enter a valid email address, for example name@company.in');
    
    if (!isQuick) {
      const gstProblem = gstinError(gst, pan);
      if (gstProblem) throw new HttpError(400, gstProblem);
      assertApplicationFields(data);
    }
    const phone = parseMobile(data.phone);
    const bank = await ifscColumns(bankIfsc);

    const { data: duplicate } = await supabase.from('tpl_partners').select('id').eq('email', email).maybeSingle();
    if (duplicate) throw new HttpError(409, 'An application with this email already exists. Use your tracking ID to view it.');

    // custom_id names the partner's document folder, so it must be unique
    if (custom_id) {
      if (typeof custom_id !== 'string' || !CUSTOM_ID_PATTERN.test(custom_id)) {
        throw new HttpError(400, 'Partner ID must be 5–20 lowercase letters, digits or underscores');
      }
      const { data: takenId } = await supabase.from('tpl_partners').select('id').eq('custom_id', custom_id).maybeSingle();
      if (takenId) throw new HttpError(409, 'This partner ID is already taken. Please choose another.');
    }

    assertDocumentPaths(documents, custom_id ? [applicationFolder(custom_id)] : []);

    // 1. Create Partner Record
    const { data: partner, error: partnerErr } = await supabase
      .from('tpl_partners')
      .insert({
        custom_id: custom_id || null,
        company_name: companyName,
        email: email,
        phone,
        pan_number: pan,
        gstin: normalizeGstin(gst),
        msme_status: msmeStatus || 'Not Registered',
        bank_account_no: bankAccount || null,
        bank_ifsc: bankIfsc ? String(bankIfsc).trim().toUpperCase() : null,
        ...bank.columns,
        sla_commitment: slaCommitment || '2 Hours',
        tax_treatment: taxTreatment || null,
        status: isQuick ? 'quick_added' : 'pending',
        operating_from: operatingFrom || null,
        fleet_size: fleetSize || null,
        truck_type: truckType || null,
        user_id: user_id || null
      })
      .select()
      .single();

    if (partnerErr) throw new Error(`Failed to create 3PL partner: ${partnerErr.message}`);

    const partnerId = partner.id;

    // 2. Insert Corridors
    if (corridors && corridors.length > 0) {
      const corridorsData = corridorRows(partnerId, corridors);

      const { error: corrErr } = await supabase.from('tpl_corridors').insert(corridorsData);
      if (corrErr) console.error("Failed to insert corridors", corrErr);
    }

    // 3. Insert Documents
    if (documents && documents.length > 0) {
      const docsData = documents.map((d: any) => ({
        partner_id: partnerId,
        doc_type: d.type,
        file_url: d.url
      }));
      
      const { error: docErr } = await supabase.from('tpl_documents').insert(docsData);
      if (docErr) console.error("Failed to insert docs", docErr);
    }

    // Notifications are informative; a failure must not undo the application.
    try {
      await notificationService.notifyStaff(
        '3PL application submitted',
        `${companyName} applied to become a 3PL partner.`,
        'tpl_application',
        { partner_id: partnerId },
        PLATFORM,
      );
    } catch (e) {
      console.error('[tpl] Application notification failed:', e);
    }

    if (isQuick) {
      const { emailService } = require('./email.service');
      const tempPassword = Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-8).toUpperCase() + "!";
      
      if (user_id) {
        await supabase.auth.admin.updateUserById(user_id, { password: tempPassword });
      }

      const html = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; background-color: #fff; border: 2px solid #FFD300; border-radius: 8px; overflow: hidden;">
          <div style="background-color: #FFD300; padding: 20px; text-align: center;">
            <h1 style="color: #000; margin: 0;">Welcome to Margix India!</h1>
          </div>
          <div style="padding: 30px; color: #333;">
            <p>Hi ${companyName},</p>
            <p>You have successfully registered as a 3PL Truck Partner.</p>
            <p>Your tracking ID is: <strong>${partnerId}</strong></p>
            <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <p style="margin: 0;"><strong>Login Details:</strong></p>
              <p style="margin: 5px 0;">Email / ID: ${email}</p>
              <p style="margin: 5px 0;">Password: ${tempPassword}</p>
            </div>
            <a href="${settings.WEB_APP_URL}/login?email=${encodeURIComponent(email)}&password=${encodeURIComponent(tempPassword)}" style="display: inline-block; background-color: #000; color: #FFD300; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold;">Login to your Dashboard</a>
            <p style="margin-top: 30px; font-size: 12px; color: #888;">If you signed in with Google, you can continue using Google Auth or use these fallback credentials.</p>
          </div>
        </div>
      `;
      
      await emailService.send(email, 'Welcome to Margix - Your 3PL Access Details', html);
      await emailService.send('u702pad-platform@margix.test', 'New 3PL Partner Onboarded', html);
    }

    return { partner, warnings: bank.check?.warnings ?? [] };
  },

  /**
   * Signed upload URL for one application document, at a path chosen here.
   * `partnerId` set: a document of an existing application/partner (the caller
   * has already been authorised for it). Otherwise a new application's document,
   * filed under its chosen 3PL ID, which must not belong to anyone yet.
   */
  async createDocumentUploadUrl(input: { docType: unknown; contentType: unknown; size: unknown; customId?: unknown; partnerId?: string }) {
    const { docType, contentType, size, customId, partnerId } = input;
    if (typeof docType !== 'string' || !(TPL_DOCUMENT_TYPES as readonly string[]).includes(docType)) {
      throw new HttpError(400, `Document type must be one of: ${TPL_DOCUMENT_TYPES.join(', ')}`);
    }
    const extension = typeof contentType === 'string' ? TPL_UPLOAD_CONTENT_TYPES[contentType.toLowerCase()] : undefined;
    if (!extension) throw new HttpError(415, 'Upload a PDF, JPG or PNG file');
    const bytes = Number(size);
    if (!Number.isInteger(bytes) || bytes <= 0) throw new HttpError(400, 'File size is required');
    if (bytes > settings.TPL_UPLOAD_MAX_BYTES) {
      throw new HttpError(413, `File must be at most ${Math.floor(settings.TPL_UPLOAD_MAX_BYTES / 1024 / 1024 * 10) / 10} MB`);
    }

    let folder: string;
    if (partnerId) {
      folder = partnerId;
    } else {
      if (typeof customId !== 'string' || !CUSTOM_ID_PATTERN.test(customId)) {
        throw new HttpError(400, 'Choose a valid 3PL ID before uploading documents');
      }
      const { data: taken, error } = await supabase.from('tpl_partners').select('id').eq('custom_id', customId).maybeSingle();
      if (error) throw new Error(`Failed to check 3PL ID: ${error.message}`);
      if (taken) throw new HttpError(409, 'This partner ID is already taken. Please choose another.');
      folder = applicationFolder(customId);
    }

    const slug = docType.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const path = `${folder}/${slug}_${crypto.randomUUID()}.${extension}`;
    const { data, error } = await supabase.storage.from(settings.KYC_DOCUMENTS_BUCKET).createSignedUploadUrl(path);
    if (error || !data) throw new Error(`Failed to create upload URL: ${error?.message}`);
    return { path: data.path, token: data.token, signed_url: data.signedUrl };
  },

  /**
   * Get list of pending applications (or all by status)
   */
  async getQueue(status: string = 'pending') {
    let query = supabase.from('tpl_partners').select(`
      *,
      tpl_corridors (*),
      tpl_documents (*)
    `).order('created_at', { ascending: false });

    if (status !== 'all') {
      query = query.eq('status', status);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Failed to fetch TPL queue: ${error.message}`);
    return data;
  },

  /**
   * Get a specific 3PL partner by ID
   */
  async getPartner(id: string) {
    const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id);
    const query = supabase
      .from('tpl_partners')
      .select(`
        *,
        tpl_corridors (*),
        tpl_documents (*)
      `);
      
    if (isUuid) {
      query.eq('id', id);
    } else {
      query.eq('custom_id', id);
    }
    
    const { data, error } = await query.maybeSingle();
    if (error) throw new Error(`Failed to fetch partner ${id}: ${error.message}`);
    if (!data) throw new HttpError(404, 'Application not found');
    return data;
  },

  /**
   * Update an existing 3PL partner application (only if pending)
   */
  async updateApplication(id: string, data: any) {
    const { custom_id, companyName, pan, gst, msmeStatus, bankAccount, bankIfsc, slaCommitment, taxTreatment, corridors, documents } = data;
    if (data.email !== undefined && !EMAIL_PATTERN.test(String(data.email).trim())) throw new HttpError(400, 'Enter a valid email address, for example name@company.in');
    assertApplicationFields(data ?? {}, true);

    const { data: current, error: currentErr } = await supabase.from('tpl_partners').select('id, status, custom_id, pan_number, tpl_documents(id, file_url, doc_type)').eq('id', id).maybeSingle();
    if (currentErr) throw new Error(`Failed to load 3PL partner: ${currentErr.message}`);
    if (!current) throw new HttpError(404, 'Application not found');
    if (current.status !== 'pending') throw new HttpError(409, 'Only pending applications can be edited');
    // A GSTIN carries the PAN: check it against the new PAN, or the one on record
    const gstProblem = gst !== undefined ? gstinError(gst, pan ?? current.pan_number) : undefined;
    if (gstProblem) throw new HttpError(400, gstProblem);
    const existingDocuments = (current.tpl_documents as { id: string; file_url: string; doc_type: string }[] | null) ?? [];
    assertDocumentPaths(
      documents,
      [current.id, ...(current.custom_id ? [applicationFolder(current.custom_id)] : [])],
      existingDocuments.map(d => d.file_url),
    );
    // The IFSC lookup only runs when the bank details are part of the edit
    const bank = bankIfsc !== undefined ? await ifscColumns(bankIfsc) : { columns: {}, check: null as IfscCheck | null };

    // 1. Update the partner record: only the fields that were sent, so an edit of the name never wipes the partner ID or the tax details
    const columns = {
        ...(custom_id !== undefined ? { custom_id: custom_id || null } : {}),
        ...(companyName !== undefined ? { company_name: companyName } : {}),
        ...(data.phone !== undefined ? { phone: parseMobile(data.phone) } : {}),
        ...(pan !== undefined ? { pan_number: pan } : {}),
        ...(gst !== undefined ? { gstin: normalizeGstin(gst) } : {}),
        ...(msmeStatus !== undefined ? { msme_status: msmeStatus || 'Not Registered' } : {}),
        ...(bankAccount !== undefined ? { bank_account_no: bankAccount || null } : {}),
        ...(bankIfsc !== undefined ? { bank_ifsc: bankIfsc ? String(bankIfsc).trim().toUpperCase() : null } : {}),
        ...bank.columns,
        ...(slaCommitment !== undefined ? { sla_commitment: slaCommitment || '2 Hours' } : {}),
        ...(taxTreatment !== undefined ? { tax_treatment: taxTreatment || null } : {}),
    };
    const { error: partnerErr } = Object.keys(columns).length === 0
      ? { error: null }
      : await supabase.from('tpl_partners').update(columns).eq('id', id).eq('status', 'pending'); // Only a pending application can be edited

    if (partnerErr) throw new Error(`Failed to update 3PL partner: ${partnerErr.message}`);

    // 2. Overwrite Corridors (delete old, insert new)
    if (corridors) {
      await supabase.from('tpl_corridors').delete().eq('partner_id', id);
      if (corridors.length > 0) {
        const corridorsData = corridorRows(id, corridors);
        await supabase.from('tpl_corridors').insert(corridorsData);
      }
    }

    // 3. Documents: `documents`, when given, is the desired final list (the client
    // sends every document that should remain, including ones it isn't re-uploading —
    // see services/tplDocuments and the onboarding/edit forms). We diff against what's
    // already stored instead of blindly deleting everything, so a request that merely
    // forgot to include an untouched document doesn't wipe out the rest, and so a
    // failed insert can't leave the application with no documents at all.
    if (documents) {
      const keepUrls = new Set((documents as { url: string }[]).map(d => d.url));
      const toRemove = existingDocuments.filter(d => !keepUrls.has(d.file_url));
      const existingUrls = new Set(existingDocuments.map(d => d.file_url));
      const toAdd = (documents as { type: string; url: string }[]).filter(d => !existingUrls.has(d.url));

      if (toAdd.length > 0) {
        const docsData = toAdd.map(d => ({ partner_id: id, doc_type: d.type, file_url: d.url }));
        const { error: insertErr } = await supabase.from('tpl_documents').insert(docsData);
        if (insertErr) throw new Error(`Failed to save documents: ${insertErr.message}`);
      }
      for (const doc of toRemove) {
        await supabase.from('tpl_documents').delete().eq('id', doc.id);
      }
    }

    return { warnings: bank.check?.warnings ?? [] };
  },

  /**
   * Tell a partner about a decision. Applicants without an account yet only
   * see the outcome on their tracking page, so there is nobody to notify.
   */
  async notifyPartner(partner: { user_id?: string | null }, title: string, body: string, type: string, partnerId: string) {
    if (!partner.user_id) return;
    try {
      await notificationService.sendNotification(partner.user_id, title, body, type, { partner_id: partnerId });
    } catch (e) {
      console.error('[tpl] Partner notification failed:', e);
    }
  },

  /**
   * Move a partner from one of `from` to `to`. The update only applies while the
   * partner is still in one of those states, so two people acting at once (or a
   * double click) cannot both succeed. Throws 404/409 when nothing changed.
   */
  async transition(id: string, from: string[], changes: Record<string, unknown>, refusal: (status: string) => string) {
    const { data, error } = await supabase
      .from('tpl_partners')
      .update({ ...changes, updated_at: new Date().toISOString() })
      .eq('id', id)
      .in('status', from)
      .select()
      .maybeSingle();
    if (error) throw new Error(`Failed to update partner: ${error.message}`);
    if (data) return data;
    const { data: existing } = await supabase.from('tpl_partners').select('status').eq('id', id).maybeSingle();
    if (!existing) throw new HttpError(404, 'Partner not found');
    throw new HttpError(409, refusal(String(existing.status)));
  },

  /** Tells an approved applicant to set up their sign-in; the page sends the code and takes the password. Never throws. */
  async emailApproval(partner: { email?: string | null; company_name?: string | null }) {
    if (!partner.email) return;
    const link = `${settings.WEB_APP_URL}/3pl/onboard/setup?email=${encodeURIComponent(partner.email)}`;
    await emailService.send(
      partner.email,
      'MargixIndia: your 3PL application was approved',
      `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <h2 style="color: #8C6600;">MargixIndia 3PL Network</h2>
          <p>Hello ${escapeHtml(partner.company_name ?? '')},</p>
          <p>Your 3PL partner application has been approved. Set up your password to open your partner portal and start receiving load offers.</p>
          <p style="margin: 24px 0;"><a href="${escapeHtml(link)}" style="background-color: #8C6600; color: #ffffff; padding: 12px 20px; border-radius: 8px; text-decoration: none;">Set up my account</a></p>
          <p style="font-size: 12px; color: #666;">We will email you a 6-digit code on that page to confirm it is you. If the button does not work, copy this address into your browser: ${escapeHtml(link)}</p>
        </div>
      `,
    );
  },

  /**
   * Approve a pending 3PL application, or a partner's pending profile update.
   * Only a partner waiting for review can be approved.
   */
  async approve(id: string, actor: AuditActor) {
    const { data: partner, error: fetchErr } = await supabase
      .from('tpl_partners')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (fetchErr) throw new Error(`Failed to fetch partner: ${fetchErr.message}`);
    if (!partner) throw new HttpError(404, 'Partner not found');

    const updates = partner.pending_updates;
    const partnerUpdates: Record<string, unknown> = { status: 'active', pending_updates: null, rejection_reason: null };
    if (updates) {
      if (updates.sla_commitment) partnerUpdates.sla_commitment = updates.sla_commitment;
      if (updates.tax_treatment) partnerUpdates.tax_treatment = updates.tax_treatment;
    }

    // Claim the review first, then apply the requested corridors
    const updatedPartner = await this.transition(id, ['pending'], partnerUpdates, status => `This partner is already ${status} and is not waiting for review`);

    if (updates?.corridors && Array.isArray(updates.corridors)) {
      await supabase.from('tpl_corridors').delete().eq('partner_id', id);
      const corridorPayloads = corridorRows(id, updates.corridors);
      if (corridorPayloads.length > 0) {
        await supabase.from('tpl_corridors').insert(corridorPayloads);
      }
    }

    await this.notifyPartner(
      partner,
      updates ? 'Changes approved' : 'Application approved',
      updates ? 'Your requested changes were approved and your profile is active again.' : 'Your 3PL application was approved.',
      'tpl_approved',
      id,
    );
    // A first-time applicant has no account yet, so the in-app notice above reaches nobody: email the setup link
    if (!updates) await this.emailApproval(partner);
    await auditService.record('staff-console', actor, 'tpl_approved', { partner_id: id, company_name: updatedPartner.company_name, profile_update: Boolean(updates) });
    return updatedPartner;
  },

  /**
   * Reject a pending 3PL application (or a partner's pending profile update),
   * recording why so the applicant can see it on the tracking page.
   */
  async reject(id: string, reason: string, actor: AuditActor) {
    const { data: partner, error: fetchErr } = await supabase
      .from('tpl_partners')
      .select('id, status, pending_updates, user_id')
      .eq('id', id)
      .maybeSingle();
    if (fetchErr) throw new Error(`Failed to fetch partner: ${fetchErr.message}`);
    if (!partner) throw new HttpError(404, 'Application not found');

    // Rejecting a profile update just clears the request and keeps the partner active;
    // rejecting a first-time application moves it out of the queue.
    const nextStatus = partner.pending_updates ? 'active' : 'rejected';
    const updated = await this.transition(
      id,
      ['pending'],
      { status: nextStatus, pending_updates: null, rejection_reason: reason },
      status => `This partner is already ${status} and is not waiting for review`,
    );
    await this.notifyPartner(
      partner,
      partner.pending_updates ? 'Changes not approved' : 'Application not approved',
      `Reason: ${reason}`,
      'tpl_rejected',
      id,
    );
    await auditService.record('staff-console', actor, 'tpl_rejected', { partner_id: id, company_name: updated.company_name, reason });
    return updated;
  },

  /**
   * Activate a 3PL partner (Called when they set their password)
   */
  async activate(id: string, userId: string) {
    const { data, error } = await supabase
      .from('tpl_partners')
      .update({ status: 'active', user_id: userId })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(`Failed to activate partner: ${error.message}`);
    return data;
  },

  /**
   * Get a 3PL partner by their user ID
   */
  async getPartnerByUserId(userId: string) {
    const { data, error } = await supabase
      .from('tpl_partners')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw new Error(`Failed to fetch partner by user ID: ${error.message}`);
    return data;
  },

  /**
   * Pause an active 3PL partner
   */
  async pausePartner(id: string, actor: AuditActor) {
    const paused = await this.transition(id, ['active'], { status: 'paused' }, status => `Only an active partner can be paused. This one is ${status}.`);
    await this.notifyPartner(paused, 'Account paused', 'Your 3PL account was paused. Contact support to resume it.', 'tpl_paused', id);
    await auditService.record('staff-console', actor, 'tpl_paused', { partner_id: id, company_name: paused.company_name });
    return true;
  },

  /**
   * Resume a paused 3PL partner. Only a paused partner can be resumed: a
   * pending, rejected or deleted-then-recreated one must go through review.
   */
  async resumePartner(id: string, actor: AuditActor) {
    const resumed = await this.transition(id, ['paused'], { status: 'active' }, status => `Only a paused partner can be resumed. This one is ${status}.`);
    await this.notifyPartner(resumed, 'Account resumed', 'Your 3PL account is active again.', 'tpl_resumed', id);
    await auditService.record('staff-console', actor, 'tpl_resumed', { partner_id: id, company_name: resumed.company_name });
    return true;
  },

  /**
   * Delete a 3PL partner (Hard delete)
   */
  async deletePartner(id: string, actor: AuditActor) {
    const { data: partner } = await supabase.from('tpl_partners').select('company_name').eq('id', id).maybeSingle();
    const { error } = await supabase
      .from('tpl_partners')
      .delete()
      .eq('id', id);
    if (error) throw new Error(`Failed to delete partner: ${error.message}`);
    await auditService.record('staff-console', actor, 'tpl_deleted', { partner_id: id, company_name: partner?.company_name ?? null });
    return true;
  },

  /**
   * The partner replaces one of their documents from their dashboard. The file
   * was uploaded through a signed URL issued for this partner's folder; the new
   * path is checked here. An active partner goes back to review (operations
   * pause until staff approve again) and staff are told.
   */
  async replaceDocument(partnerId: string, docId: string, path: unknown, actor: AuditActor) {
    const partner = await this.getPartner(partnerId);
    if (partner.user_id !== actor.user_id) throw new HttpError(403, 'Not authorized');
    if (!['active', 'pending'].includes(partner.status)) {
      throw new HttpError(409, `Your account is ${partner.status}. Contact support before changing documents.`);
    }
    const documents = (partner.tpl_documents ?? []) as { id: string; doc_type: string; file_url: string }[];
    const doc = documents.find(d => d.id === docId);
    if (!doc) throw new HttpError(404, 'Document not found');
    if (typeof path !== 'string' || !path.startsWith(`${partner.id}/`) || path.slice(partner.id.length + 1).includes('/') || path.includes('..')) {
      throw new HttpError(400, 'Upload the document through the dashboard first');
    }

    const uploadedAt = new Date().toISOString();
    const { error } = await supabase.from('tpl_documents').update({ file_url: path, uploaded_at: uploadedAt }).eq('id', docId).eq('partner_id', partner.id);
    if (error) throw new Error(`Failed to update document: ${error.message}`);

    if (partner.status === 'active') {
      await this.transition(partner.id, ['active'], { status: 'pending' }, status => `Your account is ${status}.`);
    }
    try {
      await notificationService.notifyStaff(
        '3PL partner changed a document',
        `${partner.company_name} replaced its ${doc.doc_type} and needs a new review.`,
        'tpl_update',
        { partner_id: partner.id },
        PLATFORM,
      );
    } catch (e) {
      console.error('[tpl] Document notification failed:', e);
    }
    await auditService.record('partner-portal', actor, 'tpl_document_replaced', { partner_id: partner.id, doc_type: doc.doc_type });
    return { id: docId, file_url: path, uploaded_at: uploadedAt, status: 'pending' as const };
  },

  /**
   * The partner asks to change their SLA, tax treatment or corridors. Nothing
   * changes until staff approve: the request is kept as pending_updates and an
   * active partner goes back to review meanwhile.
   */
  async requestSettingsUpdate(partnerId: string, input: Record<string, unknown>, actor: AuditActor) {
    const partner = await this.getPartner(partnerId);
    if (partner.user_id !== actor.user_id) throw new HttpError(403, 'Not authorized');
    if (!['active', 'pending'].includes(partner.status)) {
      throw new HttpError(409, `Your account is ${partner.status}. Contact support before changing settings.`);
    }
    const settingsUpdate = assertPartnerSettings(input);
    const pendingUpdates = { ...settingsUpdate, requested_at: new Date().toISOString() };

    const updated = await this.transition(
      partner.id,
      ['active', 'pending'],
      { pending_updates: pendingUpdates, status: 'pending' },
      status => `Your account is ${status}.`,
    );
    try {
      await notificationService.notifyStaff(
        '3PL partner requested changes',
        `${partner.company_name} asked to change its SLA, tax treatment or corridors.`,
        'tpl_update',
        { partner_id: partner.id },
        PLATFORM,
      );
    } catch (e) {
      console.error('[tpl] Settings notification failed:', e);
    }
    await auditService.record('partner-portal', actor, 'tpl_settings_requested', { partner_id: partner.id });
    return { status: updated.status, pending_updates: updated.pending_updates };
  },

  /**
   * Email a 6-digit password-setup code to an approved partner.
   * Returns silently when the email is not eligible so the endpoint does not
   * reveal which emails belong to partners.
   */
  async sendSetupOtp(email: string) {
    const { data: partner, error } = await supabase
      .from('tpl_partners')
      .select('id, company_name, status')
      .eq('email', email)
      .maybeSingle();
    if (error) throw new Error(`Partner lookup failed: ${error.message}`);
    if (!partner || partner.status !== 'active') return;

    const apiKey = process.env.RESEND_API_KEY;
    const otp = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
    if (!apiKey) {
      if (settings.isProduction) throw new HttpError(503, 'Email delivery is not configured');
      console.warn(`[TPL] RESEND_API_KEY not set — development OTP for ${email}: ${otp}`);
    }

    await cacheSet(otpKey(email), { otp, attempts: 0 }, OTP_TTL_SECONDS);

    if (!apiKey) return;
    const { Resend } = await import('resend');
    const { error: sendErr } = await new Resend(apiKey).emails.send({
      from: fromAddress(),
      to: email,
      subject: 'MargixIndia: set up your 3PL account password',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <h2 style="color: #8C6600;">MargixIndia 3PL Network</h2>
          <p>Hello ${escapeHtml(partner.company_name ?? '')},</p>
          <p>Your 3PL partner application has been approved. Please use the code below to set up your password and access the control tower.</p>
          <div style="background-color: #f4f4f5; padding: 15px; border-radius: 8px; text-align: center; margin: 20px 0;">
            <span style="font-size: 24px; font-weight: bold; letter-spacing: 5px; color: #333;">${otp}</span>
          </div>
          <p style="font-size: 12px; color: #666;">This code expires in 5 minutes. If you didn't request this, you can ignore this email.</p>
        </div>
      `
    });
    if (sendErr) throw new Error(`Failed to send setup email: ${sendErr.message}`);
  },

  /**
   * Verify the setup code and set the partner's password.
   * Only ever sets the password of the account already linked to this
   * partner, or creates a new vendor account — never takes over an
   * unrelated existing account with the same email.
   */
  async verifyAndSetupPassword(email: string, otp: string, password: string) {
    const stored = await cacheGet<{ otp: string; attempts: number }>(otpKey(email));
    if (!stored || typeof stored.otp !== 'string') throw new HttpError(400, 'Invalid or expired code');

    if (!safeEqual(stored.otp, otp)) {
      const attempts = (stored.attempts ?? 0) + 1;
      if (attempts >= OTP_MAX_ATTEMPTS) await cacheDelete(otpKey(email));
      else await cacheSet(otpKey(email), { otp: stored.otp, attempts }, OTP_TTL_SECONDS);
      throw new HttpError(400, 'Invalid or expired code');
    }
    await cacheDelete(otpKey(email));

    const { data: partner, error: partnerError } = await supabase
      .from('tpl_partners')
      .select('id, company_name, status, user_id')
      .eq('email', email)
      .maybeSingle();
    if (partnerError) throw new Error(`Partner lookup failed: ${partnerError.message}`);
    if (!partner || partner.status !== 'active') throw new HttpError(400, 'Invalid or expired code');

    if (partner.user_id) {
      // Password reset for the partner's own, already-linked account
      const { error } = await supabase.auth.admin.updateUserById(partner.user_id, { password });
      if (error) throw new Error(`Password update failed: ${error.message}`);
      return true;
    }

    const { data: existing } = await supabase.from('users').select('id').eq('email', email).maybeSingle();
    if (existing) {
      throw new HttpError(409, 'An account with this email already exists. Please contact support to link it.');
    }

    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { role: 'vendor' },
      user_metadata: { role: 'vendor', full_name: partner.company_name },
    });
    if (createErr || !created.user) {
      if (createErr && /already (been )?registered|exists/i.test(createErr.message)) {
        throw new HttpError(409, 'An account with this email already exists. Please contact support to link it.');
      }
      throw new Error(`Account creation failed: ${createErr?.message}`);
    }

    const { error: upsertErr } = await supabase.from('users').upsert({
      id: created.user.id,
      email,
      full_name: partner.company_name,
      role: 'vendor',
    });
    if (upsertErr) throw new Error(`Failed to create user profile: ${upsertErr.message}`);

    await this.activate(partner.id, created.user.id);
    return true;
  }
};
