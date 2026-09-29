import type { ServiceItem } from '../health'

/**
 * How a bar in the vehicle condition card looks.
 *  ok       plenty left (green)
 *  watch    30% or less of the interval left (amber)
 *  urgent   10% or less left (red)
 *  overdue  past due (full red bar)
 *  unknown  nothing to measure from yet (grey)
 */
export type ConditionState = 'ok' | 'watch' | 'urgent' | 'overdue' | 'unknown'

export interface ConditionBar {
  key: string
  label: string
  state: ConditionState
  /** Share of the bar to fill, 0 to 1. An overdue bar is full. */
  fill: number
  /** What runs out first, e.g. "42 days left" or "Overdue by 320 km". */
  headline: string
  /** The other measure, e.g. "3,200 km left". */
  detail: string | null
}

/** At or below this share of the interval left, a bar turns amber. */
export const WATCH_SHARE = 0.3
/** At or below this share left, a bar turns red (it matches "due soon" on the server). */
export const URGENT_SHARE = 0.1

const km = (n: number) => `${Math.round(Math.abs(n)).toLocaleString('en-IN')} km`
const days = (n: number) => `${Math.abs(n)} ${Math.abs(n) === 1 ? 'day' : 'days'}`
const clamp = (n: number) => Math.max(0, Math.min(1, n))

interface Measure {
  kind: 'km' | 'days'
  remaining: number
  share: number
}

function stateOf(share: number, remaining: number): ConditionState {
  if (remaining < 0) return 'overdue'
  if (share <= URGENT_SHARE) return 'urgent'
  if (share <= WATCH_SHARE) return 'watch'
  return 'ok'
}

const phrase = (m: Measure) => {
  const text = m.kind === 'km' ? km(m.remaining) : days(m.remaining)
  return m.remaining < 0 ? `Overdue by ${text}` : `${text} left`
}

/** A service item's bar: days and km left, and whichever runs out first sets the colour. */
export function serviceBar(item: ServiceItem): ConditionBar {
  const measures: Measure[] = []
  if (item.km_remaining != null && item.interval_km) {
    measures.push({ kind: 'km', remaining: item.km_remaining, share: item.km_remaining / item.interval_km })
  }
  if (item.days_remaining != null && item.interval_days) {
    measures.push({ kind: 'days', remaining: item.days_remaining, share: item.days_remaining / item.interval_days })
  }
  if (measures.length === 0) {
    return { key: item.id, label: item.item, state: 'unknown', fill: 0, headline: 'Not tracked yet', detail: item.summary }
  }
  measures.sort((a, b) => a.share - b.share)
  const [first, second] = measures
  const state = stateOf(first.share, first.remaining)
  return {
    key: item.id,
    label: item.item,
    state,
    fill: state === 'overdue' ? 1 : clamp(first.share),
    headline: phrase(first),
    detail: second ? phrase(second) : null,
  }
}

/** Days from `today` (a YYYY-MM-DD day) to a YYYY-MM-DD date. */
export function daysBetween(today: string, date: string): number {
  return Math.round((Date.parse(`${date.slice(0, 10)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
}

/** Today's date in India as YYYY-MM-DD. */
export const istToday = (now: number = Date.now()): string => new Date(now + 330 * 60_000).toISOString().slice(0, 10)

/** Documents are counted against a year: amber inside 60 days, red inside 30, overdue once expired. */
const DOCUMENT_YEAR_DAYS = 365
const DOCUMENT_WATCH_DAYS = 60
const DOCUMENT_URGENT_DAYS = 30

export function documentBar(key: string, label: string, expiry: string | null | undefined, now: number = Date.now()): ConditionBar {
  if (!expiry || Number.isNaN(Date.parse(expiry))) {
    return { key, label, state: 'unknown', fill: 0, headline: 'No expiry on file', detail: null }
  }
  const left = daysBetween(istToday(now), expiry)
  const state: ConditionState = left < 0 ? 'overdue' : left <= DOCUMENT_URGENT_DAYS ? 'urgent' : left <= DOCUMENT_WATCH_DAYS ? 'watch' : 'ok'
  return {
    key,
    label,
    state,
    fill: state === 'overdue' ? 1 : clamp(left / DOCUMENT_YEAR_DAYS),
    headline: left < 0 ? `Expired ${days(left)} ago` : left === 0 ? 'Expires today' : `${days(left)} left`,
    detail: null,
  }
}

/** The vehicle columns that hold a document's expiry, in the order they are shown. */
export const DOCUMENT_FIELDS = [
  { key: 'rc_expiry', label: 'RC' },
  { key: 'insurance_expiry', label: 'Insurance' },
  { key: 'fitness_expiry', label: 'Fitness' },
  { key: 'permit_expiry', label: 'Permit' },
  { key: 'puc_expiry', label: 'PUC' },
] as const

/** Text for the odometer's last update: "Auto-synced 5 minutes ago from GPS". */
export function odometerNote(
  v: { odometer_updated_at: string | null; odometer_synced_at: string | null; odometer_source: string | null },
  relative: (value: string) => string,
): string {
  if (v.odometer_source === 'manual' && v.odometer_updated_at) return `Entered by hand ${relative(v.odometer_updated_at)}`
  if (v.odometer_synced_at) {
    const from = v.odometer_source === 'routes' ? ' from completed routes' : v.odometer_source === 'gps' ? ' from GPS' : ''
    return `Auto-synced ${relative(v.odometer_synced_at)}${from}`
  }
  if (v.odometer_updated_at) return `Counted from GPS distance, updated ${relative(v.odometer_updated_at)}`
  return 'Not synced yet. Enter the dashboard reading to start.'
}
