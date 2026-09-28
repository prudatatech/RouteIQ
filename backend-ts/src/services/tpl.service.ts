import crypto from 'crypto';
import { supabase } from '../core/supabase';
import { settings } from '../core/config';
import { cacheDelete, cacheGet, cacheSet } from '../core/redis';
import { HttpError } from '../core/errors';

const OTP_TTL_SECONDS = 300;
const OTP_MAX_ATTEMPTS = 5;

const otpKey = (email: string) => `otp:tpl:${email.toLowerCase()}`;

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export const tplService = {
  /**
   * Submit a new 3PL onboarding application
   */
  async onboard(data: any) {
    const { custom_id, companyName, pan, gst, msmeStatus, bankAccount, bankIfsc, slaCommitment, taxTreatment, corridors, documents } = data;
    const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
    if (!companyName || !email || !pan) throw new HttpError(400, 'Company name, email and PAN are required');

    const { data: duplicate } = await supabase.from('tpl_partners').select('id').eq('email', email).maybeSingle();
    if (duplicate) throw new HttpError(409, 'An application with this email already exists. Use your tracking ID to view it.');

    // 1. Create Partner Record
    const { data: partner, error: partnerErr } = await supabase
      .from('tpl_partners')
      .insert({
        custom_id: custom_id || null,
        company_name: companyName,
        email: email,
        pan_number: pan,
        gstin: gst,
        msme_status: msmeStatus || 'Not Registered',
        bank_account_no: bankAccount || null,
        bank_ifsc: bankIfsc || null,
        sla_commitment: slaCommitment || '2 Hours',
        tax_treatment: taxTreatment || null,
        status: 'pending'
      })
      .select()
      .single();

    if (partnerErr) throw new Error(`Failed to create 3PL partner: ${partnerErr.message}`);

    const partnerId = partner.id;

    // 2. Insert Corridors
    if (corridors && corridors.length > 0) {
      const corridorsData = corridors.map((c: any) => ({
        partner_id: partnerId,
        corridor_name: c.name,
        vehicle_types: c.vehicles ? c.vehicles.split(',').map((v: string) => v.trim()).filter(Boolean) : [],
        proposed_rate: c.rate,
        priority: c.priority
      }));
      
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

    return partner;
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

    const { data: current, error: currentErr } = await supabase.from('tpl_partners').select('status').eq('id', id).maybeSingle();
    if (currentErr) throw new Error(`Failed to load 3PL partner: ${currentErr.message}`);
    if (!current) throw new HttpError(404, 'Application not found');
    if (current.status !== 'pending') throw new HttpError(409, 'Only pending applications can be edited');

    // 1. Update Partner Record
    const { error: partnerErr } = await supabase
      .from('tpl_partners')
      .update({
        custom_id: custom_id || null,
        company_name: companyName,
        pan_number: pan,
        gstin: gst,
        msme_status: msmeStatus || 'Not Registered',
        bank_account_no: bankAccount || null,
        bank_ifsc: bankIfsc || null,
        sla_commitment: slaCommitment || '2 Hours',
        tax_treatment: taxTreatment || null
      })
      .eq('id', id)
      .eq('status', 'pending'); // Ensure it can only be updated if pending

    if (partnerErr) throw new Error(`Failed to update 3PL partner: ${partnerErr.message}`);

    // 2. Overwrite Corridors (delete old, insert new)
    if (corridors) {
      await supabase.from('tpl_corridors').delete().eq('partner_id', id);
      if (corridors.length > 0) {
        const corridorsData = corridors.map((c: any) => ({
          partner_id: id,
          corridor_name: c.name,
          vehicle_types: c.vehicles ? c.vehicles.split(',').map((v: string) => v.trim()) : [],
          proposed_rate: c.rate,
          priority: c.priority
        }));
        await supabase.from('tpl_corridors').insert(corridorsData);
      }
    }

    // 3. Overwrite Documents
    if (documents) {
      await supabase.from('tpl_documents').delete().eq('partner_id', id);
      if (documents.length > 0) {
        const docsData = documents.map((d: any) => ({
          partner_id: id,
          doc_type: d.type,
          file_url: d.url
        }));
        await supabase.from('tpl_documents').insert(docsData);
      }
    }

    return true;
  },

  /**
   * Approve a 3PL partner
   */
  async approve(id: string, approverId: string) {
    // Fetch the existing partner to get pending_updates
    const { data: partner, error: fetchErr } = await supabase
      .from('tpl_partners')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr) throw new Error(`Failed to fetch partner: ${fetchErr.message}`);

    const updates = partner.pending_updates;
    const partnerUpdates: any = {
      status: 'active',
      pending_updates: null
    };

    if (updates) {
      if (updates.sla_commitment) partnerUpdates.sla_commitment = updates.sla_commitment;
      if (updates.tax_treatment) partnerUpdates.tax_treatment = updates.tax_treatment;
      
      // Update Corridors if present
      if (updates.corridors && Array.isArray(updates.corridors)) {
        // Delete old corridors and insert new ones
        await supabase.from('tpl_corridors').delete().eq('partner_id', id);
        
        const corridorPayloads = updates.corridors.map((c: any) => ({
          partner_id: id,
          corridor_name: c.name,
          vehicle_types: c.vehicles ? c.vehicles.split(',').map((v: string) => v.trim()).filter(Boolean) : [],
          proposed_rate: c.rate,
          priority: c.priority
        }));
        
        if (corridorPayloads.length > 0) {
          await supabase.from('tpl_corridors').insert(corridorPayloads);
        }
      }
    }

    // 1. Update status and apply merged updates
    const { data: updatedPartner, error } = await supabase
      .from('tpl_partners')
      .update(partnerUpdates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(`Approval failed: ${error.message}`);

    // 2. Create actual Auth User for them (simulated here)
    console.log(`[TPL Provisoning] Provisioning account for ${updatedPartner.company_name} approved by ${approverId}`);
    
    return updatedPartner;
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
   * Pause a 3PL partner
   */
  async pausePartner(id: string) {
    const { error } = await supabase
      .from('tpl_partners')
      .update({ status: 'paused' })
      .eq('id', id);
    if (error) throw new Error(`Failed to pause partner: ${error.message}`);
    return true;
  },

  /**
   * Resume a 3PL partner
   */
  async resumePartner(id: string) {
    const { error } = await supabase
      .from('tpl_partners')
      .update({ status: 'active' })
      .eq('id', id);
    if (error) throw new Error(`Failed to resume partner: ${error.message}`);
    return true;
  },

  /**
   * Delete a 3PL partner (Hard delete)
   */
  async deletePartner(id: string) {
    const { error } = await supabase
      .from('tpl_partners')
      .delete()
      .eq('id', id);
    if (error) throw new Error(`Failed to delete partner: ${error.message}`);
    return true;
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
      from: 'Margix India <onboarding@resend.dev>',
      to: email,
      subject: 'Margix India - Setup Your 3PL Account Password',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <h2 style="color: #4facfe;">Margix India 3PL Network</h2>
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
