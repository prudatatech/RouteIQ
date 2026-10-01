import { formatDistanceStrict } from 'date-fns'

/**
 * The one set of number, money and date formats for the console. Everything is shown in
 * Indian conventions: lakh grouping, ₹, and India time (Asia/Kolkata) whatever the browser's zone.
 */
const IST = 'Asia/Kolkata'
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const EMPTY = '—'
const BARE_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

type DateInput = string | number | Date | null | undefined

const istParts = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST, year: 'numeric', month: 'numeric', day: 'numeric',
  hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23',
})

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === '') return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/** The calendar day and clock time of an instant as seen in India. */
function inIndia(d: Date) {
  const get: Record<string, number> = {}
  for (const p of istParts.formatToParts(d)) if (p.type !== 'literal') get[p.type] = Number(p.value)
  return { year: get.year, month: get.month, day: get.day, hour: get.hour, minute: get.minute, second: get.second }
}

const dayText = (p: { day: number; month: number; year: number }, withYear = true) =>
  `${p.day} ${MONTHS[p.month - 1]}${withYear ? ` ${p.year}` : ''}`

function timeText(p: { hour: number; minute: number; second: number }, seconds = false) {
  const h = p.hour % 12 === 0 ? 12 : p.hour % 12
  const mm = String(p.minute).padStart(2, '0')
  const ss = seconds ? `:${String(p.second).padStart(2, '0')}` : ''
  return `${h}:${mm}${ss} ${p.hour < 12 ? 'am' : 'pm'}`
}

const numberOf = (value: number | string | null | undefined): number | null => {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** ₹12,34,567 — whole rupees; paise only when the amount has them (₹1,250.50). */
export function formatRupees(amount: number | string | null | undefined): string {
  const n = numberOf(amount)
  if (n === null) return EMPTY
  const paise = Math.round(n * 100) % 100 !== 0
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: paise ? 2 : 0, maximumFractionDigits: paise ? 2 : 0 })}`
}

/** 1,250 kg */
export function formatKg(kg: number | string | null | undefined): string {
  const n = numberOf(kg)
  return n === null ? EMPTY : `${n.toLocaleString('en-IN', { maximumFractionDigits: 1 })} kg`
}

/** 1,250.5 km */
export function formatKm(km: number | string | null | undefined): string {
  const n = numberOf(km)
  return n === null ? EMPTY : `${n.toLocaleString('en-IN', { maximumFractionDigits: 1 })} km`
}

/** "1 vehicle", "3 vehicles". Pass `many` for irregular plurals. The count gets Indian grouping. */
export function pluralize(n: number, one: string, many: string = `${one}s`): string {
  return `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`
}

/** "1 piece", "1,250 pieces". Pieces is the one word for a count of goods. */
export function formatPieces(n: number | string | null | undefined): string {
  const v = numberOf(n)
  return v === null ? EMPTY : pluralize(v, 'piece')
}

/** TR-874FA20D: the one display number of a trip, from its id. Same everywhere a trip is named. */
export function tripNumber(id: string | null | undefined): string {
  return id ? `TR-${id.split('-')[0].toUpperCase().slice(0, 8)}` : EMPTY
}

/** "12 min", "1 h", "1 h 5 min". Zero or unknown shows a dash. */
export function formatMinutes(minutes: number | null | undefined): string {
  const n = numberOf(minutes)
  if (n === null || n <= 0) return EMPTY
  const total = Math.max(1, Math.round(n))
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

/** "29 Sep 2026, 2:05 pm" */
export function formatDateTime(value: DateInput): string {
  const d = toDate(value)
  if (!d) return EMPTY
  const p = inIndia(d)
  return `${dayText(p)}, ${timeText(p)}`
}

/**
 * "29 Sep 2026". A bare date (2026-09-30) is already an India calendar day and is shown as it is,
 * so no time zone can move it.
 */
export function formatDate(value: DateInput): string {
  const bare = typeof value === 'string' ? BARE_DATE.exec(value) : null
  if (bare) return dayText({ year: Number(bare[1]), month: Number(bare[2]), day: Number(bare[3]) })
  const d = toDate(value)
  return d ? dayText(inIndia(d)) : EMPTY
}

/** "29 Sep", for chart axes and lists inside one year. */
export function formatDay(value: DateInput): string {
  const bare = typeof value === 'string' ? BARE_DATE.exec(value) : null
  if (bare) return dayText({ year: Number(bare[1]), month: Number(bare[2]), day: Number(bare[3]) }, false)
  const d = toDate(value)
  return d ? dayText(inIndia(d), false) : EMPTY
}

/** "2:05 pm", or "2:05:31 pm" with `seconds`. */
export function formatTime(value: DateInput, opts: { seconds?: boolean } = {}): string {
  const d = toDate(value)
  return d ? timeText(inIndia(d), opts.seconds) : EMPTY
}

/** "5 minutes ago" / "in 3 minutes". Pass `now` to keep a live list ticking. */
export function formatRelative(value: DateInput, now: number = Date.now()): string {
  const d = toDate(value)
  return d ? formatDistanceStrict(d, now, { addSuffix: true }) : EMPTY
}

/** The server says no record has that address: 404, or 400 for an id that is not even well formed. */
export function isNotFoundError(err: unknown): boolean {
  const status = (err as { response?: { status?: number } } | null)?.response?.status
  return status === 404 || status === 400
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
