import { formatDate, formatRupees } from '@/utils/display'
import type { NetStatement } from '@/types/network'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** "202609" to "September 2026". Anything that is not YYYYMM is shown as it came. */
export function periodLabel(period: string): string {
  const m = /^(\d{4})(\d{2})$/.exec(period)
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return period
  return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`
}

/** The month a picker's "YYYY-MM" value means, as the API's YYYYMM. */
export const periodFromMonth = (month: string) => month.replace('-', '')

/** Whole paise to rupees for display. Money is held in paise; only this turns it into rupees. */
export const paiseToRupees = (paise: number) => paise / 100

/** Rupees a person typed to whole paise. */
export const rupeesToPaise = (rupees: number) => Math.round(rupees * 100)

export const formatPaise = (paise: number | null | undefined) => formatRupees(paise == null ? null : paiseToRupees(paise))

export function statementDates(s: NetStatement): string {
  if (s.status === 'paid' && s.paid_at) return `Paid ${formatDate(s.paid_at)}${s.paid_reference ? `, ref ${s.paid_reference}` : ''}`
  if (s.status === 'issued' && s.issued_at) return `Issued ${formatDate(s.issued_at)}`
  return 'Not issued yet'
}

