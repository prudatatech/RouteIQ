import tokens from '@/theme/tokens.json'
import { statusToLabel, statusToTone, type Tone } from '@/components/ui/status'

/**
 * Map settings shared by every map in the app (see components/map/MapView).
 *
 * The base map is the Carto Positron vector style served from /map-style.json.
 * It needs no access token. A Mapbox token is optional and only used for
 * driving directions; without it routes are drawn as straight lines.
 */

/** Base map style. Local copy of Carto Positron (no token needed). */
export const MAP_STYLE_URL = '/map-style.json'

const envNumber = (value: string | undefined, fallback: number): number => {
  const n = Number(value)
  return value !== undefined && value !== '' && Number.isFinite(n) ? n : fallback
}

/** Default view: all of India. Override with VITE_MAP_CENTER_LNG/LAT and VITE_MAP_ZOOM. */
export const MAP_DEFAULTS = {
  CENTER: [
    envNumber(import.meta.env.VITE_MAP_CENTER_LNG, 81.0),
    envNumber(import.meta.env.VITE_MAP_CENTER_LAT, 22.5),
  ] as [number, number],
  ZOOM: envNumber(import.meta.env.VITE_MAP_ZOOM, 4.2),
  MIN_ZOOM: 3,
  MAX_ZOOM: 18,
}

/** Mapbox token for driving directions, or null when it is missing or still the placeholder. */
export const MAPBOX_TOKEN: string | null = (() => {
  const token = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined
  if (!token || /^your_mapbox_token/i.test(token)) return null
  return token
})()

/* ── Colours ────────────────────────────────────────────────────────────── */

/** Colour roles used on maps. Each maps to a theme token. */
export type MapTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'muted' | 'brand'

interface ToneStyle {
  /** Tailwind background class for DOM markers. */
  bg: string
  /** Raw colour for GL paint properties (lines, fills), which cannot read CSS variables. */
  color: string
}

const c = tokens.color

export const MAP_TONES: Record<MapTone, ToneStyle> = {
  success: { bg: 'bg-success', color: c.success },
  warning: { bg: 'bg-warning', color: c.warning },
  danger: { bg: 'bg-danger', color: c.danger },
  info: { bg: 'bg-info', color: c.info },
  neutral: { bg: 'bg-neutral', color: c.neutral },
  muted: { bg: 'bg-disabled', color: c.textDisabled },
  brand: { bg: 'bg-brand', color: c.accent },
}

/** Colours for GL layers (route line, geofences). */
export const MAP_COLORS = {
  route: c.accent,
  routeCasing: c.surface,
  plannedRoute: c.neutral,
}

interface StatusStyle {
  label: string
  tone: MapTone
}

/** Theme tone (components/ui/status.ts) -> map colour role. */
const TONE_TO_MAP_TONE: Record<Tone, MapTone> = {
  success: 'success', warning: 'warning', danger: 'danger', info: 'info', neutral: 'neutral', brand: 'brand',
}

/**
 * Vehicle status -> label and colour. It reads components/ui/status.ts, the single
 * source for how a status looks, so a vehicle is the same colour and name on a
 * map and in every table and pill.
 */
export function vehicleStatusStyle(status: string | null | undefined): StatusStyle {
  return { label: statusToLabel(status), tone: TONE_TO_MAP_TONE[statusToTone(status)] }
}

const humanize = (value: string) => {
  const text = value.replace(/[_-]+/g, ' ').trim()
  return text ? text[0].toUpperCase() + text.slice(1).toLowerCase() : 'Unknown'
}

/** Route stop status -> label and colour. */
const STOP_STATUS: Record<string, StatusStyle> = {
  pending: { label: 'Pending', tone: 'neutral' },
  arrived: { label: 'Arrived', tone: 'info' },
  completed: { label: 'Completed', tone: 'success' },
  delivered: { label: 'Delivered', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  skipped: { label: 'Skipped', tone: 'muted' },
}

export function stopStatusStyle(status: string | null | undefined): StatusStyle {
  const key = (status ?? 'pending').toLowerCase()
  return STOP_STATUS[key] ?? { label: humanize(key), tone: 'neutral' }
}
