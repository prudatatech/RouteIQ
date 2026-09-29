import { memo, useEffect, useRef, useState, type MouseEvent } from 'react'
import { Marker, type MarkerDragEvent } from 'react-map-gl/maplibre'
import { Bike, Boxes, Bus, Car, Flag, MapPin, Package, TriangleAlert, Truck, Warehouse, type LucideIcon } from 'lucide-react'
import clsx from 'clsx'
import { MAP_TONES, stopStatusStyle, vehicleStatusStyle } from '@/config/mapConfig'
import { animateMarkerAlongRoute } from '@/utils/mapAnimation'
import { POINT_TONES } from './layers'
import type { VehicleCluster } from './cluster'
import type { LatLng, MapPoint, MapPointKind, MapRouteStop, MapVehicle } from './types'

/** How long a vehicle takes to glide to a new position. */
const MOVE_DURATION_MS = 1500

const POINT_KINDS: Record<MapPointKind, { icon: LucideIcon; name: string }> = {
  pickup: { icon: Package, name: 'Pickup' },
  drop: { icon: Flag, name: 'Drop' },
  incident: { icon: TriangleAlert, name: 'Incident' },
  hub: { icon: Warehouse, name: 'Hub' },
  load: { icon: Boxes, name: 'Open load' },
  location: { icon: MapPin, name: 'Location' },
}

const VEHICLE_ICONS: Record<string, { icon: LucideIcon; name: string }> = {
  truck: { icon: Truck, name: 'truck' },
  van: { icon: Bus, name: 'van' },
  bike: { icon: Bike, name: 'bike' },
  car: { icon: Car, name: 'car' },
}

/** Clicks on markers must not also count as a click on the map (picker mode). */
const stop = (e: MouseEvent) => e.stopPropagation()

/**
 * Position that glides to `target` whenever it changes, along `route` when the
 * vehicle is on it. Returns the position to draw.
 */
function useAnimatedPosition(target: LatLng, route?: [number, number][]): LatLng {
  const [position, setPosition] = useState(target)
  const current = useRef(target)
  const routeRef = useRef(route)
  routeRef.current = route

  useEffect(() => {
    const from = current.current
    if (from.lat === target.lat && from.lng === target.lng) return
    return animateMarkerAlongRoute({
      startCoord: [from.lng, from.lat],
      endCoord: [target.lng, target.lat],
      routeCoords: routeRef.current,
      duration: MOVE_DURATION_MS,
      onTick: ([lng, lat]) => {
        current.current = { lat, lng }
        setPosition({ lat, lng })
      },
    })
  }, [target.lat, target.lng])

  return position
}

interface VehicleMarkerProps {
  vehicle: MapVehicle
  selected: boolean
  showLabel: boolean
  /** Road geometry the vehicle is driving, so it glides along the road. */
  route?: [number, number][]
  onSelect?: (id: string) => void
}

export const VehicleMarker = memo(function VehicleMarker({ vehicle, selected, showLabel, route, onSelect }: VehicleMarkerProps) {
  const position = useAnimatedPosition(vehicle.position, route)
  const status = vehicleStatusStyle(vehicle.status)
  const tone = MAP_TONES[status.tone]
  const kind = VEHICLE_ICONS[(vehicle.vehicle_type ?? '').toLowerCase()] ?? VEHICLE_ICONS.truck
  const KindIcon = kind.icon
  const hasHeading = typeof vehicle.heading === 'number' && Number.isFinite(vehicle.heading)

  return (
    <Marker longitude={position.lng} latitude={position.lat} anchor="center" style={{ zIndex: selected ? 3 : 1 }}>
      <button
        type="button"
        aria-label={`${vehicle.label}, ${vehicle.vehicle_type ? `${kind.name}, ` : ''}${status.label}`}
        aria-pressed={selected}
        title={`${vehicle.label} · ${status.label}`}
        onClick={(e) => { stop(e); onSelect?.(vehicle.id) }}
        className="relative flex items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        {hasHeading && (
          <span
            aria-hidden
            className="absolute inset-0 flex justify-center"
            style={{ transform: `rotate(${vehicle.heading}deg)` }}
          >
            <span className="-mt-1.5 h-0 w-0 border-x-4 border-b-[6px] border-x-transparent border-b-text" />
          </span>
        )}
        <span
          className={clsx(
            'flex items-center justify-center rounded-full border-2 border-surface text-white shadow-raised transition-transform',
            tone.bg,
            selected ? 'h-9 w-9 ring-2 ring-brand ring-offset-1' : 'h-8 w-8',
          )}
        >
          <KindIcon size={16} aria-hidden />
        </span>
        {(selected || showLabel) && (
          <span className="pointer-events-none absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded-full border border-border bg-surface px-2 py-0.5 text-xs font-medium text-text shadow-raised">
            <span className="mono">{vehicle.label}</span> · {status.label}
          </span>
        )}
      </button>
    </Marker>
  )
})

