import { formatMinutes } from '@/utils/display'
import { summarizeCongestion } from './congestion'
import type { DrivingRoute } from './directions'

/** Traffic delay shorter than this is noise: shown as "no delay". */
export const MIN_REPORTED_DELAY_S = 60
/** Being this many minutes past the plan counts as late; inside it the trip is on time. */
export const ON_TIME_MARGIN_MIN = 5

export interface LiveEta {
  /** Distance still to drive, through every remaining stop. */
  remainingMeters: number
  /** Driving time to the last stop with live traffic. */
  etaSeconds: number
  /** The same drive with no traffic; null when unknown. */
  freeFlowSeconds: number | null
  /** Seconds traffic adds to the free-flow time (0 when none or unknown). */
  trafficDelaySeconds: number
  /** When the vehicle gets to the last stop if it keeps driving now. */
  arrivalAt: Date
  /** Planned arrival at the last stop, when the route has one. */
  plannedArrivalAt: Date | null
  /** Minutes later (+) or earlier (-) than the plan; null when there is no plan to compare with. */
  minutesVsPlan: number | null
  /** Metres of the remaining road that are slow, queuing or stopped; null when Mapbox has no traffic data. */
  slowMeters: number | null
}

/**
 * Remaining trip from a driving route that starts at the vehicle's position and runs through the
 * remaining stops. Pure, so the arithmetic is tested without a network.
 */
export function buildLiveEta(
  route: Pick<DrivingRoute, 'durationSeconds' | 'distanceMeters' | 'congestion' | 'segmentMeters'>,
  freeFlowSeconds: number | null,
  plannedArrivalAt: string | null | undefined,
  now: number = Date.now(),
): LiveEta {
  const arrivalAt = new Date(now + route.durationSeconds * 1000)
  const planned = plannedArrivalAt ? new Date(plannedArrivalAt) : null
  const plannedValid = planned !== null && Number.isFinite(planned.getTime()) ? planned : null
  const delay = freeFlowSeconds === null ? 0 : Math.max(0, route.durationSeconds - freeFlowSeconds)
  const congestion = summarizeCongestion(route.congestion, route.segmentMeters)
  return {
    remainingMeters: route.distanceMeters,
    etaSeconds: route.durationSeconds,
    freeFlowSeconds,
    trafficDelaySeconds: delay >= MIN_REPORTED_DELAY_S ? delay : 0,
    arrivalAt,
    plannedArrivalAt: plannedValid,
    minutesVsPlan: plannedValid ? Math.round((arrivalAt.getTime() - plannedValid.getTime()) / 60_000) : null,
    slowMeters: congestion.known ? congestion.slowMetres : null,
  }
}

export type PlanStatus = 'early' | 'on_time' | 'late'

/** On time within a few minutes either way; otherwise early or late. */
export function planStatus(minutesVsPlan: number): PlanStatus {
  if (minutesVsPlan > ON_TIME_MARGIN_MIN) return 'late'
  if (minutesVsPlan < -ON_TIME_MARGIN_MIN) return 'early'
  return 'on_time'
}

/** "12 min later than planned", "8 min ahead of plan", "On plan". */
export function describeVsPlan(minutesVsPlan: number): string {
  const status = planStatus(minutesVsPlan)
  if (status === 'on_time') return 'On plan'
  const m = Math.abs(minutesVsPlan)
  const text = m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`
  return status === 'late' ? `${text} behind plan` : `${text} ahead of plan`
}

/** "Traffic adds 12 min" or "No traffic delay", from the gap to the free-flow drive. */
export function trafficDelayText(eta: Pick<LiveEta, 'trafficDelaySeconds' | 'freeFlowSeconds'>): string | null {
  if (eta.freeFlowSeconds === null) return null
  return eta.trafficDelaySeconds > 0 ? `Traffic adds ${formatMinutes(eta.trafficDelaySeconds / 60)}` : 'No traffic delay'
}
