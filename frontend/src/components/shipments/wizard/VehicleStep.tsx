import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import { Copy, LocateFixed } from 'lucide-react'
import {
  Alert, Button, Checkbox, EmptyState, IconButton, Input, Select, Skeleton, StatusPill, statusToLabel,
} from '@/components/ui'
import LiveMap from '@/components/map/LiveMap'
import { capacityAPI, telemetryAPI, vehiclesAPI } from '@/services/api'
import { reversePlace } from '@/services/geocoding'
import { apiErrorMessage, freeCapacityKg, haversineKm } from '../format'
import type { VehicleOption } from '../types'
import type { StepProps } from './stepProps'
import { formatKg, formatKm } from '@/utils/display'

const BIDDING_WINDOWS = [5, 10, 15, 30]

interface NearbyVendor {
  id?: string
  company_name?: string | null
  city?: string | null
  distance_km?: number | null
}

export default function VehicleStep({ data, update, errors }: StepProps) {
  const [mobileLink, setMobileLink] = useState('')
  const [creatingLink, setCreatingLink] = useState(false)
  const [locating, setLocating] = useState(false)

  const { data: vehicles = [], isLoading, isError, refetch } = useQuery<VehicleOption[]>({
    queryKey: ['vehicles'],
    queryFn: () => vehiclesAPI.list() as Promise<VehicleOption[]>,
  })

  const hasOrigin = !!(data.origin_lat && data.origin_lng)

  // Saved drafts (archived) are not real vehicles yet; nearest to the pickup first.
  const options = useMemo(() => vehicles
    .filter(v => v.status !== 'archived')
    .map(v => ({
      ...v,
      distance_km: hasOrigin && v.latitude != null && v.longitude != null
        ? haversineKm(data.origin_lat, data.origin_lng, v.latitude, v.longitude)
        : null,
    }))
    .sort((a, b) => (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity)), [vehicles, hasOrigin, data.origin_lat, data.origin_lng])

  const selected = options.find(v => v.id === data.selectedVehicleId) ?? null

  const { data: nearbyVendors = [], isLoading: vendorsLoading, isError: vendorsError } = useQuery<NearbyVendor[]>({
    queryKey: ['nearby-vendors', data.origin_lat, data.origin_lng],
    queryFn: () => capacityAPI.getNearbyVendors({ lat: data.origin_lat, lng: data.origin_lng, radius: 50 }),
    enabled: data.open_bidding && hasOrigin,
  })

  const vehicleLabel = (v: VehicleOption & { distance_km: number | null }) => {
    const parts = [v.plate_number]
    if (v.distance_km != null) parts.push(`${formatKm(v.distance_km)} away`)
    if (v.capacity_kg != null) parts.push(`${formatKg(freeCapacityKg(v))} of ${formatKg(v.capacity_kg)} free`)
    if (v.status && v.status !== 'available') parts.push(statusToLabel(v.status))
    return parts.join(' · ')
  }

  const setPickupFromVehicle = async () => {
    if (!selected || selected.latitude == null || selected.longitude == null) return
    setLocating(true)
    const place = await reversePlace(selected.latitude, selected.longitude).catch(() => null)
    setLocating(false)
    const address = place?.address ?? `Near ${selected.latitude.toFixed(4)}, ${selected.longitude.toFixed(4)}`
    update({
      origin_name: address.split(', ')[0],
      origin_address: address,
      origin_lat: selected.latitude,
      origin_lng: selected.longitude,
    })
    toast.success(`Pickup set to where ${selected.plate_number} is now`)
  }

  const createMobileLink = async () => {
    if (!data.selectedVehicleId) return
    setCreatingLink(true)
    try {
      const result = await telemetryAPI.createMobileSession(data.selectedVehicleId, data.mobilePhone)
      setMobileLink(`${window.location.origin}/m/${result.token}`)
      toast.success(`Tracking link created for ${result.plate}`)
    } catch (error) {
      toast.error(apiErrorMessage(error, 'We could not create the tracking link. Try again.'))
    } finally {
      setCreatingLink(false)
    }
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(mobileLink)
      toast.success('Link copied')
    } catch {
      toast.error('We could not copy the link. Select it and copy it yourself.')
    }
  }

  const whatsappHref = mobileLink
    ? `https://wa.me/${data.mobilePhone.replace(/\D/g, '')}?text=${encodeURIComponent(`MargixIndia tracking link. Open it on your phone to share your location for this trip: ${mobileLink}`)}`
    : ''

  const mapVehicles = options
    .filter(v => v.latitude != null && v.longitude != null)
    .map(v => ({ id: v.id, plate_number: v.plate_number, status: v.status ?? 'unknown', latitude: v.latitude, longitude: v.longitude, vehicle_type: v.vehicle_type ?? undefined }))

  return (
    <div className="space-y-5">
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-text">How should this shipment be dispatched?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {[
            { bidding: false, title: 'Assign directly', description: 'Choose a vehicle now, or assign one later.' },
            { bidding: true, title: 'Open to vendor bids', description: 'Vendors near the pickup bid for the spare space on a vehicle.' },
          ].map(mode => {
            const active = data.open_bidding === mode.bidding
            return (
              <label
                key={String(mode.bidding)}
                className={clsx(
                  'flex cursor-pointer items-start gap-3 rounded-control border p-3 transition-colors',
                  active ? 'border-brand bg-brand-soft' : 'border-border-strong hover:bg-surface-subtle',
                )}
              >
                <input
                  type="radio"
                  name="dispatch_mode"
                  checked={active}
                  onChange={() => update(mode.bidding
                    ? { open_bidding: true, bidding_duration_mins: data.bidding_duration_mins || 5, enable_mobile_gps: true }
                    : { open_bidding: false })}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-brand"
                />
                <span className="text-sm">
                  <span className="block font-medium text-text">{mode.title}</span>
                  <span className="block text-muted">{mode.description}</span>
                </span>
              </label>
            )
          })}
        </div>
      </fieldset>

      <div className="space-y-3">
        {isLoading ? (
          <Skeleton className="h-control w-full" />
        ) : isError ? (
          <Alert tone="danger" title="We could not load vehicles." action={<Button size="sm" variant="secondary" onClick={() => refetch()}>Try again</Button>}>
            Check your connection and try again.
          </Alert>
        ) : options.length === 0 ? (
          <EmptyState compact title="No vehicles in your fleet" description="Add a vehicle under Fleet to assign it here. You can still create the shipment and assign a vehicle later." />
        ) : (
          <Select
            label="Vehicle"
            required={data.open_bidding}
            hint={data.open_bidding ? undefined : (hasOrigin ? 'Optional. Nearest to the pickup first.' : 'Optional.')}
            value={data.selectedVehicleId}
            error={errors.vehicle}
            onChange={e => update({ selectedVehicleId: e.target.value })}
          >
            <option value="">{data.open_bidding ? 'Choose a vehicle' : 'No vehicle yet'}</option>
            {options.map(v => <option key={v.id} value={v.id}>{vehicleLabel(v)}</option>)}
          </Select>
        )}

        {mapVehicles.length > 0 && (
          <div className="hidden h-64 overflow-hidden rounded-card border border-border sm:block">
            <LiveMap vehicles={mapVehicles} selectedVehicleId={data.selectedVehicleId || null} onVehicleSelect={id => update({ selectedVehicleId: id })} />
          </div>
        )}

        {selected && selected.latitude != null && selected.longitude != null && (
          <Button variant="ghost" size="sm" icon={<LocateFixed size={16} />} loading={locating} onClick={setPickupFromVehicle}>
            Use this vehicle's location as the pickup
          </Button>
        )}
      </div>

      {data.open_bidding && (
        <div className="space-y-4 rounded-card border border-border p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Bidding window"
              value={String(data.bidding_duration_mins || 5)}
              onChange={e => update({ bidding_duration_mins: Number(e.target.value) })}
              options={BIDDING_WINDOWS.map(m => ({ value: String(m), label: `${m} minutes` }))}
            />
            <Input
              label="Minimum bid"
              hint="Optional."
              type="number"
              inputMode="decimal"
              min={0}
              leading="₹"
              value={data.asking_price || ''}
              error={errors.asking_price}
              onChange={e => update({ asking_price: e.target.value })}
            />
          </div>
          {selected && (
            <p className="text-sm text-muted">
              Space offered to vendors: <span className="font-medium tabular text-text">{formatKg(freeCapacityKg(selected))}</span>
            </p>
          )}
          <div>
            <h3 className="mb-2 text-sm font-medium text-text">Vendors within 50 km of the pickup</h3>
            {!hasOrigin ? (
              <p className="text-sm text-muted">Choose a pickup to see vendors nearby.</p>
            ) : vendorsLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : vendorsError ? (
              <p className="text-sm text-danger">We could not load nearby vendors.</p>
            ) : nearbyVendors.length === 0 ? (
              <p className="text-sm text-muted">No vendors found within 50 km. The window still opens, but bids may not come in.</p>
            ) : (
              <ul className="max-h-48 divide-y divide-border overflow-y-auto rounded-control border border-border">
                {nearbyVendors.map((v, i) => (
                  <li key={v.id ?? i} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="truncate text-text">{v.company_name || 'Unnamed vendor'}</div>
                      {v.city && <div className="truncate text-xs text-muted">{v.city}</div>}
                    </div>
                    {v.distance_km != null && (
                      <StatusPill tone="neutral" dot={false}>{formatKm(v.distance_km)}</StatusPill>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <div className="space-y-3 border-t border-border pt-5">
        <Checkbox
          label="Track with the driver's phone"
          description="Send the driver a link that shares their phone's location during the trip."
          checked={data.enable_mobile_gps}
          onChange={e => update({ enable_mobile_gps: e.target.checked })}
        />
        {data.enable_mobile_gps && (
          <div className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <Input
                label="Driver's phone number"
                type="tel"
                inputMode="tel"
                autoComplete="off"
                placeholder="10-digit mobile number"
                value={data.mobilePhone || ''}
                onChange={e => update({ mobilePhone: e.target.value })}
                className="flex-1"
              />
              <Button
                variant="secondary"
                onClick={createMobileLink}
                loading={creatingLink}
                disabled={!data.mobilePhone || !data.selectedVehicleId}
              >
                Create link
              </Button>
            </div>
            {!data.selectedVehicleId && <p className="text-xs text-muted">Choose a vehicle above to create a tracking link.</p>}
            {mobileLink && (
              <div className="flex items-center gap-2 rounded-control border border-border bg-surface-subtle px-3 py-2">
                <span className="min-w-0 flex-1 truncate font-mono text-sm text-text">{mobileLink}</span>
                <IconButton size="sm" label="Copy link" icon={<Copy size={16} />} onClick={copyLink} />
                <a href={whatsappHref} target="_blank" rel="noopener noreferrer" className="shrink-0 text-sm font-medium text-brand hover:underline">
                  Send on WhatsApp
                </a>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