interface PointMarkerProps {
  point: MapPoint
  selected: boolean
  onSelect?: (id: string) => void
  onMove?: (id: string, position: LatLng) => void
}

export const PointMarker = memo(function PointMarker({ point, selected, onSelect, onMove }: PointMarkerProps) {
  const kind = POINT_KINDS[point.kind]
  const tone = MAP_TONES[point.muted ? 'muted' : POINT_TONES[point.kind]]
  const Icon = kind.icon
  const pulsing = point.kind === 'incident' && point.active

  return (
    <Marker
      longitude={point.position.lng}
      latitude={point.position.lat}
      anchor="center"
      draggable={point.draggable}
      onDragEnd={(e: MarkerDragEvent) => onMove?.(point.id, { lat: e.lngLat.lat, lng: e.lngLat.lng })}
      style={{ zIndex: selected ? 3 : 2 }}
    >
      <button
        type="button"
        aria-label={point.label || kind.name}
        aria-pressed={onSelect ? selected : undefined}
        title={point.label || kind.name}
        onClick={(e) => { stop(e); onSelect?.(point.id) }}
        className={clsx(
          'relative flex items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
          point.draggable ? 'cursor-grab active:cursor-grabbing' : onSelect ? 'cursor-pointer' : 'cursor-default',
        )}
      >
        {pulsing && <span aria-hidden className="absolute inset-0 rounded-full bg-danger/30 motion-safe:animate-ping" />}
        <span
          className={clsx(
            'relative flex items-center justify-center rounded-full border-2 border-surface text-white shadow-raised',
            tone.bg,
            selected ? 'h-9 w-9 ring-2 ring-brand ring-offset-1' : 'h-7 w-7',
          )}
        >
          <Icon size={14} aria-hidden />
        </span>
      </button>
    </Marker>
  )
})

export const StopMarker = memo(function StopMarker({ stop: routeStop }: { stop: MapRouteStop }) {
  const status = stopStatusStyle(routeStop.status)
  const pending = (routeStop.status ?? 'pending') === 'pending'
  const name = routeStop.label ? `Stop ${routeStop.sequence}, ${routeStop.label}` : `Stop ${routeStop.sequence}`

  return (
    <Marker longitude={routeStop.position.lng} latitude={routeStop.position.lat} anchor="center" style={{ zIndex: 1 }}>
      <span
        role="img"
        aria-label={`${name}, ${status.label}`}
        title={`${name} · ${status.label}`}
        className={clsx(
          'flex h-6 w-6 items-center justify-center rounded-full border-2 text-xs font-semibold shadow-raised',
          pending ? 'border-text bg-surface text-text' : clsx('border-surface text-white', MAP_TONES[status.tone].bg),
        )}
      >
        {routeStop.sequence}
      </span>
    </Marker>
  )
})

/** A count of nearby vehicles. Activating it zooms in on the group. */
export const ClusterMarker = memo(function ClusterMarker({ cluster, onOpen }: {
  cluster: VehicleCluster
  onOpen: (cluster: VehicleCluster) => void
}) {
  return (
    <Marker longitude={cluster.position.lng} latitude={cluster.position.lat} anchor="center" style={{ zIndex: 2 }}>
      <button
        type="button"
        aria-label={`${cluster.count} vehicles close together. Zoom in to see them.`}
        title={`${cluster.count} vehicles`}
        onClick={(e) => { stop(e); onOpen(cluster) }}
        className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-surface bg-brand-fill text-sm font-semibold text-white shadow-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        {cluster.count.toLocaleString('en-IN')}
      </button>
    </Marker>
  )
})
