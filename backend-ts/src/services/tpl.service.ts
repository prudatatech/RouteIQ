import { supabase } from '../core/supabase';
import { v4 as uuidv4 } from 'uuid';

export const tplService = {
  /**
   * Submit a new 3PL onboarding application
   */
  async onboard(data: any) {
    const { custom_id, companyName, email, pan, gst, msmeStatus, bankAccount, bankIfsc, slaCommitment, taxTreatment, corridors, documents } = data;

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
        vehicle_types: c.vehicles ? c.vehicles.split(',').map((v: string) => v.trim()) : [],
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
    
    const { data, error } = await query.single();
      
    if (error) throw new Error(`Failed to fetch partner ${id}: ${error.message}`);
    return data;
  },

  /**
   * Update an existing 3PL partner application (only if pending)
   */
  async updateApplication(id: string, data: any) {
    const { custom_id, companyName, pan, gst, msmeStatus, bankAccount, bankIfsc, slaCommitment, taxTreatment, corridors, documents } = data;

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
  async approve(id: string, approverEmail: string) {
    // 1. Update status
    const { data: partner, error } = await supabase
      .from('tpl_partners')
      .update({ status: 'active' })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(`Approval failed: ${error.message}`);

    // 2. Create actual Auth User for them (simulated here)
    console.log(`[TPL Provisoning] Provisioning account for ${partner.company_name} approved by ${approverEmail}`);
    
    return partner;
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
   * Send a 4-digit OTP via Resend for 3PL Password Setup
   */
  async sendSetupOtp(email: string) {
    // 1. Check if email exists in tpl_partners and status is active
    const { data: partner, error } = await supabase
      .from('tpl_partners')
      .select('id, company_name, status')
      .eq('email', email)
      .single();

    if (error || !partner) {
      throw new Error('Email not found in our 3PL records.');
    }
    if (partner.status !== 'active') {
      throw new Error(`Your application is currently '${partner.status}'. You can only set up a password once approved.`);
    }

    // 2. Generate 4-digit OTP
    const otp = Math.floor(1000 + Math.random() * 9000).toString();

    // 3. Store in Redis
    const { cacheSet } = await import('../core/redis');
    await cacheSet(`otp:tpl:${email}`, otp, 300); // 5 mins

    // 4. Send Email via Resend
    const { Resend } = await import('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);

    await resend.emails.send({
      from: 'Margix India <onboarding@resend.dev>',
      to: email,
      subject: 'Margix India - Setup Your 3PL Account Password',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <h2 style="color: #4facfe;">Margix India 3PL Network</h2>
          <p>Hello ${partner.company_name},</p>
          <p>Your 3PL partner application has been approved. Please use the OTP below to securely set up your password and access the control tower.</p>
          <div style="background-color: #f4f4f5; padding: 15px; border-radius: 8px; text-align: center; margin: 20px 0;">
            <span style="font-size: 24px; font-weight: bold; letter-spacing: 5px; color: #333;">${otp}</span>
          </div>
          <p style="font-size: 12px; color: #666;">This code expires in 5 minutes. If you didn't request this, you can ignore this email.</p>
        </div>
      `
    });

    return true;
  },

  /**
   * Verify OTP and setup Supabase Auth Password
   */
  async verifyAndSetupPassword(email: string, otp: string, password: string) {
    // 1. Verify OTP
    const { cacheGet, cacheDelete } = await import('../core/redis');
    const cachedOtp = await cacheGet(`otp:tpl:${email}`);

    if (!cachedOtp || String(cachedOtp) !== String(otp)) {
      throw new Error('Invalid or expired OTP');
    }

    // 2. Get the partner to link
    const { data: partner, error: partnerError } = await supabase
      .from('tpl_partners')
      .select('id, company_name, custom_id')
      .eq('email', email)
      .single();

    if (partnerError || !partner) throw new Error('Partner record not found');

    // 3. Create or Update user in Supabase Auth via Admin API
    const { createClient } = await import('@supabase/supabase-js');
    const adminSupabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Check if user already exists
    const { data: users, error: listError } = await adminSupabase.auth.admin.listUsers();
    let userId = '';

    const existingUser = users?.users?.find(u => u.email === email);
    
    if (existingUser) {
      // Update password
      const { data, error } = await adminSupabase.auth.admin.updateUserById(existingUser.id, {
        password: password,
        email_confirm: true
      });
      if (error) throw error;
      userId = data.user.id;
    } else {
      // Create user
      const { data, error } = await adminSupabase.auth.admin.createUser({
        email: email,
        password: password,
        email_confirm: true,
        user_metadata: {
          role: 'vendor'
        }
      });
      if (error) throw error;
      userId = data.user.id;
    }

    // 4. Upsert into public.users
    await adminSupabase.from('users').upsert({
      id: userId,
      email: email,
      full_name: partner.company_name,
      role: 'vendor'
    });

    // 5. Link user_id in tpl_partners
    await this.activate(partner.id, userId);

    // 6. Cleanup OTP
    await cacheDelete(`otp:tpl:${email}`);

    return true;
  }
};
