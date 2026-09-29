interface RoutePoint {
  latitude?: number | null;
  longitude?: number | null;
}

/** The fields of a route (from the routes API) these helpers read. */
export interface RouteLike {
  total_distance_km?: number | null;
  total_duration_minutes?: number | null;
  estimated_fuel_liters?: number | null;
  vehicles?: RoutePoint | null;
  route_stops?: { sequence: number; delivery_points?: RoutePoint | null }[] | null;
}

/** Roads are longer than a straight line; 1.3 is the usual detour factor. */
const ROAD_FACTOR = 1.3;
const AVERAGE_SPEED_KMPH = 40;
const MINUTES_PER_STOP = 15;
const KM_PER_LITRE = 4;

const toRad = (v: number) => v * Math.PI / 180;

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Route distance in km: the stored value, otherwise an estimate from the
 * vehicle position through the stops. 0 when there is nothing to measure.
 */
export const getRouteDistance = (route: RouteLike): number => {
  if (route.total_distance_km && route.total_distance_km > 0) return route.total_distance_km;
  if (!route.route_stops || route.route_stops.length === 0) return 0;

  const stops = [...route.route_stops].sort((a, b) => a.sequence - b.sequence);
  let prevLat = route.vehicles?.latitude;
  let prevLng = route.vehicles?.longitude;

  if (!prevLat || !prevLng) {
    prevLat = stops[0]?.delivery_points?.latitude;
    prevLng = stops[0]?.delivery_points?.longitude;
    stops.shift();
  }

  let totalKm = 0;
  for (const stop of stops) {
    const lat = stop.delivery_points?.latitude;
    const lng = stop.delivery_points?.longitude;
    if (lat && lng && prevLat && prevLng) {
      totalKm += haversineKm(prevLat, prevLng, lat, lng) * ROAD_FACTOR;
      prevLat = lat;
      prevLng = lng;
    }
  }

  return parseFloat(totalKm.toFixed(1));
};

/** Route duration in minutes: the stored value, otherwise driving time plus time at each stop. */
export const getRouteDuration = (route: RouteLike, distanceKm: number): number => {
  if (route.total_duration_minutes && route.total_duration_minutes > 0) return route.total_duration_minutes;
  if (distanceKm <= 0) return 0;
  return Math.round((distanceKm / AVERAGE_SPEED_KMPH * 60) + ((route.route_stops?.length || 1) * MINUTES_PER_STOP));
};

/** Fuel in litres: the stored value, otherwise an estimate from the distance. */
export const getRouteFuel = (route: RouteLike, distanceKm: number): number => {
  if (route.estimated_fuel_liters && route.estimated_fuel_liters > 0) return route.estimated_fuel_liters;
  return parseFloat((distanceKm / KM_PER_LITRE).toFixed(1));
};
