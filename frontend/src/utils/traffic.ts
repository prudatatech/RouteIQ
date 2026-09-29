/** Plain-language cause, e.g. "Accident on NH48, +25 min". */
export function describeIncident(i: { type: string; road: string | null; delay_seconds: number | null }): string {
  const on = i.road ? ` on ${i.road}` : ''
  const delay = i.delay_seconds && i.delay_seconds >= 60 ? `, +${Math.round(i.delay_seconds / 60)} min` : ''
  return `${i.type}${on}${delay}`
}
