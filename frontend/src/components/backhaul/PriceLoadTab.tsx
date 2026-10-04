import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { pricingAPI, type QuoteRequest } from '@/services/pricing'
import { publicAPI } from '@/services/api'
import type { ResolvedPlace } from '@/services/geocoding'
import { Alert, Button, Card, CardBody, CardHeader, ErrorState, Input, PlaceSearch, Select, Skeleton, humanize } from '@/components/ui'
import { PriceSuggestion } from '@/components/pricing/PriceSuggestion'
import { usePriceQuote } from '@/components/pricing/usePriceQuote'
import { apiErrorMessage, useBackhaulVehicles } from './data'

const LOAD_TYPES = [
  { value: 'general', label: 'General goods' },
  { value: 'cold_chain', label: 'Cold chain' },
  { value: 'hazardous', label: 'Hazardous' },
  { value: 'fragile', label: 'Fragile' },
  { value: 'bulk', label: 'Bulk' },
]

/** Same rule the server uses to turn "Cold chain" into `cold_chain` inside a setting name. */
const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')

/** Today's date in India, as YYYY-MM-DD. */
const todayIso = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)

/** Price a load with the same engine vendors and customers see, and retain negotiated company settings. */
export default function PriceLoadTab() {
  const vehicles = useBackhaulVehicles()
  const classes = useQuery({ queryKey: ['public', 'vehicle-classes'], queryFn: publicAPI.vehicleClasses })
  const [pickup, setPickup] = useState<ResolvedPlace | null>(null)
  const [drop, setDrop] = useState<ResolvedPlace | null>(null)
  const [weight, setWeight] = useState('')
  const [vehicleType, setVehicleType] = useState('')
  const [loadType, setLoadType] = useState('general')
  const [date, setDate] = useState(todayIso())

  const vehicleTypes = useMemo(
    () => [...new Set((vehicles.data ?? []).map(v => v.vehicle_type).filter((t): t is string => !!t))].sort(),
    [vehicles.data],
  )

  const weightKg = Number(weight)
  const input: QuoteRequest | null = pickup && drop && weightKg > 0
    ? {
        pickup: { lat: pickup.lat, lng: pickup.lng, label: pickup.address },
        drop: { lat: drop.lat, lng: drop.lng, label: drop.address },
        weight_kg: weightKg,
        vehicle_type: vehicleType || null,
        load_type: loadType || null,
        date: date || null,
        source: 'backhaul',
      }
    : null
  const quote = usePriceQuote(input)

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
      <div className="space-y-6 xl:col-span-3">
        <Card>
          <CardHeader title="Price a load" description="The same reference truck rates and distance calculation used when vendors post a load." />
          <CardBody className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <PlaceSearch label="Pickup" required value={pickup} onChange={setPickup} placeholder="Search pickup address" />
              <PlaceSearch label="Drop" required value={drop} onChange={setDrop} placeholder="Search drop address" />
              <Input label="Weight (kg)" type="number" min={1} required value={weight} onChange={e => setWeight(e.target.value)} />
              <Select
                label="Vehicle type"
                hint="Choose the truck class to use its capacity and reference rate band."
                value={vehicleType}
                onChange={e => setVehicleType(e.target.value)}
                options={[{ value: '', label: 'Recommend from goods weight' }, ...(classes.data ?? []).map(v => ({ value: v.key, label: v.name }))]}
              />
              <Select label="Load type" value={loadType} onChange={e => setLoadType(e.target.value)} options={LOAD_TYPES} />
              <Input label="Pickup date" type="date" min={todayIso()} value={date} onChange={e => setDate(e.target.value)} />
            </div>
            <div className="border-t border-border pt-4">
              <PriceSuggestion query={quote} idle="Choose a pickup, a drop and a weight to see a price." />
            </div>
          </CardBody>
        </Card>
      </div>
      <div className="xl:col-span-2">
        <RateCard vehicleTypes={vehicleTypes} />
      </div>
    </div>
  )
}

const BASE_FIELDS = [
  { key: 'rate_per_km', label: 'Standard rate per km (₹)', hint: 'Saved negotiated standard rate.' },
  { key: 'min_charge', label: 'Minimum charge (₹)', hint: 'Saved negotiated minimum charge.' },
  { key: 'per_kg_surcharge', label: 'Extra per kg (₹)', hint: 'Saved negotiated weight surcharge.' },
  { key: 'fuel_price_per_litre', label: 'Fuel price per litre (₹)', hint: 'Saved fuel cost for company pricing.' },
] as const

function RateCard({ vehicleTypes }: { vehicleTypes: string[] }) {
  const queryClient = useQueryClient()
  const settings = useQuery({ queryKey: ['pricing-settings'], queryFn: pricingAPI.settings })
  const [draft, setDraft] = useState<Record<string, string>>({})

  const fields = useMemo(() => [
    ...BASE_FIELDS.map(f => ({ ...f })),
    ...vehicleTypes.map(t => ({ key: `rate_per_km_${norm(t)}`, label: `${humanize(t)} rate per km (₹)`, hint: undefined as string | undefined })),
    ...LOAD_TYPES.filter(l => l.value !== 'general').map(l => ({
      key: `load_multiplier_${l.value}`, label: `${l.label} multiplier`, hint: 'Saved negotiated multiplier; excluded from instant reference prices.',
    })),
  ], [vehicleTypes])

  const current = (key: string) => draft[key] ?? (settings.data?.[key] !== undefined ? String(settings.data[key]) : '')
  const dirty = fields.some(f => draft[f.key] !== undefined && draft[f.key] !== (settings.data?.[f.key] !== undefined ? String(settings.data[f.key]) : ''))
  const invalid = fields.find(f => {
    const v = draft[f.key]
    return v !== undefined && v !== '' && !(Number(v) >= 0)
  })

  const save = useMutation({
    mutationFn: () => {
      const changes: Record<string, number | null> = {}
      for (const f of fields) {
        const v = draft[f.key]
        if (v === undefined) continue
        changes[f.key] = v === '' ? null : Number(v)
      }
      return pricingAPI.saveSettings(changes)
    },
    onSuccess: saved => {
      queryClient.setQueryData(['pricing-settings'], saved)
      queryClient.invalidateQueries({ queryKey: ['price-quote'] })
      setDraft({})
      toast.success('Rate card saved')
    },
    onError: err => toast.error(apiErrorMessage(err, 'We could not save the rate card. Try again.')),
  })

  return (
    <Card>
      <CardHeader title="Company pricing settings" description="Negotiated company settings are retained. Instant recommendations currently use the platform's reference truck bands, without these adjustments." />
      <CardBody className="space-y-4">
        {settings.isLoading ? (
          <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : settings.error ? (
          <ErrorState compact description="We could not load the rate card." onRetry={() => settings.refetch()} />
        ) : (
          <>
            {settings.data?.rate_per_km === undefined && (
              <Alert tone="info">No negotiated standard rate is recorded. Instant reference recommendations remain available.</Alert>
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-1">
              {fields.map(f => (
                <Input
                  key={f.key} label={f.label} hint={f.hint} type="number" min={0} step="any"
                  value={current(f.key)} onChange={e => setDraft(d => ({ ...d, [f.key]: e.target.value }))}
                  error={invalid?.key === f.key ? 'Enter 0 or more, or leave it blank' : undefined}
                />
              ))}
            </div>
            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <Button variant="secondary" disabled={!dirty || save.isPending} onClick={() => setDraft({})}>Discard changes</Button>
              <Button disabled={!dirty || !!invalid} loading={save.isPending} onClick={() => save.mutate()}>Save rate card</Button>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  )
}
