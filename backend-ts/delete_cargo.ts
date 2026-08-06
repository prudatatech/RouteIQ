import { supabase } from './src/core/supabase';

async function deleteRecords() {
  const ids = ['DBE1BC5C', 'A34EE386'];
  
  for (const shortId of ids) {
    console.log(`Processing short ID: ${shortId}`);
    
    // 1. Find the cargo manifest
    const { data: manifests } = await supabase.from('cargo_manifest').select('id, vehicle_id');
    const filtered = (manifests || []).filter(m => m.id.toUpperCase().startsWith(shortId));
    
    if (filtered.length === 0) {
      console.log(`No manifest found for ${shortId}`);
      continue;
    }
    
    for (const manifest of filtered) {
      const manifestId = manifest.id;
      console.log(`Found manifest: ${manifestId} for vehicle: ${manifest.vehicle_id}`);
      
      // We should also delete the routes associated with this manifest.
      // Wait, cargo manifests create fake route stops in telemetry, but actual routes might exist for the truck?
      // Let's just delete the cargo manifest directly.
      const { error: err1 } = await supabase.from('cargo_manifest').delete().eq('id', manifestId);
      if (err1) console.error(`Error deleting manifest ${manifestId}:`, err1.message);
      else console.log(`Deleted cargo_manifest ${manifestId}`);
      
      // Let's also free up the vehicle capacity so the driver can get new jobs
      if (manifest.vehicle_id) {
         await supabase.from('vehicles').update({ available_capacity_kg: 1000 }).eq('id', manifest.vehicle_id);
         console.log(`Reset capacity for vehicle ${manifest.vehicle_id}`);
      }
    }
  }
  
  // Let's also find any actual 'routes' for this driver that might be stuck
  // We don't have driver 2711 exactly, but we can look for vehicles with plate 2711
  const { data: vehicles } = await supabase.from('vehicles').select('id').ilike('plate_number', '%2711%');
  if (vehicles && vehicles.length > 0) {
     for (const v of vehicles) {
         console.log(`Found vehicle with plate containing 2711: ${v.id}`);
         // delete pending/active routes for this vehicle
         const { data: routes } = await supabase.from('routes').select('id').eq('vehicle_id', v.id).in('status', ['active', 'pending']);
         for (const r of routes || []) {
             await supabase.from('route_stops').delete().eq('route_id', r.id);
             await supabase.from('routes').delete().eq('id', r.id);
             console.log(`Deleted stuck route ${r.id} for vehicle ${v.id}`);
         }
     }
  }

  console.log('Done');
}

deleteRecords();
