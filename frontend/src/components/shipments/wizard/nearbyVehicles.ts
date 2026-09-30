import { assessVehicles, type AssignableVehicle, type AssignSubject, type VehicleAssessment } from '../assignVehicle'

/**
 * How far from the pickup a vehicle may be to be offered in the create-shipment wizard, in km.
 * This is the one setting for it: change it here. (The server has no system setting for a dispatch
 * radius yet; when it does, read it in `VehiclePicker` and pass it in as `baseRadiusKm`.)
 */
export const NEARBY_VEHICLE_RADIUS_KM = 60

/** Radii "Show vehicles farther away" steps through after the base one; `null` means no limit. */
export const WIDER_RADII_KM: readonly (number | null)[] = [150, null]

/** The radius that follows `current` when the list is widened, or undefined when it is already unlimited. */
export function widerRadius(current: number | null, base: number = NEARBY_VEHICLE_RADIUS_KM): number | null | undefined {
  const steps = [base, ...WIDER_RADII_KM.filter(r => r === null || r > base)]
  const at = steps.indexOf(current)
  return at < 0 || at === steps.length - 1 ? undefined : steps[at + 1]
}

export interface NearbyVehicles {
  /**
   * Vehicles within the radius: ones that can be chosen first, nearest first; ones that cannot
   * (no driver, maintenance, waiting for approval, not enough space) after them, with their reason.
   * Without a pickup there is no distance, so every vehicle is listed.
   */
  nearby: VehicleAssessment[]
  /** Vehicles with no known position, so no distance. Empty when there is no pickup either. */
  unknown: VehicleAssessment[]
  /** Vehicles with a position but beyond the radius. */
  fartherCount: number
  /** The radius used; null is unlimited. */
  radiusKm: number | null
  hasPickup: boolean
}

/**
 * Splits the fleet for the vehicle step. Ranking and the blocked reasons come from `assessVehicles`
 * (the same rules as Assign vehicle); this only decides which vehicles are near enough to show.
 * `keepId` (the vehicle already chosen) stays in the list even when it is beyond the radius.
 */
export function nearbyVehicles(
  vehicles: AssignableVehicle[],
  subject: AssignSubject,
  radiusKm: number | null = NEARBY_VEHICLE_RADIUS_KM,
  opts: { keepId?: string | null; problemCounts?: ReadonlyMap<string, number>; now?: number } = {},
): NearbyVehicles {
  const assessed = assessVehicles(vehicles.filter(v => v.status !== 'archived'), subject, opts.problemCounts ?? new Map(), opts.now)
  const hasPickup = subject.pickup !== null
  if (!hasPickup) return { nearby: assessed, unknown: [], fartherCount: 0, radiusKm, hasPickup }

  const nearby: VehicleAssessment[] = []
  const unknown: VehicleAssessment[] = []
  let fartherCount = 0
  for (const a of assessed) {
    if (a.distanceKm === null) unknown.push(a)
    else if (radiusKm === null || a.distanceKm <= radiusKm || a.vehicle.id === opts.keepId) nearby.push(a)
    else fartherCount += 1
  }
  return { nearby, unknown, fartherCount, radiusKm, hasPickup }
}

/** Most vehicles whose drive time to the pickup is looked up; each is one directions request. */
export const MAX_ETA_LOOKUPS = 8

/** The nearest vehicles that can be chosen: the ones worth a driving-time lookup. */
export function etaCandidates(nearby: readonly VehicleAssessment[], max: number = MAX_ETA_LOOKUPS): VehicleAssessment[] {
  return nearby.filter(a => !a.blockedReason && a.distanceKm !== null).slice(0, max)
}
