const fs = require('fs');
let code = fs.readFileSync('src/services/capacity.service.ts', 'utf8');

const targetStr = `    // 7. Inject the route stop for the vendor's drop-off point if there's an active route
    if (bid.dropoff_point_id) {
      const { data: route } = await supabase.from('routes')
        .select('id')
        .eq('vehicle_id', window.vehicle_id)
        .in('status', ['pending', 'active', 'in_progress'])
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (route) {`;

const newStr = `    // 7. Inject the route stop for the vendor's drop-off point if there's an active route
    if (bid.dropoff_point_id) {
      let { data: route } = await supabase.from('routes')
        .select('id')
        .eq('vehicle_id', window.vehicle_id)
        .in('status', ['pending', 'active', 'in_progress'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!route) {
        const routeId = uuidv4();
        await supabase.from('routes').insert({
          id: routeId,
          vehicle_id: window.vehicle_id,
          status: 'active',
          total_distance_km: 0,
          total_duration_minutes: 0,
          estimated_fuel_liters: 0,
          weather_condition: 'clear',
          traffic_delay_minutes: 0,
          waypoints: []
        });
        route = { id: routeId };
      }

      if (route) {`;

code = code.replace(targetStr, newStr);
fs.writeFileSync('src/services/capacity.service.ts', code);
console.log('Successfully patched route creation logic');
