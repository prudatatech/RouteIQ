/**
 * Vehicle rules shared by Fleet, Dashboard and the live map. They mirror
 * backend-ts/src/core/vehicles.ts, so every screen and the server agree.
 */

type PlateLike = { plate_number?: string | null }
type StatusLike = { status?: string | null }
type SeenLike = { last_heartbeat?: string | null; last_sync?: string | null }

/** True for an auto-created placeholder plate: TEMP-… (a driver's first login) or DRFT-… (a saved wizard draft). */
export function isPlaceholderPlate(plate: string | null | undefined): boolean {
  const p = (plate ?? '').toUpperCase()
  return p.startsWith('TEMP-') || p.startsWith('DRFT-')
}

/**
 * A "draft" is a placeholder vehicle, not a real registered fleet vehicle. Two
 * cases produce one: Fleet's "Save draft" (`VehicleWizardModal`, archived with a
 * DRFT-… plate) and a driver signing in with no vehicle yet (auth.routes.ts
 * creates a TEMP-… stub). Drafts are listed under Fleet's "Drafts" filter and
 * are left out of every fleet count.
 */
export function isDraftVehicle(v: PlateLike & StatusLike): boolean {
  return isPlaceholderPlate(v.plate_number)
}

/** A real, non-archived fleet vehicle: what the fleet counts and the live map show. */
export function isFleetVehicle(v: PlateLike & StatusLike): boolean {
  return !isDraftVehicle(v) && v.status !== 'archived'
}

/** The newer of last_heartbeat (driver and telemetry pings) and last_sync (GPS provider), or null. */
export function lastSeenAt(v: SeenLike): Date | null {
  const times = [v.last_heartbeat, v.last_sync]
    .filter((t): t is string => !!t)
    .map(t => new Date(t).getTime())
    .filter(t => !Number.isNaN(t))
  return times.length > 0 ? new Date(Math.max(...times)) : null
}

/**
 * The limit for "live", in minutes, until the server's setting arrives. It is the
 * GPS-lost limit of the alarm settings (Fleet > Alerts), which the server also uses.
 */
export const DEFAULT_LIVE_MINUTES = 15

/** Live = reported in within `liveMinutes`, by heartbeat or sync, whichever is newer. */
export function isVehicleLive(v: SeenLike, liveMinutes: number = DEFAULT_LIVE_MINUTES, now: number = Date.now()): boolean {
  const seen = lastSeenAt(v)
  return !!seen && now - seen.getTime() <= liveMinutes * 60_000
}

/** Statuses a vehicle can be sent to by hand from the console. */
export type VehicleStatusTarget = 'available' | 'idle' | 'maintenance' | 'offline' | 'archived'

/** Whether staff can put the vehicle back in service (it is in maintenance). */
export const canReturnToService = (v: StatusLike): boolean => v.status === 'maintenance'
