import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import ws from 'ws';

(globalThis as any).WebSocket = ws;

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://plutdajzefwtpgofpqlk.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_KEY) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function migrateShipments() {
  console.log("Fetching existing shipments...");
  const { data: shipments, error } = await supabase
    .from('shipments')
    .select('*');

  if (error) {
    console.error("Error fetching shipments:", error);
    return;
  }

  console.log(`Found ${shipments.length} shipments.`);
  let updatedCount = 0;

  for (const shipment of shipments) {
    const existingMeta = shipment.metadata || {};
    
    // Update if missing basic meta OR missing eta_details
    if (!existingMeta.dispatch_date || !existingMeta.productCategory || !existingMeta.eta_details) {
      
      // Determine cargo type intuitively based on priority or defaults
      let cargo_type = 'standard';
      if (shipment.priority === 'high' || shipment.priority === 'critical') {
         cargo_type = 'standard'; // Priority doesn't necessarily mean hazardous
      }
      
      // Look at parcels if they exist
      if (shipment.parcels && shipment.parcels.length > 0) {
        if (shipment.parcels[0].is_hazardous) cargo_type = 'hazardous';
        else if (shipment.parcels[0].is_fragile) cargo_type = 'standard'; // Fragile is usually standard
        else if (shipment.total_weight_kg > 50) cargo_type = 'heavy';
      } else if (shipment.total_weight_kg > 50) {
        cargo_type = 'heavy';
      }

      const productCategory = cargo_type === 'standard' ? 'Standard Parcel' : 
                              cargo_type === 'heavy' ? 'Heavy Freight' :
                              cargo_type === 'cold_chain' ? 'Cold Chain' :
                              cargo_type === 'hazardous' ? 'Hazardous' : 'General Cargo';
                              
      const dispatch_date = shipment.created_at ? shipment.created_at.split('T')[0] : new Date().toISOString().split('T')[0];

      let dist = 0;
      if (shipment.origin_lat && shipment.dest_lat) {
        const toRad = (value: number) => (value * Math.PI) / 180;
        const R = 6371;
        const dLat = toRad(shipment.dest_lat - shipment.origin_lat);
        const dLon = toRad(shipment.dest_lng - shipment.origin_lng);
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(toRad(shipment.origin_lat)) * Math.cos(toRad(shipment.dest_lat)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      }
      
      const etaHrs = dist / 40;
      const createdDate = shipment.created_at ? new Date(shipment.created_at) : new Date();
      createdDate.setHours(createdDate.getHours() + etaHrs);
      const eta_text = dist ? `${createdDate.toISOString().split('T')[0]} (Est.)` : null;
      
      const newMetadata = {
        ...existingMeta,
        dispatch_date: existingMeta.dispatch_date || dispatch_date,
        productCategory: existingMeta.productCategory || productCategory,
        noOfPackages: existingMeta.noOfPackages || String(shipment.total_items || 1),
        grossWeight: existingMeta.grossWeight || `${shipment.total_weight_kg || 0} KG`,
        transporter_signature: existingMeta.transporter_signature || (shipment.vehicle_id ? 'Auto-Signed at Dispatch' : null),
        eta_details: {
          distance_km: dist ? dist.toFixed(1) : null,
          eta_text: eta_text
        },
        specialHandling: existingMeta.specialHandling || {
          fragile: cargo_type === 'standard' || (shipment.parcels && shipment.parcels[0]?.is_fragile),
          hazardous: cargo_type === 'hazardous' || (shipment.parcels && shipment.parcels[0]?.is_hazardous),
          coldChain: cargo_type === 'cold_chain',
          stackable: true,
          highValue: shipment.priority === 'high' || shipment.priority === 'critical',
          longHaul: false
        }
      };

      const { error: updateError } = await supabase
        .from('shipments')
        .update({ metadata: newMetadata })
        .eq('id', shipment.id);
        
      if (updateError) {
        console.error(`Failed to update shipment ${shipment.id}:`, updateError);
      } else {
        console.log(`Successfully migrated shipment ${shipment.tracking_id || shipment.id}`);
        updatedCount++;
      }
    }
  }
  console.log(`Migration complete. Updated ${updatedCount} old shipments.`);
}

migrateShipments();
