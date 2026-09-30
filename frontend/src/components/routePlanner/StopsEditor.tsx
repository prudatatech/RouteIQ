import { useState } from 'react'
import clsx from 'clsx'
import { ArrowDown, ArrowUp, GripVertical, PackagePlus, Trash2 } from 'lucide-react'
import { Button, IconButton, PlaceSearch, StatusPill } from '@/components/ui'
import type { ResolvedPlace } from '@/services/geocoding'
import { moveItem, stopFromPlace, type PlannerStop } from '@/utils/routePlanner'

const RECENT_KEY = 'route-planner'

/** A round number badge, the same number the map marker shows. */
function NumberBadge({ n }: { n: number }) {
  return (
    <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-text bg-surface text-xs font-semibold text-text">
      {n}
    </span>
  )
}

export interface StopsEditorProps {
  origin: ResolvedPlace | null
  onOrigin: (place: ResolvedPlace | null) => void
  destination: ResolvedPlace | null
  onDestination: (place: ResolvedPlace | null) => void
  stops: PlannerStop[]
  onStops: (stops: PlannerStop[]) => void
  maxStops: number
  /** Text under each stop, for example "Arrive 10:40 am". Index 0 is the start, the last is the end. */
  times?: (string | null)[]
  onOpenLoads: () => void
  /** Lets the start be set from the chosen vehicle's position. */
  vehicleStart?: { label: string; onUse: () => void; busy: boolean } | null
  /** Set when a drop comes before its pickup. */
  orderWarning?: string | null
  disabled?: boolean
}

/**
 * Start, end and the stops between them. Stops can be dragged, or moved with the arrow buttons
 * (which also work on a phone and with a keyboard).
 */
export default function StopsEditor({
  origin, onOrigin, destination, onDestination, stops, onStops, maxStops, times = [], onOpenLoads, vehicleStart, orderWarning, disabled,
}: StopsEditorProps) {
  const [dragging, setDragging] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  // Remounts the "add a stop" box after each pick so it is empty again
  const [addBox, setAddBox] = useState(0)
  const full = stops.length >= maxStops

  const move = (from: number, to: number) => onStops(moveItem(stops, from, to))
  const finishDrag = () => { setDragging(null); setOver(null) }

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-start gap-3">
          <div className="pt-8"><NumberBadge n={1} /></div>
          <PlaceSearch
            className="min-w-0 flex-1"
            label="Start"
            required
            placeholder="Where the truck starts"
            value={origin}
            onChange={onOrigin}
            recentPlacesKey={RECENT_KEY}
            disabled={disabled}
          />
        </div>
        {(times[0] || vehicleStart) && (
          <div className="mt-1 flex flex-wrap items-center gap-x-3 pl-9 text-xs text-muted">
            {times[0] && <span>{times[0]}</span>}
            {vehicleStart && (
              <Button variant="ghost" size="sm" loading={vehicleStart.busy} onClick={vehicleStart.onUse} disabled={disabled}>
                {vehicleStart.label}
              </Button>
            )}
          </div>
        )}
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-text">Stops <span className="font-normal text-muted">({stops.length} of {maxStops})</span></h3>
          <Button variant="secondary" size="sm" icon={<PackagePlus size={14} />} onClick={onOpenLoads} disabled={disabled || full}>
            From shipments and loads
          </Button>
        </div>

        {stops.length === 0 ? (
          <p className="rounded-control border border-dashed border-border-strong px-3 py-3 text-sm text-muted">
            No stops yet. Add addresses below, or pick up to {maxStops} pickup and drop points from open shipments and loads.
          </p>
        ) : (
          <ol className="space-y-2" aria-label="Stops in driving order">
            {stops.map((stop, i) => (
              <li
                key={stop.key}
                draggable={!disabled}
                onDragStart={e => { setDragging(i); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', stop.key) }}
                onDragOver={e => { if (dragging !== null) { e.preventDefault(); setOver(i) } }}
                onDrop={e => { e.preventDefault(); if (dragging !== null) move(dragging, i); finishDrag() }}
                onDragEnd={finishDrag}
                className={clsx(
                  'flex items-center gap-2 rounded-control border bg-surface px-2 py-2',
                  over === i && dragging !== null && dragging !== i ? 'border-brand' : 'border-border',
                  dragging === i && 'opacity-50',
                )}
              >
                <GripVertical size={16} aria-hidden="true" className="hidden shrink-0 cursor-grab text-muted sm:block" />
                <NumberBadge n={i + 2} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="truncate text-sm font-medium text-text">{stop.name}</span>
                    {stop.kind === 'pickup' && <StatusPill tone="success" dot={false}>Pickup</StatusPill>}
                    {stop.kind === 'drop' && <StatusPill tone="brand" dot={false}>Drop</StatusPill>}
                  </div>
                  <p className="truncate text-xs text-muted">{stop.address}</p>
                  {times[i + 1] && <p className="text-xs text-text">{times[i + 1]}</p>}
                </div>
                <div className="flex shrink-0 items-center">
                  <IconButton label={`Move ${stop.name} up`} icon={<ArrowUp size={16} />} variant="ghost" size="sm" disabled={disabled || i === 0} onClick={() => move(i, i - 1)} />
                  <IconButton label={`Move ${stop.name} down`} icon={<ArrowDown size={16} />} variant="ghost" size="sm" disabled={disabled || i === stops.length - 1} onClick={() => move(i, i + 1)} />
                  <IconButton label={`Remove ${stop.name}`} icon={<Trash2 size={16} />} variant="ghost" size="sm" disabled={disabled} onClick={() => onStops(stops.filter(s => s.key !== stop.key))} />
                </div>
              </li>
            ))}
          </ol>
        )}

        {orderWarning && (
          <p role="alert" className="mt-2 text-xs text-warning">{orderWarning} Move the pickup earlier, or the drop later.</p>
        )}

        <PlaceSearch
          key={addBox}
          className="mt-3"
          label="Add a stop"
          hideLabel
          placeholder={full ? `Up to ${maxStops} stops` : 'Add a stop: search an address'}
          value={null}
          onChange={place => { if (place) { onStops([...stops, stopFromPlace(place)]); setAddBox(n => n + 1) } }}
          recentPlacesKey={RECENT_KEY}
          disabled={disabled || full}
        />
        {full && <p className="mt-1 text-xs text-muted">That is the most stops one route can have.</p>}
      </div>

      <div>
        <div className="flex items-start gap-3">
          <div className="pt-8"><NumberBadge n={stops.length + 2} /></div>
          <PlaceSearch
            className="min-w-0 flex-1"
            label="End"
            required
            placeholder="Where the truck finishes"
            value={destination}
            onChange={onDestination}
            recentPlacesKey={RECENT_KEY}
            disabled={disabled}
          />
        </div>
        {times[stops.length + 1] && <p className="mt-1 pl-9 text-xs text-text">{times[stops.length + 1]}</p>}
      </div>
    </div>
  )
}
