/**
 * A vehicle row is a "draft" — not a real, registered fleet vehicle — when it was
 * never finished through Fleet's add-vehicle flow. Two cases produce this:
 *  - Fleet's own "Save draft" button (`VehicleWizardModal`), which sets `status: 'archived'`
 *    and a `DRFT-…` placeholder plate.
 *  - A driver signing in without a vehicle assigned yet (`backend-ts/src/routes/auth.routes.ts`),
 *    which auto-creates a stub vehicle with a `TEMP-…` plate the driver never entered.
 * Neither should count as a fleet asset that needs attention when it goes offline.
 */
export function isDraftVehicle(v: { status?: string | null; plate_number?: string | null }): boolean {
  if (v.status === 'archived') return true
  const plate = v.plate_number ?? ''
  return plate.startsWith('TEMP-') || plate.startsWith('DRFT-')
}
