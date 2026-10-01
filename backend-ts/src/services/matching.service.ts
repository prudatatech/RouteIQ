import { supabase } from '../core/supabase';
import { ShipmentService } from './shipment.service';
import { tplNetworkService } from './tpl-network.service';
import { HttpError } from '../core/errors';
import { DISPATCHABLE_STATUSES, isDispatchable } from '../core/vehicles';

const AUTO_ESCALATE_KEY = 'auto_escalate_3pl';

/** True only when staff have turned on automatic 3PL escalation. */
async function autoEscalationEnabled(): Promise<boolean> {
  const { data } = await supabase.from('system_settings').select('value').eq('key', AUTO_ESCALATE_KEY).maybeSingle();
  const value = data?.value as unknown;
  return value === true || (typeof value === 'object' && value !== null && (value as { enabled?: unknown }).enabled === true);
}

export const matchingService = {
  /**
   * Run the Availability Scoring Engine for a shipment
   */
  async computeAvailabilityScore(shipmentId: string) {
    // 1. Fetch Shipment Details
    const { data: shipment, error: shipErr } = await supabase
      .from('shipments')
      .select('origin_lat, origin_lng, required_vehicle_type, metadata')
      .eq('id', shipmentId)
      .single();

    if (shipErr || !shipment) {
      throw new Error(`Failed to fetch shipment ${shipmentId} for scoring: ${shipErr?.message}`);
    }

    const { origin_lat: pickup_lat, origin_lng: pickup_lng, required_vehicle_type } = shipment;

    if (!pickup_lat || !pickup_lng) {
      return { count: 0, confidenceScore: 0, status: 'No Coordinates' };
    }

    // 2. Query available vehicles
    // In production, we'd use PostGIS ST_DWithin. Here we fetch idle trucks and calculate distance.
    const { data: vehicles, error: vehErr } = await supabase
      .from('vehicles')
      .select('id, latitude, longitude, status, vehicle_type, plate_number')
      .in('status', [...DISPATCHABLE_STATUSES]) // The one definition of "can be dispatched" (core/vehicles.ts)
      .eq('vehicle_type', required_vehicle_type || 'Tractor Trailer');

    if (vehErr) {
      console.error('Scoring Engine - Vehicle Fetch Error:', vehErr);
      return { count: 0, confidenceScore: 0, status: 'Query Error' };
    }

    // 3. Filter by Radius (e.g., 100km)
    let availableCount = 0;

    // Haversine function
    const getDist = (lat1: number, lon1: number, lat2: number, lon2: number) => {
      if (!lat1 || !lon1 || !lat2 || !lon2) return 9999;
      const R = 6371;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
    };

    for (const v of (vehicles || []).filter(isDispatchable)) {
      if (v.latitude && v.longitude) {
        const dist = getDist(pickup_lat, pickup_lng, v.latitude, v.longitude);
        if (dist <= 100) { // 100km radius
          availableCount++;
        }
      }
    }

    // 4. Compute Confidence Score
    // Formula: (available_trucks / threshold) * 100
    // E.g., if we want 5 trucks to be 100% confident
    let confidenceScore = Math.min(Math.round((availableCount / 5) * 100), 100);

    // Save score to shipment metadata
    const { error: updateErr } = await supabase
      .from('shipments')
      .update({
        metadata: {
          ...shipment.metadata,
          scoring_engine: {
            last_run: new Date().toISOString(),
            available_count: availableCount,
            confidence_score: confidenceScore,
            radius_km: 100
          }
        }
      })
      .eq('id', shipmentId);

    if (updateErr) {
      console.error(`Scoring Engine - Failed to save score for shipment ${shipmentId}:`, updateErr);
    }

    return { count: availableCount, confidenceScore, status: 'Computed' };
  },

  /**
   * Triggers the Cascade Escalation Engine
   */
  async cascadeEscalation(shipmentId: string) {
    const { data: shipment } = await supabase.from('shipments').select('*').eq('id', shipmentId).single();
    if (!shipment) throw new Error('Shipment not found');

    const score = await this.computeAvailabilityScore(shipmentId);

    let escalationLevel = 'Tier 0';
    let broadcastedTo = 0;

    if (score.confidenceScore >= 80) {
      // High confidence we can fulfill with Tier 0
      escalationLevel = 'Tier 0';
    } else if (score.confidenceScore >= 40) {
      // Moderate confidence -> Escalate to Tier 1 (Private Vendors)
      escalationLevel = 'Tier 1';

      // Log broadcast in DB
      const { data: vendors } = await supabase
        .from('vendor_profiles')
        .select('id')
        .eq('is_verified', true)
        .eq('kyc_status', 'approved');
      broadcastedTo = vendors?.length || 0;

    } else {
      // Low confidence -> Escalate to Tier 2 (3PL Network)
      escalationLevel = 'Tier 2';

      // Offer the load to every active 3PL partner whose corridor runs from the pickup to the
      // drop (matched on city or state names), but only when staff have switched automatic
      // escalation on (system_settings.auto_escalate_3pl). Off by default: staff escalate by
      // hand from the console, so partners aren't flooded while the own fleet is small.
      if (await autoEscalationEnabled()) {
        try {
          const result = await tplNetworkService.escalate('shipment', shipmentId, null);
          broadcastedTo = result.created;
        } catch (e) {
          if (!(e instanceof HttpError)) console.error('Cascade Matcher - 3PL escalation failed:', e);
        }
      }
    }

    // Log the escalation only when partners were really offered the load (hash-chain aware writer keeps
    // `index`/`previous_hash`/`log_hash` consistent). A shipment nobody was offered never reads "With 3PL partners".
    if (escalationLevel === 'Tier 2' && broadcastedTo > 0) {
      await ShipmentService.recordShipmentLog(shipmentId, 'escalated', null, null, {
        engine: 'CascadeMatcher',
        tier: escalationLevel,
        broadcast_count: broadcastedTo,
        trigger_score: score.confidenceScore
      });
    }

    return { tier: escalationLevel, broadcastedTo, confidenceScore: score.confidenceScore };
  }
};
