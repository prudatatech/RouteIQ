/**
 * How loaded a vehicle is, from what it reports. One rule for the Fleet list, the vehicle page and
 * anywhere else that shows a load bar.
 *
 * The load comes from the first of these the vehicle has:
 *   1. current_load_kg          the weight on board (set from dispatch and by the driver)
 *   2. declared_load_percentage what the driver declared in the app, of capacity
 *   3. available_capacity_kg    free space, so load = capacity - free
 * A vehicle with none of them has not reported a load; that is shown as "not reported", never as empty.
 */

export type LoadBand = 'unknown' | 'empty' | 'partial' | 'near_full' | 'full' | 'overloaded'

/** Load at or above this share of capacity is "near full". */
export const NEAR_FULL_PCT = 85

export interface VehicleLoad {
  capacityKg: number
  loadKg: number
  freeKg: number
  /** Share of capacity, not capped: 112 means 12% over. */
  pct: number
  /** The bar's fill, 0 to 100. */
  barPct: number
  band: LoadBand
  /** Which field the load came from; null when none did. */
  source: 'weight' | 'declared' | 'free_space' | null
  /** Kilograms over capacity; 0 unless overloaded. */
  overKg: number
}

interface LoadFields {
  capacity_kg?: number | null
  current_load_kg?: number | null
  declared_load_percentage?: number | null
  available_capacity_kg?: number | null
}

export function bandFor(pct: number, known: boolean): LoadBand {
  if (!known) return 'unknown'
  if (pct > 100) return 'overloaded'
  if (pct >= 100) return 'full'
  if (pct >= NEAR_FULL_PCT) return 'near_full'
  if (pct > 0) return 'partial'
  return 'empty'
}

export function vehicleLoad(v: LoadFields): VehicleLoad {
  const capacityKg = Math.max(0, Number(v.capacity_kg ?? 0))
  let loadKg = 0
  let source: VehicleLoad['source'] = null
  if (v.current_load_kg != null) {
    loadKg = Number(v.current_load_kg)
    source = 'weight'
  } else if (v.declared_load_percentage != null) {
    loadKg = (capacityKg * Number(v.declared_load_percentage)) / 100
    source = 'declared'
  } else if (v.available_capacity_kg != null) {
    loadKg = capacityKg - Number(v.available_capacity_kg)
    source = 'free_space'
  }
  loadKg = Math.max(0, Math.round(loadKg))
  const known = source !== null && capacityKg > 0
  // The band follows the exact ratio, so 1,004 kg on a 1,000 kg truck is overloaded, not "100%, full".
  const exact = capacityKg > 0 ? (loadKg / capacityKg) * 100 : 0
  const pct = Math.round(exact)
  return {
    capacityKg,
    loadKg,
    freeKg: Math.max(0, capacityKg - loadKg),
    pct,
    barPct: Math.min(100, pct),
    band: bandFor(exact, known),
    source: known ? source : null,
    overKg: Math.max(0, loadKg - capacityKg),
  }
}

/** Colour and wording of each band. Classes are the design tokens (bg-*, text-*), nothing hard-coded. */
export const LOAD_BANDS: Record<LoadBand, { label: string; fill: string; text: string; tone: 'neutral' | 'success' | 'warning' | 'danger' }> = {
  unknown: { label: 'Load not reported', fill: 'bg-neutral', text: 'text-muted', tone: 'neutral' },
  empty: { label: 'Empty', fill: 'bg-neutral', text: 'text-muted', tone: 'neutral' },
  partial: { label: 'Part loaded', fill: 'bg-success', text: 'text-success', tone: 'success' },
  near_full: { label: 'Nearly full', fill: 'bg-warning', text: 'text-warning', tone: 'warning' },
  full: { label: 'Full', fill: 'bg-danger', text: 'text-danger', tone: 'danger' },
  overloaded: { label: 'Overloaded', fill: 'bg-danger', text: 'text-danger', tone: 'danger' },
}

export const SOURCE_LABELS: Record<NonNullable<VehicleLoad['source']>, string> = {
  weight: 'Weight on board',
  declared: 'Declared by the driver',
  free_space: 'From free space',
}

const kg = (n: number) => `${n.toLocaleString('en-IN')} kg`

/** One line saying how loaded the vehicle is, in words. */
export function loadSummary(l: VehicleLoad): string {
  if (l.band === 'unknown') return l.capacityKg > 0 ? 'No load reported yet' : 'Capacity not recorded'
  if (l.band === 'overloaded') return `${kg(l.loadKg)} on a ${kg(l.capacityKg)} vehicle, ${kg(l.overKg)} over`
  return `${kg(l.loadKg)} of ${kg(l.capacityKg)} · ${kg(l.freeKg)} free`
}
