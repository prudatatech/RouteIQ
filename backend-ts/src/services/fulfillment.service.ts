import { supabase } from '../core/supabase';
import { Shipment, Organization, ThirdPartyAgreement } from '../db/types';

export class FulfillmentService {
  /**
   * Main entry point for fulfilling a shipment via the multi-tier waterfall.
   */
  static async fulfillShipment(shipmentId: string, clientOrgId: string) {
    console.log(`[FulfillmentService] Starting waterfall for shipment: ${shipmentId}`);
    
    // 1. Try Tier 0 (Private Network)
    const tier0Result = await this.tryTier0(shipmentId, clientOrgId);
    if (tier0Result.success) {
      return this.finalizeBooking(shipmentId, tier0Result, 0);
    }

    // 2. Try Tier 1 (Open Marketplace Bidding)
    const tier1Result = await this.tryTier1(shipmentId);
    if (tier1Result.success) {
      return this.finalizeBooking(shipmentId, tier1Result, 1);
    }

    // 3. Try Tier 2 (3PL Overflow)
    const tier2Result = await this.tryTier2(shipmentId);
    if (tier2Result.success) {
      return this.finalizeBooking(shipmentId, tier2Result, 2);
    }

    // 4. Fallback: Exception Queue
    return this.escalateToExceptionQueue(shipmentId);
  }

  private static async tryTier0(shipmentId: string, clientOrgId: string) {
    console.log(`[FulfillmentService] Attempting Tier 0 for ${shipmentId}`);
    // Logic: Look up network_relationships for clientOrgId
    // Broadcast to private fleet owners, wait for first accept
    // (To be implemented)
    return { success: false, fulfiller_org_id: null, fulfiller_rate: 0 };
  }

  private static async tryTier1(shipmentId: string) {
    console.log(`[FulfillmentService] Attempting Tier 1 for ${shipmentId}`);
    // Logic: Broadcast to all eligible fleet owners/brokers
    // Calculate blended score (Price, Reliability, Terms, Fairness)
    // Select winner
    // (To be implemented)
    return { success: false, fulfiller_org_id: null, fulfiller_rate: 0 };
  }

  private static async tryTier2(shipmentId: string) {
    console.log(`[FulfillmentService] Attempting Tier 2 for ${shipmentId}`);
    
    // 1. Fetch shipment details to determine corridor requirements
    const { data: shipment, error: shipmentError } = await supabase
      .from('shipments')
      .select('*')
      .eq('id', shipmentId)
      .single();

    if (shipmentError || !shipment) {
      console.error(`[FulfillmentService] Shipment ${shipmentId} not found or error:`, shipmentError);
      return { success: false, tpl_org_id: null, fulfiller_rate: 0 };
    }

    // 2. Fetch eligible 3PLs from third_party_agreements ordered by priority
    // Priority here is defined by lowest platform markup (or could be an explicit priority column)
    const { data: agreements, error: agreementsError } = await supabase
      .from('third_party_agreements')
      .select('*')
      .eq('status', 'active')
      // In production, we'd add corridor matching logic here based on shipment origin/dest
      .order('platform_markup_percent', { ascending: true });

    if (agreementsError || !agreements || agreements.length === 0) {
      console.warn(`[FulfillmentService] No active 3PL agreements found for shipment ${shipmentId}`);
      return { success: false, tpl_org_id: null, fulfiller_rate: 0 };
    }

    console.log(`[FulfillmentService] Found ${agreements.length} eligible 3PLs. Initiating sequential cascade...`);

    // 3. Initiate the sequential cascade
    // We select the first 3PL in the priority list to notify
    const first3PL = agreements[0];
    
    // Calculate rates based on the 3PL's agreement
    // (Simplified formula parsing for demonstration)
    const baseWholesaleRate = 5000; // This would normally be parsed from first3PL.wholesale_rate_formula
    const platformMargin = baseWholesaleRate * (first3PL.platform_markup_percent / 100);
    const clientRate = baseWholesaleRate + platformMargin;

    // To implement the sequential wait, we would write this state to the DB and let a Cron/Worker check SLAs
    // For this implementation, we will simulate immediate acceptance by the first 3PL
    console.log(`[FulfillmentService] Assigning to 3PL ${first3PL.tpl_org_id} at wholesale rate ${baseWholesaleRate}`);

    return { 
      success: true, 
      tpl_org_id: first3PL.tpl_org_id, 
      fulfiller_rate: baseWholesaleRate,
      platform_margin: platformMargin,
      client_rate: clientRate
    };
  }

  private static async finalizeBooking(shipmentId: string, result: any, tier: 0 | 1 | 2) {
    console.log(`[FulfillmentService] Finalizing booking for ${shipmentId} in Tier ${tier}`);
    
    // Create entry in BookingLedger
    const { data: ledger, error: ledgerError } = await supabase
      .from('booking_ledger')
      .insert({
        shipment_id: shipmentId,
        client_rate: result.client_rate || 0,
        fulfiller_rate: result.fulfiller_rate || 0,
        platform_margin: result.platform_margin || 0,
        tier_resolved: tier,
        fulfiller_org_id: result.fulfiller_org_id || null,
        tpl_org_id: result.tpl_org_id || null,
        escrow_status: 'pending_escrow'
      })
      .select()
      .single();

    if (ledgerError) {
      console.error(`[FulfillmentService] Failed to create booking ledger for ${shipmentId}`, ledgerError);
      return { success: false, error: ledgerError };
    }

    console.log(`[FulfillmentService] Successfully created booking ledger for ${shipmentId}. Escrow pending.`);
    return { success: true, tier_resolved: tier, ledger_id: ledger.id };
  }

  private static async escalateToExceptionQueue(shipmentId: string) {
    console.log(`[FulfillmentService] Escalating ${shipmentId} to Exception Queue`);
    // Flag for Super Admin review
    return { success: false, status: 'escalated' };
  }
}
