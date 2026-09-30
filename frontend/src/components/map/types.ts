import type { ReactNode } from 'react'
import type { BaseStyleId } from '@/config/mapConfig'
import type { CongestionLevel } from './congestion'

/** A position on the map. */
export interface LatLng {
  lat: number
  lng: number
}

/** A vehicle drawn on the map. Positions that change are animated smoothly. */
export interface MapVehicle {
  id: string
  position: LatLng
  /** Vehicle status key, for example "on_route" or "available" (see VEHICLE_STATUS). */
  status: string
  /** Direction of travel in degrees clockwise from north. Shows an arrow when set. */
  heading?: number | null
  /** Plate number or other short name. Used for the visible label and the screen-reader label. */
  label: string
  /** truck, van, bike or car. Chooses the marker icon; anything else (or unset) draws a truck. */
  vehicle_type?: string | null
}

/** A stop on a route. */
export interface MapRouteStop {
  id: string
  position: LatLng
  /** 1-based order along the route. Shown inside the marker. */
  sequence: number
  /** Stop status key, for example "pending" or "completed" (see STOP_STATUS). */
  status?: string
  /** Place or customer name, for the screen-reader label. */
  label?: string
}

/** A route line with optional numbered stops. */
export interface MapRoute {
  /** Line geometry as GeoJSON [lng, lat] pairs. May be empty when only stops are known. */
  coordinates: [number, number][]
  stops?: MapRouteStop[]
  /** Draw a dashed line: the path is a plan or a straight-line estimate, not a driven road. */
  planned?: boolean
  /**
   * Congestion of each segment of `coordinates` (one entry fewer than coordinates), from Mapbox
   * driving-traffic. When set, the line is coloured by it instead of one flat colour.
   */
  congestion?: CongestionLevel[]
}

/** Live traffic drawn on the map. Staff only: both need a signed-in staff user. */
export interface MapTraffic {
  /** Colour-coded congestion on the roads, with a legend. Drawn over the base map, under everything else. */
  flow?: boolean
  /** Accidents, road works, closures and other incidents in view, grouped when zoomed out. */
  incidents?: boolean
}

/** A driven path drawn as a line (a vehicle's trail from its GPS history). */
export interface MapTrail {
  id: string
  /** GeoJSON [lng, lat] pairs, oldest first. */
  coordinates: [number, number][]
}

export type MapPointKind = 'pickup' | 'drop' | 'incident' | 'hub' | 'load' | 'location'

/** Any other marker: pickup, drop, SOS/incident, hub, open load or a picked location. */
export interface MapPoint {
  id: string
  kind: MapPointKind
  position: LatLng
  /** What the point is, for example "Pickup: Andheri East". Used for the screen-reader label. */
  label: string
  /** Incident only: an open SOS. Gets the one pulsing ring allowed on maps. */
  active?: boolean
  /** Draw in a muted grey instead of the kind's colour, for something that is over (a resolved incident). */
  muted?: boolean
  /** Draw a geofence circle of this radius (kilometres) around the point. */
  radiusKm?: number
  /** Let the user drag the point (picker mode). Reported through onPointMove. */
  draggable?: boolean
}

/**
 * Presets that only choose defaults. Every default can be overridden by its own prop.
 * - fleet: many vehicles; fit once, labels on selection, legend, fly to selection.
 * - route: one route with stops; refit whenever the route changes.
 * - incident: SOS points; refit on change, fly to the selected incident.
 * - tracking: one vehicle to a destination; fit once, then follow the vehicle.
 * - picker: choose a location; click to pick, refit when points change.
 */
export type MapMode = 'fleet' | 'route' | 'incident' | 'tracking' | 'picker'

/**
 * When the camera moves to show everything on the map.
 * - initial: once, when there is first something to show.
 * - content: again whenever the set of things changes (not when a vehicle just moves).
 * - none: never; the map stays on its initial view.
 */
export type MapFit = 'initial' | 'content' | 'none'

export interface MapControls {
  zoom?: boolean
  fullscreen?: boolean
  /** Button that fits the content again (or re-centres on the followed vehicle). */
  recenter?: boolean
}

export interface MapViewProps {
  mode?: MapMode
  vehicles?: MapVehicle[]
  route?: MapRoute | null
  /** Driven paths, drawn under the vehicles. */
  trails?: MapTrail[]
  points?: MapPoint[]
  /** Id of the selected vehicle or point. */
  selectedId?: string | null
  /** Called with the id of a clicked vehicle or point. */
  onSelect?: (id: string) => void
  fitTo?: MapFit
  /** Space in pixels kept around content when fitting, e.g. to clear an overlay card. Default 48. */
  fitPadding?: number | { top: number; bottom: number; left: number; right: number }
  /** Move the camera to a vehicle or point when it becomes selected. */
  flyToSelected?: boolean
  /**
   * Keep this vehicle centred as it moves. `true` follows the selected vehicle,
   * or the only vehicle. Dragging the map pauses following; recenter resumes it.
   */
  follow?: boolean | string
  /** false turns off panning, zooming and clicking (for small previews). Default true. */
  interactive?: boolean
  controls?: MapControls
  /** Live traffic: flow colours and incident icons. Off by default. */
  traffic?: MapTraffic
  /** Base map (streets, satellite, terrain, dark). Default streets. */
  baseStyle?: BaseStyleId
  /** Group nearby vehicles into clusters when there are many. Default true. */
  clusters?: boolean
  /** Show a legend of the vehicle statuses on the map. */
  showLegend?: boolean
  /** Always show vehicle labels, not only for the selected vehicle. */
  showLabels?: boolean
  /** Called with the clicked position. Enables picking (crosshair cursor). */
  onPick?: (position: LatLng) => void
  /** Called when a draggable point is dropped at a new position. */
  onPointMove?: (id: string, position: LatLng) => void
  /** Start view when there is nothing to fit. Defaults to India. */
  initialCenter?: LatLng
  initialZoom?: number
  /** Tilt in degrees (driver navigation uses 60). */
  pitch?: number
  /** CSS height, for example 400 or "60vh". Without it the map fills its parent (min 320 px). */
  height?: number | string
  className?: string
  /** Accessible name of the map region. Default "Map". */
  ariaLabel?: string
  /** Overlays (info cards, search) drawn above the map. */
  children?: ReactNode
}

/** Imperative handle, for camera moves the parent triggers (search results, "zoom to" buttons). */
export interface MapViewHandle {
  flyTo: (position: LatLng, zoom?: number) => void
  fitToContent: () => void
}
