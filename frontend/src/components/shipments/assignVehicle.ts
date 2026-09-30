import type { Vehicle } from '@/components/fleet/types'
import type { DriverLicenceStatus } from '@/components/people/types'
import { isPlaceholderPlate } from '@/utils/vehicles'
import { formatKg } from '@/utils/display'
import { haversineKm } from './format'

/** A vehicle as GET /vehicles returns it, with the dispatch warnings the server adds. */
export interface AssignableVehicle extends Vehicle {
  driver_licence_status?: DriverLicenceStatus
  driver_dispatch_issues?: ('not_active' | 'licence_missing' | 'licence_expired' | 'licence_class')[]
}

/** What is being given a vehicle: one shipment, one booking or one or more vendor loads. */
export interface AssignSubject {
  /** Shown in the dialog text: a tracking ID, a customer or a vendor. */
  label: string
  /** Where the goods are picked up; distances are measured to here. */
  pickup: { lat: number; lng: number } | null
  /** Total weight the vehicle must take. */
  weightKg: number
  /** What the requester asked for, if anything ("truck", "Tata Ace"). */
  vehicleType?: string | null
}

export interface VehicleAssessment {
  vehicle: AssignableVehicle
  /** Why this vehicle cannot be chosen, or null when it can. */
  blockedReason: string | null
  /** Straight-line distance to the pickup, when both positions are known. */
  distanceKm: number | null
  /** Free capacity in kg, or null when the vehicle has no capacity on record. */
  freeKg: number | null
  /** Open alarms on the vehicle. */
  problems: number
  /** Things worth a look that do not stop the assignment. */
  warnings: string[]
}

const DOC_SOON_DAYS = 30

const DOC_NAMES: [keyof AssignableVehicle, string][] = [
  ['rc_expiry', 'Registration'],
  ['insurance_expiry', 'Insurance'],
  ['fitness_expiry', 'Fitness certificate'],
  ['permit_expiry', 'Permit'],
  ['puc_expiry', 'Pollution certificate'],
]

/** Expired or soon-to-expire vehicle papers, worded for a chip. */
export function documentWarnings(v: AssignableVehicle, now: number = Date.now()): string[] {
  const out: string[] = []
  for (const [key, name] of DOC_NAMES) {
    const raw = v[key]
    if (typeof raw !== 'string' || !raw) continue
    const end = Date.parse(`${raw.slice(0, 10)}T23:59:59+05:30`)
    if (!Number.isFinite(end)) continue
    const days = Math.floor((end - now) / 86_400_000)
    if (end < now) out.push(`${name} expired`)
    else if (days <= DOC_SOON_DAYS) out.push(`${name} expires in ${days + 1} ${days === 0 ? 'day' : 'days'}`)
  }
  return out
}

const ISSUE_TEXT: Record<NonNullable<AssignableVehicle['driver_dispatch_issues']>[number], string> = {
  not_active: 'Driver is not active',
  licence_missing: 'No driving licence on file',
  licence_expired: 'Driving licence expired',
  licence_class: 'Licence class does not cover this vehicle',
}

export function freeKgOf(v: AssignableVehicle): number | null {
  if (v.available_capacity_kg != null) return Number(v.available_capacity_kg)
  const rated = Number(v.capacity_kg)
  return Number.isFinite(rated) && rated > 0 ? Math.max(0, rated - (Number(v.current_load_kg) || 0)) : null
}

const hasPosition = (lat: number | null | undefined, lng: number | null | undefined) =>
  lat != null && lng != null && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) && !(Number(lat) === 0 && Number(lng) === 0)

/** Why a vehicle can't take a load at all, or null. Mirrors what the server refuses. */
export function blockedReasonOf(v: AssignableVehicle, weightKg: number): string | null {
  if (v.status === 'pending_approval') return 'Waiting for approval'
  if (v.status === 'archived') return v.review_decision === 'rejected' ? 'Rejected' : 'Archived'
  if (v.status === 'maintenance') return 'In maintenance'
  if (!v.driver_id) return 'No driver'
  const free = freeKgOf(v)
  if (free != null && weightKg > 0 && weightKg > free) return `Only ${formatKg(free)} free, needs ${formatKg(weightKg)}`
  return null
}

export function assessVehicle(v: AssignableVehicle, subject: AssignSubject, problemCounts: ReadonlyMap<string, number>, now: number = Date.now()): VehicleAssessment {
  const distanceKm = subject.pickup && hasPosition(v.latitude, v.longitude)
    ? haversineKm(subject.pickup.lat, subject.pickup.lng, Number(v.latitude), Number(v.longitude))
    : null
  const warnings: string[] = []
  for (const issue of v.driver_dispatch_issues ?? []) {
    // A missing or expired licence already shows through the licence badge
    if (issue === 'not_active' || issue === 'licence_class') warnings.push(ISSUE_TEXT[issue])
  }
  warnings.push(...documentWarnings(v, now))
  const asked = subject.vehicleType?.trim().toLowerCase()
  if (asked && v.vehicle_type && asked !== String(v.vehicle_type).toLowerCase() && asked !== String(v.vehicle_model ?? '').toLowerCase()) {
    warnings.push(`Asked for ${asked}`)
  }
  return {
    vehicle: v,
    blockedReason: blockedReasonOf(v, subject.weightKg),
    distanceKm,
    freeKg: freeKgOf(v),
    problems: problemCounts.get(v.id) ?? 0,
    warnings,
  }
}

/** Vehicles that can be chosen first, nearest first; the rest after, by plate. Draft placeholders are left out. */
export function assessVehicles(vehicles: AssignableVehicle[], subject: AssignSubject, problemCounts: ReadonlyMap<string, number>, now?: number): VehicleAssessment[] {
  return vehicles
    .filter(v => !isPlaceholderPlate(v.plate_number))
    .map(v => assessVehicle(v, subject, problemCounts, now))
    .sort((a, b) => {
      if (!!a.blockedReason !== !!b.blockedReason) return a.blockedReason ? 1 : -1
      if (a.distanceKm != null && b.distanceKm != null && a.distanceKm !== b.distanceKm) return a.distanceKm - b.distanceKm
      if ((a.distanceKm == null) !== (b.distanceKm == null)) return a.distanceKm == null ? 1 : -1
      return a.vehicle.plate_number.localeCompare(b.vehicle.plate_number)
    })
}
