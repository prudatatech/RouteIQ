import { format, formatDistanceToNowStrict } from 'date-fns'

/** ₹12,34,567 — whole rupees unless the amount has paise. */
export function formatRupees(amount: number | string | null | undefined): string {
  const n = Number(amount)
  if (amount === null || amount === undefined || amount === '' || !Number.isFinite(n)) return '—'
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
}

/** 1,250 kg */
export function formatKg(kg: number | string | null | undefined): string {
  const n = Number(kg)
  if (kg === null || kg === undefined || kg === '' || !Number.isFinite(n)) return '—'
  return `${n.toLocaleString('en-IN', { maximumFractionDigits: 1 })} kg`
}

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/** "29 Sep 2026, 2:05 pm" */
export function formatDateTime(value: string | number | Date | null | undefined): string {
  const d = toDate(value)
  return d ? format(d, 'd MMM yyyy, h:mm a') : '—'
}

/** "29 Sep 2026" */
export function formatDate(value: string | number | Date | null | undefined): string {
  const d = toDate(value)
  return d ? format(d, 'd MMM yyyy') : '—'
}

/** "5 minutes ago" / "in 3 minutes" */
export function formatRelative(value: string | number | Date | null | undefined): string {
  const d = toDate(value)
  return d ? formatDistanceToNowStrict(d, { addSuffix: true }) : '—'
}

/** Best readable message from an API (axios) or Supabase error. */
export function errorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object') {
    const e = err as { response?: { status?: number; data?: { error?: unknown; detail?: unknown } }; message?: unknown }
    // Server faults carry no useful message for the user
    if ((e.response?.status ?? 0) >= 500) return fallback
    const data = e.response?.data
    if (typeof data?.error === 'string' && data.error) return data.error
    if (typeof data?.detail === 'string' && data.detail) return data.detail
    if (!e.response && typeof e.message === 'string' && e.message && !e.message.startsWith('Request failed')) return e.message
  }
  return fallback
}
