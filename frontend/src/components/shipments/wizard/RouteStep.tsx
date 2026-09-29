import { useState } from 'react'
import { MapPin, X } from 'lucide-react'
import { Checkbox, IconButton, Input, PlaceSearch } from '@/components/ui'
import { MapView, type MapPoint } from '@/components/map'
import type { ResolvedPlace } from '@/services/geocoding'
import type { StepProps } from './stepProps'
import { todayIso } from './validation'

const nameOf = (place: ResolvedPlace) => place.address.split(', ')[0] || place.address
/** Keeps the create-shipment wizard's recent addresses separate from other place pickers. */
const RECENT_PLACES_KEY = 'wizard-route'

/** Pickup, extra stops and destination as map points for the route preview. */
function routePoints(
  origin: { address?: string | null; lat: number; lng: number } | null,
  destination: { address?: string | null; lat: number; lng: number } | null,
  stops: { id: string; name: string; address: string; lat: number; lng: number }[],
): MapPoint[] {
  const points: MapPoint[] = []
  if (origin) points.push({ id: 'pickup', kind: 'pickup', label: `Pickup: ${origin.address ?? ''}`, position: { lat: origin.lat, lng: origin.lng } })
  stops.forEach((s, i) => {
    if (!s.lat || !s.lng) return
    points.push({ id: s.id || `stop-${i}`, kind: 'location', label: `Stop ${i + 1}: ${s.name}`, position: { lat: s.lat, lng: s.lng } })
  })
  if (destination) points.push({ id: 'drop', kind: 'drop', label: `Destination: ${destination.address ?? ''}`, position: { lat: destination.lat, lng: destination.lng } })
  return points
}

export default function RouteStep({ data, update, errors }: StepProps) {
  // Remounts the stop search after each pick so it starts empty again.
  const [stopSearchKey, setStopSearchKey] = useState(0)
  const stops = data.stops || []

  const origin = data.origin_lat && data.origin_lng
    ? { address: data.origin_address || data.origin_name, lat: data.origin_lat, lng: data.origin_lng }
    : null
  const destination = data.dest_lat && data.dest_lng
    ? { address: data.delivery_point_address || data.delivery_point_name, lat: data.dest_lat, lng: data.dest_lng }
    : null

  return (
    <div className="space-y-5">
      <PlaceSearch
        label="Pickup"
        required
        placeholder="Where is the cargo collected?"
        value={origin}
        error={errors.origin}
        recentPlacesKey={RECENT_PLACES_KEY}
        onChange={place => update(place
          ? { origin_name: nameOf(place), origin_address: place.address, origin_lat: place.lat, origin_lng: place.lng }
          : { origin_name: '', origin_address: '', origin_lat: 0, origin_lng: 0 })}
      />
      <PlaceSearch
        label="Destination"
        required
        placeholder="Where is it going?"
        value={destination}
        error={errors.destination}
        recentPlacesKey={RECENT_PLACES_KEY}
        onChange={place => update(place
          ? { delivery_point_name: nameOf(place), delivery_point_address: place.address, dest_lat: place.lat, dest_lng: place.lng }
          : { delivery_point_name: '', delivery_point_address: '', dest_lat: 0, dest_lng: 0 })}
      />

      {(origin || destination) && (
        <div className="overflow-hidden rounded-card border border-border">
          <MapView
            mode={origin && destination ? 'route' : 'picker'}
            height={220}
            interactive={false}
            points={routePoints(origin, destination, stops)}
            route={origin && destination
              ? {
                coordinates: [origin, ...stops.filter(s => s.lat && s.lng), destination].map(p => [p.lng, p.lat] as [number, number]),
                planned: true,
              }
              : null}
            ariaLabel="Preview of the pickup, stops and destination"
          />
        </div>
      )}

      <div className="space-y-2">
        <PlaceSearch
          key={stopSearchKey}
          label="Extra stops"
          hint="Optional. Stops are visited nearest-first from the pickup, before the destination."
          placeholder="Add a stop on the way"
          value={null}
          recentPlacesKey={RECENT_PLACES_KEY}
          onChange={place => {
            if (!place) return
            update({
              stops: [...stops, { id: `stop-${Date.now()}`, name: nameOf(place), address: place.address, lat: place.lat, lng: place.lng }],
            })
            setStopSearchKey(k => k + 1)
          }}
        />
        {stops.length > 0 && (
          <ul className="divide-y divide-border rounded-control border border-border">
            {stops.map((stop, i) => (
              <li key={stop.id || i} className="flex items-center gap-3 px-3 py-2">
                <MapPin size={16} aria-hidden="true" className="shrink-0 text-muted" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-text">{stop.name}</div>
                  <div className="truncate text-xs text-muted">{stop.address}</div>
                </div>
                <IconButton
                  size="sm"
                  label={`Remove stop ${stop.name}`}
                  icon={<X size={16} />}
                  onClick={() => update({ stops: stops.filter((_, j) => j !== i) })}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-3 border-t border-border pt-5">
        <Checkbox
          label="Plan for a later date"
          description="Leave unticked to dispatch today."
          checked={data.plan_for_later}
          onChange={e => update({ plan_for_later: e.target.checked })}
        />
        {data.plan_for_later && (
          <Input
            label="Dispatch date"
            type="date"
            required
            min={todayIso()}
            value={data.scheduled_date}
            error={errors.scheduled_date}
            onChange={e => update({ scheduled_date: e.target.value })}
            className="sm:max-w-xs"
          />
        )}
      </div>
    </div>
  )
}
