import { supabase } from '../core/supabase';
import { v4 as uuidv4 } from 'uuid';

export const tplService = {
  /**
   * Submit a new 3PL onboarding application
   */
  async onboard(data: any) {
    const { companyName, pan, gst, msmeStatus, bankAccount, bankIfsc, slaCommitment, taxTreatment, corridors, documents } = data;

    // 1. Create Partner Record
    const { data: partner, error: partnerErr } = await supabase
      .from('tpl_partners')
      .insert({
        company_name: companyName,
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
    const { data, error } = await supabase
      .from('tpl_partners')
      .select(`
        *,
        tpl_corridors (*),
        tpl_documents (*)
      `)
      .eq('id', id)
      .single();
      
    if (error) throw new Error(`Failed to fetch partner ${id}: ${error.message}`);
    return data;
  },

  /**
   * Update an existing 3PL partner application (only if pending)
   */
  async updateApplication(id: string, data: any) {
    const { companyName, pan, gst, msmeStatus, bankAccount, bankIfsc, slaCommitment, taxTreatment, corridors, documents } = data;

    // 1. Update Partner Record
    const { error: partnerErr } = await supabase
      .from('tpl_partners')
      .update({
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
  }
};
