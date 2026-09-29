/** India is UTC+5:30; every preset here is an IST calendar day, matching the backend's day boundaries. */
const IST_OFFSET_MS = 330 * 60 * 1000

function istDateString(daysAgo: number): string {
  return new Date(Date.now() + IST_OFFSET_MS - daysAgo * 86_400_000).toISOString().slice(0, 10)
}

export type DateRangePreset = 'today' | '7d' | '30d' | 'custom'

export interface DateRangeValue {
  preset: DateRangePreset
  /** YYYY-MM-DD, IST calendar day, inclusive. */
  from: string
  /** YYYY-MM-DD, IST calendar day, inclusive. */
  to: string
}

/** The from/to pair for a non-custom preset, as of now. */
export function presetRange(preset: Exclude<DateRangePreset, 'custom'>): { from: string; to: string } {
  const to = istDateString(0)
  if (preset === 'today') return { from: to, to }
  if (preset === '7d') return { from: istDateString(6), to }
  return { from: istDateString(29), to }
}

/** Today's date, as a default custom-range end. */
export const todayIST = () => istDateString(0)
