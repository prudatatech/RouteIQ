export const getRouteDistance = (route: any) => {
  if (route.total_distance_km > 0) return route.total_distance_km;
  if (!route.route_stops || route.route_stops.length === 0) return 0;
  
  const stops = [...route.route_stops].sort((a: any, b: any) => a.sequence - b.sequence);
  let totalKm = 0;
  
  const toRad = (v: number) => v * Math.PI / 180;
  
  let prevLat = route.vehicles?.latitude;
  let prevLng = route.vehicles?.longitude;
  
  if (!prevLat || !prevLng) {
    prevLat = stops[0]?.delivery_points?.latitude;
    prevLng = stops[0]?.delivery_points?.longitude;
    stops.shift();
  }

  for (const stop of stops) {
    const lat = stop.delivery_points?.latitude;
    const lng = stop.delivery_points?.longitude;
    if (lat && lng && prevLat && prevLng) {
      const R = 6371;
      const dLat = toRad(lat - prevLat);
      const dLon = toRad(lng - prevLng);
      const a = Math.sin(dLat/2) * Math.sin(dLat/2) + 
                Math.cos(toRad(prevLat)) * Math.cos(toRad(lat)) * 
                Math.sin(dLon/2) * Math.sin(dLon/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      totalKm += R * c * 1.3;
      prevLat = lat;
      prevLng = lng;
    }
  }
  
  return totalKm > 0 ? parseFloat(totalKm.toFixed(1)) : 40.7;
};

export const getRouteDuration = (route: any, distanceKm: number) => {
  if (route.total_duration_minutes > 0) return route.total_duration_minutes;
  return Math.round((distanceKm / 40.0 * 60) + ((route.route_stops?.length || 1) * 15));
};

export const getRouteFuel = (route: any, distanceKm: number) => {
  if (route.estimated_fuel_liters > 0) return route.estimated_fuel_liters;
  return parseFloat((distanceKm / 4).toFixed(1));
};
