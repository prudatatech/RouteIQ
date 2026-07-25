import { supabase } from './src/core/supabase';

async function run() {
  try {
    const { data: vendor } = await supabase.from('vendor_profiles').select('*').limit(1).single();
    const { data: window } = await supabase.from('capacity_windows').select('*').limit(1).single();
    
    // Simulate logic of upcoming-stops
    let routeStops: any[] = [];
    const { data: route } = await supabase.from('routes').select('id').eq('vehicle_id', window.vehicle_id).eq('status', 'active').single();
    if (route) {
      const { data: stops } = await supabase.from('route_stops').select('delivery_points(*)').eq('route_id', route.id).eq('status', 'pending');
      routeStops = stops?.map((s: any) => s.delivery_points).filter(Boolean) || [];
    }
    
    // Inject Vendor Primary Hub
    const companyName = vendor.company_name || 'Unknown Vendor';
    const address = vendor.address || vendor.city || 'Default Hub Address';
    const lat = vendor.latitude || 0;
    const lng = vendor.longitude || 0;

    let existingHub = null;
    const { data: hubs } = await supabase.from('delivery_points').select('*').eq('latitude', lat).eq('longitude', lng).limit(1);
    if (hubs && hubs.length > 0) {
      existingHub = hubs[0];
    } else {
      const hubName = `Primary Hub (${companyName})`;
      const { data: newHub } = await supabase.from('delivery_points').insert({
        name: hubName,
        address: address,
        latitude: lat,
        longitude: lng
      }).select('*').single();
      existingHub = newHub;
    }

    if (existingHub) {
      let distanceKm = 0;
      let etaMins = 0;

      // Calculate exact OSRM detour
      const { data: vehicle } = await supabase.from('vehicles').select('latitude, longitude').eq('id', window.vehicle_id).single();
      if (vehicle?.latitude && vehicle?.longitude && lat && lng) {
        try {
          const axios = require('axios');
          const osrmRes = await axios.get(`https://router.project-osrm.org/route/v1/driving/${vehicle.longitude},${vehicle.latitude};${lng},${lat}?overview=false`);
          if (osrmRes.data.routes && osrmRes.data.routes.length > 0) {
            const routeData = osrmRes.data.routes[0];
            distanceKm = Math.round(routeData.distance / 1000 * 10) / 10;
            etaMins = Math.round(routeData.duration / 60);
          }
        } catch (e: any) {
          console.error("OSRM Error:", e.message);
        }
      }

      const hubStop = { ...existingHub, name: `${existingHub.name} [Detour: +${distanceKm}km, +${etaMins}m ETA]` };
      routeStops.unshift(hubStop);
    }
    
    console.log("Returning routeStops length:", routeStops.length);
    console.log("routeStops:", routeStops);

  } catch (e) {
    console.error(e);
  }
}
run();
