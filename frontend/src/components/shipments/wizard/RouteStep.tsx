import { useState } from 'react'
import clsx from 'clsx'
import { MapPin, X } from 'lucide-react'
import { Checkbox, IconButton, Input, PlaceSearch } from '@/components/ui'
import { AddressPicker, MapView, type LatLng, type MapPoint } from '@/components/map'
import { reversePlace, type ResolvedPlace } from '@/services/geocoding'
import type { StepProps } from './stepProps'
import { todayIso } from './validation'
import DropsEditor from './DropsEditor'

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
  if (origin) points.push({ id: 'pickup', kind: 'pickup', label: `Pickup: ${origin.address ?? ''}`, position: { lat: origin.lat, lng: origin.lng }, draggable: true })
  stops.forEach((s, i) => {
    if (!s.lat || !s.lng) return
    points.push({ id: s.id || `stop-${i}`, kind: 'location', label: `Stop ${i + 1}: ${s.name}`, position: { lat: s.lat, lng: s.lng }, draggable: true })
  })
  if (destination) points.push({ id: 'drop', kind: 'drop', label: `Destination: ${destination.address ?? ''}`, position: { lat: destination.lat, lng: destination.lng }, draggable: true })
  return points
}

export default function RouteStep({ data, update, errors }: StepProps) {
  // Remounts the stop search after each pick so it starts empty again.
  const [stopSearchKey, setStopSearchKey] = useState(0)
  const stops = data.stops || []
  const multi = !!data.multi_drop
  const drops = data.drops || []
  const placedDrops = drops.filter(d => d.lat && d.lng)

  const origin = data.origin_lat && data.origin_lng
    ? { address: data.origin_address || data.origin_name, lat: data.origin_lat, lng: data.origin_lng }
    : null
  const destination = data.dest_lat && data.dest_lng
    ? { address: data.delivery_point_address || data.delivery_point_name, lat: data.dest_lat, lng: data.dest_lng }
    : null

  const setOrigin = (place: ResolvedPlace | null) => update(place
    ? { origin_name: nameOf(place), origin_address: place.address, origin_lat: place.lat, origin_lng: place.lng }
    : { origin_name: '', origin_address: '', origin_lat: 0, origin_lng: 0 })
  const setDestination = (place: ResolvedPlace | null) => update(place
    ? { delivery_point_name: nameOf(place), delivery_point_address: place.address, dest_lat: place.lat, dest_lng: place.lng }
    : { delivery_point_name: '', delivery_point_address: '', dest_lat: 0, dest_lng: 0 })

  /** A pin placed on the map, named by reverse lookup (coordinates when no name is found). */
  const placeAt = async (position: LatLng): Promise<ResolvedPlace> =>
    (await reversePlace(position.lat, position.lng).catch(() => null))
      ?? { address: `Pinned location (${position.lat.toFixed(5)}, ${position.lng.toFixed(5)})`, lat: position.lat, lng: position.lng }

  // Clicking the map fills the pickup first, then the destination (drops are added by search).
  const onPick = async (position: LatLng) => {
    if (multi) {
      if (!origin) setOrigin(await placeAt(position))
      return
    }
    if (origin && destination) return
    const place = await placeAt(position)
    if (!origin) setOrigin(place)
    else setDestination(place)
  }

  const onPointMove = async (id: string, position: LatLng) => {
    const place = await placeAt(position)
    if (id === 'pickup') setOrigin(place)
    else if (id === 'drop') setDestination(place)
    else if (drops.some(d => d.id === id)) update({ drops: drops.map(d => (d.id === id ? { ...d, name: nameOf(place), address: place.address, lat: place.lat, lng: place.lng } : d)) })
    else update({ stops: stops.map(s => (s.id === id ? { ...s, name: nameOf(place), address: place.address, lat: place.lat, lng: place.lng } : s)) })
  }

  return (
    <div className="space-y-5">
      <AddressPicker
        label="Pickup"
        required
        kind="pickup"
        showMap={false}
        placeholder="Where is the cargo collected?"
        value={origin && { address: origin.address ?? '', lat: origin.lat, lng: origin.lng }}
        error={errors.origin}
        recentPlacesKey={RECENT_PLACES_KEY}
        onChange={setOrigin}
      />
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-text">Deliver to</legend>
        <div role="radiogroup" aria-label="Deliver to" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {([
            { id: false, label: 'One destination', description: 'All the goods go to one place' },
            { id: true, label: 'Several drops', description: 'Split across consignees; each drop is a lot' },
          ] as const).map(option => (
            <label
              key={String(option.id)}
              className={clsx(
                'flex cursor-pointer items-start gap-3 rounded-control border p-3 transition-colors',
                multi === option.id ? 'border-brand bg-brand-soft' : 'border-border-strong hover:bg-surface-subtle',
              )}
            >
              <input
                type="radio"
                name="deliver_to"
                checked={multi === option.id}
                onChange={() => update(option.id ? { multi_drop: true, stops: [] } : { multi_drop: false })}
                className="mt-0.5 h-4 w-4 shrink-0 accent-brand"
              />
              <span className="text-sm">
                <span className="block font-medium text-text">{option.label}</span>
                <span className="block text-muted">{option.description}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {multi ? (
        <DropsEditor drops={drops} onChange={next => update({ drops: next })} errors={errors} recentPlacesKey={RECENT_PLACES_KEY} />
      ) : (
        <AddressPicker
          label="Destination"
          required
          kind="drop"
          showMap={false}
          allowCurrentLocation={false}
          placeholder="Where is it going?"
          value={destination && { address: destination.address ?? '', lat: destination.lat, lng: destination.lng }}
          error={errors.destination}
          recentPlacesKey={RECENT_PLACES_KEY}
          onChange={setDestination}
        />
      )}

      <div>
        <div className="overflow-hidden rounded-card border border-border">
          <MapView
            mode={multi ? (origin && placedDrops.length > 0 ? 'route' : 'picker') : origin && destination ? 'route' : 'picker'}
            height={260}
            onPick={multi ? (origin ? undefined : onPick) : origin && destination ? undefined : onPick}
            onPointMove={onPointMove}
            points={multi
              ? [
                ...routePoints(origin, null, []),
                ...placedDrops.map((d, i): MapPoint => ({
                  id: d.id, kind: 'drop', label: `Drop ${i + 1}: ${d.consignee_name || d.name}`, position: { lat: d.lat, lng: d.lng }, draggable: true,
                })),
              ]
              : routePoints(origin, destination, stops)}
            route={multi
              ? (origin && placedDrops.length > 0 ? { coordinates: [origin, ...placedDrops].map(p => [p.lng, p.lat] as [number, number]), planned: true } : null)
              : origin && destination
                ? {
                  coordinates: [origin, ...stops.filter(s => s.lat && s.lng), destination].map(p => [p.lng, p.lat] as [number, number]),
                  planned: true,
                }
                : null}
            ariaLabel="Map of the pickup, stops and destination. Click to place a pin, drag pins to adjust."
          />
        </div>
        <p className="mt-1.5 text-xs text-muted">
          {!origin ? 'Click the map to set the pickup, or search above.'
            : multi ? (placedDrops.length === 0 ? 'Add the drops above; they appear on the map.' : 'Drag any pin to the exact gate or dock.')
              : !destination ? 'Click the map to set the destination, or search above.'
                : 'Drag any pin to the exact gate or dock.'}
        </p>
      </div>

      {!multi && <div className="space-y-2">
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
      </div>}

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
