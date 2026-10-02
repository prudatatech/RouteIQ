/**
 * Plain sentences for the audit-log action keys the console writes (backend-ts audit.service).
 * An unknown key is still shown readably ("cargo_case.opened" becomes "Cargo case opened"),
 * never as the raw key.
 */
const LABELS: Record<string, string> = {
  'cargo_case.opened': 'Problem opened',
  'cargo_case.auto_resolved': 'Problem closed automatically',
  company_profile_changed: 'Company profile changed',
  delivery_priced: 'Delivery priced',
  'driver_pay.adjusted': 'Driver pay adjusted',
  'driver_pay.approved': 'Driver pay approved',
  'driver_pay.backfill': 'Driver pay calculated for past trips',
  'driver_pay.paid': 'Driver pay paid',
  'driver_pay.rate_changed': 'Driver pay rate changed',
  'driver_pay.rate_set': 'Driver pay rate set',
  'driver_pay.rate_withdrawn': 'Driver pay rate withdrawn',
  'driver_pay.voided': 'Driver pay voided',
  expense_deleted: 'Expense deleted',
  fuel_log_deleted: 'Fuel entry deleted',
  fuel_price_changed: 'Fuel price changed',
  invoice_paid: 'Invoice marked paid',
  kyc_approved: 'Company verification approved',
  kyc_info_answered: 'Vendor sent the details asked for',
  kyc_info_requested: 'Asked the vendor for more details',
  kyc_rejected: 'Company verification rejected',
  kyc_submitted: 'KYC submitted',
  tpl_approved: '3PL partner approved',
  tpl_deleted: '3PL partner deleted',
  tpl_document_replaced: '3PL partner document replaced',
  tpl_paused: '3PL partner paused',
  tpl_rejected: '3PL partner rejected',
  tpl_resumed: '3PL partner resumed',
  tpl_settings_requested: '3PL partner asked to change settings',
  user_updated: 'Person updated',
  vehicle_approved: 'Vehicle approved',
  vehicle_rejected: 'Vehicle rejected',
  vendor_location_set: 'Vendor location set',
}

/** The sentence for an audit action key. */
export function auditActionLabel(action: string | null | undefined): string {
  if (!action) return '—'
  const known = LABELS[action]
  if (known) return known
  const text = action.replace(/[._-]+/g, ' ').trim().toLowerCase()
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** Who did it: the console a change came from, in words a person uses. */
const SOURCES: Record<string, string> = {
  'staff-console': 'Staff',
  'vendor-portal': 'Vendor',
  'partner-portal': '3PL partner',
  'driver-app': 'Driver',
  system: 'System',
}

export function auditSourceLabel(source: string | null | undefined): string {
  if (!source) return '—'
  return SOURCES[source] ?? auditActionLabel(source)
}
