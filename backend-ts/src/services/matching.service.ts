import { supabase } from '../core/supabase';

export const matchingService = {
  /**
   * Run the Availability Scoring Engine for a shipment
   */
  async computeAvailabilityScore(shipmentId: string) {
    // 1. Fetch Shipment Details
    const { data: shipment, error: shipErr } = await supabase
      .from('shipments')
      .select('pickup_lat, pickup_lng, required_vehicle_type, metadata_json')
      .eq('id', shipmentId)
      .single();

    if (shipErr || !shipment) {
      throw new Error(`Failed to fetch shipment ${shipmentId} for scoring: ${shipErr?.message}`);
    }

    const { pickup_lat, pickup_lng, required_vehicle_type } = shipment;

    if (!pickup_lat || !pickup_lng) {
      return { count: 0, confidenceScore: 0, status: 'No Coordinates' };
    }

    // 2. Query available vehicles
    // In production, we'd use PostGIS ST_DWithin. Here we fetch idle trucks and calculate distance.
    const { data: vehicles, error: vehErr } = await supabase
      .from('vehicles')
      .select('id, latitude, longitude, status, type')
      .in('status', ['idle', 'available', 'active']) // Allow active if they have available capacity, but idle preferred
      .eq('type', required_vehicle_type || 'Tractor Trailer');

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

    for (const v of vehicles || []) {
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
    await supabase
      .from('shipments')
      .update({
        metadata_json: {
          ...shipment.metadata_json,
          scoring_engine: {
            last_run: new Date().toISOString(),
            available_count: availableCount,
            confidence_score: confidenceScore,
            radius_km: 100
          }
        }
      })
      .eq('id', shipmentId);

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
      const { data: vendors } = await supabase.from('vendor_profiles').select('id').eq('status', 'active');
      broadcastedTo = vendors?.length || 0;

    } else {
      // Low confidence -> Escalate to Tier 2 (3PL Network)
      escalationLevel = 'Tier 2';

      // Find 3PL partners matching the corridor
      // Assuming origin and dest are stored in shipment or we do a text match
      const origin = shipment.origin_city || 'DEL';
      const dest = shipment.destination_city || 'BOM';
      const corridor = `${origin.substring(0, 3).toUpperCase()}-${dest.substring(0, 3).toUpperCase()}`;

      const { data: corridors } = await supabase
        .from('tpl_corridors')
        .select('partner_id, proposed_rate')
        .eq('corridor_name', corridor);

      broadcastedTo = corridors?.length || 0;
    }

    // Log the escalation
    await supabase.from('shipment_logs').insert({
      shipment_id: shipmentId,
      status: 'escalated',
      metadata_json: {
        engine: 'CascadeMatcher',
        tier: escalationLevel,
        broadcast_count: broadcastedTo,
        trigger_score: score.confidenceScore
      }
    });

    return { tier: escalationLevel, broadcastedTo, confidenceScore: score.confidenceScore };
  }
};
