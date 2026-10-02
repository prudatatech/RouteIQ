import { expiryStatus } from '@/utils/documentExpiry'
import { paiseToRupees, rupeesToPaise } from './statementFormat'
import type { AffiliationRules, NetVehicle, NetVehicleInput, StatementDeduction } from '@/types/network'

export interface DeductionRow { label: string; amount: string; reason: string }

export const toRows = (d: StatementDeduction[]): DeductionRow[] => d.map(x => ({ label: x.label, amount: String(paiseToRupees(x.amount_paise)), reason: x.reason }))

/** Rows a person filled in, as the deductions the API takes (whole paise). Blank rows are skipped; null when a row is incomplete. */
export function deductionsFromRows(rows: DeductionRow[]): StatementDeduction[] | null {
  const out: StatementDeduction[] = []
  for (const r of rows) {
    if (!r.label.trim() && !r.amount.trim() && !r.reason.trim()) continue
    const amount = Number(r.amount)
    if (!r.label.trim() || !r.reason.trim() || !Number.isFinite(amount) || amount <= 0) return null
    out.push({ label: r.label.trim(), amount_paise: rupeesToPaise(amount), reason: r.reason.trim() })
  }
  return out
}

/** The shape the API takes: a blank minimum rate clears the rule (null). */
export function rulesPayload(state: { classes: string[]; corridorIds: string[]; minRate: string; gps: boolean; insurance: boolean }): AffiliationRules {
  const rate = state.minRate.trim() === '' ? null : Number(state.minRate)
  return {
    vehicle_classes: state.classes,
    corridor_ids: state.corridorIds,
    min_rate_per_km: rate,
    gps_required: state.gps,
    insurance_required: state.insurance,
  }
}

export const VEHICLE_DOCS = [
  { key: 'rc', name: 'Registration (RC)', number: 'rc_number', expiry: 'rc_expiry' },
  { key: 'insurance', name: 'Insurance', number: 'insurance_number', expiry: 'insurance_expiry' },
  { key: 'fitness', name: 'Fitness certificate', number: 'fitness_certificate_number', expiry: 'fitness_expiry' },
  { key: 'permit', name: 'Permit', number: 'permit_number', expiry: 'permit_expiry' },
  { key: 'puc', name: 'Pollution certificate (PUC)', number: 'puc_number', expiry: 'puc_expiry' },
] as const

export type VehicleForm = {
  plate_number: string; vehicle_type: string; body_type: string; vehicle_class: string; vehicle_model: string
  capacity_kg: string; hazmat_certified: boolean; is_reefer: boolean
} & Record<(typeof VEHICLE_DOCS)[number]['number'] | (typeof VEHICLE_DOCS)[number]['expiry'], string>

/** Documents that are expired or expiring soon, and the ones with no number yet. */
export function documentBadges(v: NetVehicle): { key: string; tone: 'danger' | 'warning' | 'neutral'; text: string }[] {
  const out: { key: string; tone: 'danger' | 'warning' | 'neutral'; text: string }[] = []
  for (const d of VEHICLE_DOCS) {
    const record = v as unknown as Record<string, string | null | undefined>
    const status = expiryStatus(record[d.expiry])
    if (status) out.push({ key: d.key, tone: status.tone, text: `${d.name}: ${status.label}` })
    else if (!record[d.number] && (d.key === 'rc' || d.key === 'insurance')) out.push({ key: d.key, tone: 'neutral', text: `${d.name}: number missing` })
  }
  return out
}

/** What is sent: blank optional fields are left out so an edit never wipes a document number by accident. */
export function toVehicleInput(f: VehicleForm): NetVehicleInput {
  const out: Record<string, unknown> = {
    plate_number: f.plate_number.trim().toUpperCase().replace(/\s+/g, ''),
    vehicle_type: f.vehicle_type,
    capacity_kg: Number(f.capacity_kg),
    hazmat_certified: f.hazmat_certified,
    is_reefer: f.is_reefer,
  }
  for (const key of ['body_type', 'vehicle_class', 'vehicle_model'] as const) if (f[key].trim()) out[key] = f[key].trim()
  for (const d of VEHICLE_DOCS) {
    if (f[d.number].trim()) out[d.number] = f[d.number].trim()
    if (f[d.expiry]) out[d.expiry] = f[d.expiry]
  }
  return out as unknown as NetVehicleInput
}

