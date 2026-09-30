import type { StyleSpecification } from 'maplibre-gl'
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

/**
 * Base maps the layer switcher offers. All are free and need no token:
 * Carto (streets, dark) and Esri's public tile services (satellite, terrain).
 *
 * None of them may draw its own country borders: India's official boundaries are drawn on
 * top by MapView (components/map/indiaBorders.ts), and the vector styles' border layers are
 * hidden. That is why terrain is the street map with a relief layer (TERRAIN_HILLSHADE), not a
 * topographic map with borders baked into the image.
 */
export type BaseStyleId = 'streets' | 'satellite' | 'terrain' | 'dark'

interface RasterLayerSpec {
  tiles: string[]
  attribution: string
  maxzoom: number
}

const rasterStyle = (name: string, ...layers: RasterLayerSpec[]): StyleSpecification => ({
  version: 8,
  name,
  sources: Object.fromEntries(layers.map((l, i) => [
    `base-${i}`,
    { type: 'raster' as const, tiles: l.tiles, tileSize: 256, maxzoom: l.maxzoom, attribution: l.attribution },
  ])),
  layers: layers.map((_, i) => ({ id: `base-${i}`, type: 'raster' as const, source: `base-${i}` })),
})

/** Colour of India's-view country borders on a base map, with a casing on imagery. */
export interface BorderStyle {
  color: string
  casing?: string
}

export const BASE_STYLES: Record<BaseStyleId, { label: string; style: string | StyleSpecification; border: BorderStyle }> = {
  streets: { label: 'Streets', style: MAP_STYLE_URL, border: { color: '#d4b3b6' } },
  satellite: {
    label: 'Satellite',
    style: rasterStyle('Satellite', {
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
      maxzoom: 18,
    }),
    border: { color: '#ffffff', casing: '#1f2933' },
  },
  // The street map with Esri's relief shading under its roads and labels
  terrain: { label: 'Terrain', style: MAP_STYLE_URL, border: { color: '#b08f93' } },
  dark: { label: 'Dark', style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json', border: { color: '#707070' } },
}

/** Relief shading drawn under the street map's water, roads and labels for the terrain base map. */
export const TERRAIN_HILLSHADE = {
  tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}'],
  attribution: 'Relief © Esri, USGS, NGA, NASA',
  maxzoom: 16,
  /** A street-map layer it goes under (map-style.json). */
  beforeId: 'waterway',
  opacity: 0.45,
}

export const BASE_STYLE_IDS = Object.keys(BASE_STYLES) as BaseStyleId[]

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
  trail: c.info,
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
