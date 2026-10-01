/**
 * margixindia — Place checks shared by quotes, bookings and vendor loads.
 */

/** A point that could be a real place: in range, and not the (0, 0) a missing fix is stored as. */
export function validPlace(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
}

/** Two points about 10 metres apart or closer are the same place. */
export function samePlace(aLat: number, aLng: number, bLat: number, bLng: number): boolean {
  return Math.abs(aLat - bLat) < 0.0001 && Math.abs(aLng - bLng) < 0.0001;
}
