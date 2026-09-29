import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Crosshair, MapPin } from 'lucide-react'
import toast from 'react-hot-toast'
import { Button, PlaceSearch } from '@/components/ui'
import { currentPosition, LocationError, reversePlace, type ResolvedPlace } from '@/services/geocoding'
import MapView from './MapView'
import type { LatLng, MapPointKind, MapViewHandle } from './types'

export interface AddressPickerProps {
  label: ReactNode
  value: ResolvedPlace | null
  onChange: (place: ResolvedPlace | null) => void
  required?: boolean
  error?: ReactNode
  hint?: ReactNode
  placeholder?: string
  /** Marker style on the map. */
  kind?: Extract<MapPointKind, 'pickup' | 'drop' | 'location' | 'hub'>
  /** Map height in pixels. */
  mapHeight?: number
  /** Hide the map (search and "use my location" only), for tight layouts. */
  showMap?: boolean
  /** Offer "Use my location" (useful for vendors at their premises; less so for a far destination). */
  allowCurrentLocation?: boolean
  /** Share recently used places between pickers with the same key (see PlaceSearch). */
  recentPlacesKey?: string
  className?: string
}

const PIN_ZOOM = 15

/** Plain coordinate label for a pin the geocoder could not name. */
const pinnedLabel = ({ lat, lng }: LatLng) => `Pinned location (${lat.toFixed(5)}, ${lng.toFixed(5)})`

/**
 * The one way to enter an address: search real places, use the device location,
 * or click the map and drag the pin to the exact gate or dock. Every route gives
 * coordinates, and address parts (city, state, PIN) when the geocoder has them.
 */
export default function AddressPicker({
  label, value, onChange, required, error, hint, placeholder, kind = 'location', mapHeight = 220,
  showMap = true, allowCurrentLocation = true, recentPlacesKey, className,
}: AddressPickerProps) {
  const map = useRef<MapViewHandle>(null)
  const [locating, setLocating] = useState(false)
  const [naming, setNaming] = useState(false)
  const lastFlown = useRef<string | null>(null)

  // Bring the map to a place chosen from search (not to pins the user just placed).
  useEffect(() => {
    if (!value) return
    const key = `${value.lat},${value.lng}`
    if (lastFlown.current === key) return
    lastFlown.current = key
    map.current?.flyTo({ lat: value.lat, lng: value.lng }, PIN_ZOOM)
  }, [value])

  const pinAt = async (position: LatLng, fly = false) => {
    lastFlown.current = fly ? null : `${position.lat},${position.lng}`
    onChange({ address: pinnedLabel(position), lat: position.lat, lng: position.lng })
    setNaming(true)
    const place = await reversePlace(position.lat, position.lng).catch(() => null)
    setNaming(false)
    if (place) {
      if (!fly) lastFlown.current = `${place.lat},${place.lng}`
      onChange(place)
    }
  }

  const useMyLocation = async () => {
    setLocating(true)
    try {
      const pos = await currentPosition()
      await pinAt({ lat: pos.lat, lng: pos.lng }, true)
    } catch (err) {
      toast.error(err instanceof LocationError ? err.message : 'Could not find your location.')
    } finally {
      setLocating(false)
    }
  }

  return (
    <div className={className}>
      <PlaceSearch
        label={label}
        required={required}
        error={error}
        hint={hint}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        recentPlacesKey={recentPlacesKey}
      />

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        {allowCurrentLocation && (
          <Button variant="ghost" size="sm" icon={<Crosshair size={14} />} loading={locating} onClick={useMyLocation}>
            Use my location
          </Button>
        )}
        {showMap && (
          <span className="text-xs text-muted">
            {value ? 'Drag the pin to the exact spot if needed.' : 'Or click the map to drop a pin.'}
          </span>
        )}
      </div>

      {showMap && (
        <div className="mt-2 overflow-hidden rounded-control border border-border">
          <MapView
            ref={map}
            mode="picker"
            height={mapHeight}
            points={value ? [{
              id: 'pin', kind, position: { lat: value.lat, lng: value.lng }, label: `Chosen place: ${value.address}`, draggable: true,
            }] : []}
            onPick={position => pinAt(position)}
            onPointMove={(_, position) => pinAt(position)}
            fitTo="none"
            initialCenter={value ? { lat: value.lat, lng: value.lng } : undefined}
            initialZoom={value ? PIN_ZOOM : undefined}
            controls={{ zoom: true, fullscreen: false, recenter: false }}
            ariaLabel={`Map for ${typeof label === 'string' ? label.toLowerCase() : 'the address'}. Click to drop a pin.`}
          />
        </div>
      )}

      {value && (
        <p className="mt-1.5 flex items-start gap-1.5 text-xs text-muted" aria-live="polite">
          <MapPin size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            {naming ? 'Finding the address…' : value.address}
            <span className="mono ml-1.5">{value.lat.toFixed(5)}, {value.lng.toFixed(5)}</span>
          </span>
        </p>
      )}
    </div>
  )
}
