import type { ReactNode } from 'react'
import { Pencil } from 'lucide-react'
import { Alert, Button, Card } from '@/components/ui'
import type { AssistResult, LoadDraft, VehicleClass } from '@/types/load'
import { formatDate } from '@/utils/display'
import GstSummary from './GstSummary'
import PriceRecommendationModal from './PriceRecommendationModal'
import { addressOf, allSpecialHandling, EWAY_THRESHOLD_INR, ewayLocal, inr, itemTotals, kgText, priorityLabel, rangeText, rateText, TEMP_RANGES } from './logic'

function Section({ title, onEdit, children }: { title: string; onEdit: () => void; children: ReactNode }) {
  return (
    <Card padded className="space-y-3 !p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-text">{title}</h3>
        <Button variant="ghost" size="sm" icon={<Pencil size={14} />} onClick={onEdit} aria-label={`Edit ${title}`}>Edit</Button>
      </div>
      {children}
    </Card>
  )
}

const SLOT_TEXT = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' } as const
const HANDLING_TEXT: Record<string, string> = {
  fragile: 'Fragile', temperature_controlled: 'Temperature-controlled', hazmat: 'Hazardous', do_not_stack: 'Do not stack', this_side_up: 'This side up', odc: 'ODC',
}

function Chips({ items }: { items: string[] }) {
  return <>{items.map(h => <span key={h} className="rounded-full bg-surface-subtle px-2 py-0.5 text-xs font-medium text-text">{HANDLING_TEXT[h] ?? h}</span>)}</>
}

/** Step 4: everything entered once, read-only: goods, route, truck and price. Edit goes to the step that owns it. */
export default function ReviewStep({ draft, assist, assistLoading, vehicles, onEdit, onSubmit, submitting, signedIn, error, disabled }: {
  draft: LoadDraft
  assist: AssistResult | null
  assistLoading?: boolean
  vehicles: VehicleClass[]
  onEdit: (step: number) => void
  onSubmit: () => void
  submitting: boolean
  signedIn: boolean
  /** Staff and 3PL accounts cannot post a load. */
  disabled?: boolean
  error?: string | null
}) {
  const totals = itemTotals(draft.items)
  const local = ewayLocal(draft.items)
  const eway = assist?.eway.required ?? local.required
  const vehicleName = vehicles.find(v => v.key === draft.vehicle_class)?.name ?? draft.vehicle_class
  const vehicle = vehicleName
    ? `${draft.vehicle_mode === 'manual' ? 'Chosen' : 'Recommended'}: ${vehicleName}`
    : 'The logistic company decides'
  const range = !assistLoading && assist?.estimate ? rangeText(assist.estimate.low, assist.estimate.high) : null
  const temp = draft.temp_choice ? TEMP_RANGES[draft.temp_choice].label : null
  const handling = allSpecialHandling(draft)

  return (
    <div className="space-y-4">
      <Card padded className="!p-4" aria-label="Load summary">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <div><dt className="text-xs text-muted">Total weight</dt><dd className="font-semibold tabular text-text">{kgText(totals.weight_kg)}</dd></div>
          <div><dt className="text-xs text-muted">Total distance</dt><dd className="font-semibold tabular text-text">{assist?.estimate?.distance_km ? `${Math.round(assist.estimate.distance_km).toLocaleString('en-IN')} km` : '—'}</dd></div>
          <div><dt className="text-xs text-muted">Total declared value</dt><dd className="font-semibold tabular text-text">{totals.declared_value > 0 ? inr(totals.declared_value) : 'Not declared'}</dd></div>
          <div><dt className="text-xs text-muted">From and to</dt><dd className="font-semibold text-text">{draft.pickup_city} → {draft.delivery_city}</dd></div>
          <div><dt className="text-xs text-muted">Pickup date</dt><dd className="font-semibold text-text">{draft.pickup_date ? formatDate(draft.pickup_date) : '—'}</dd></div>
          <div><dt className="text-xs text-muted">Priority</dt><dd className="font-semibold text-text" data-testid="review-priority">{priorityLabel(draft.priority)}</dd></div>
        </dl>
      </Card>

      <Section title="Goods" onEdit={() => onEdit(1)}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px]" aria-label="Products">
            <thead><tr className="border-b border-border text-xs text-muted">
              <th className="px-2 py-1.5 text-left font-medium">Product</th><th className="px-2 py-1.5 text-left font-medium">HSN</th><th className="px-2 py-1.5 text-right font-medium">GST rate</th>
              <th className="px-2 py-1.5 text-right font-medium">Quantity</th><th className="px-2 py-1.5 text-right font-medium">Weight</th><th className="px-2 py-1.5 text-right font-medium">Value</th>
            </tr></thead>
            <tbody>
              {draft.items.map(i => (
                <tr key={i.key} className="border-b border-border last:border-0 text-sm">
                  <td className="px-2 py-1.5">{i.product_name}{i.handling.length > 0 && <span className="block text-xs text-muted">{i.handling.map(h => HANDLING_TEXT[h]).join(', ')}</span>}</td>
                  <td className="px-2 py-1.5 font-mono">{i.hsn_code}</td>
                  <td className="px-2 py-1.5 text-right tabular">{i.gst_rate === null ? '—' : rateText([i.gst_rate])}</td>
                  <td className="px-2 py-1.5 text-right tabular">{i.quantity} {i.unit}</td>
                  <td className="px-2 py-1.5 text-right tabular">{kgText(Number(i.weight_kg) || 0)}</td>
                  <td className="px-2 py-1.5 text-right tabular">{i.declared_value ? inr(Number(i.declared_value)) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={eway ? 'text-sm font-medium text-warning' : 'text-sm text-muted'} data-testid="review-eway">
          {eway
            ? (local.hazmat && local.declared_value <= EWAY_THRESHOLD_INR
              ? 'An e-Way Bill is needed (hazardous goods). You or the logistic company add it after a truck is assigned.'
              : `An e-Way Bill is needed (value above ${inr(EWAY_THRESHOLD_INR)}). You or the logistic company add it after a truck is assigned.`)
            : 'No e-Way Bill needed: the total value is below the limit.'}
        </p>
      </Section>

      <GstSummary tax={assist?.tax ?? null} hasValue={totals.declared_value > 0} loading={assistLoading} />

      <Section title="Pickup and delivery" onEdit={() => onEdit(0)}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-0.5 text-sm">
            <p className="font-medium text-text">Pickup: {draft.pickup_city}</p>
            <p className="text-muted">{addressOf(draft, 'pickup')}</p>
            <p className="text-muted">{draft.pickup_date ? formatDate(draft.pickup_date) : ''}{draft.pickup_slot ? `, ${SLOT_TEXT[draft.pickup_slot]}` : ''}</p>
            <p className="text-muted">Contact: {draft.pickup_contact_name}, {draft.pickup_contact_phone}</p>
          </div>
          <div className="space-y-0.5 text-sm">
            <p className="font-medium text-text">Delivery: {draft.delivery_city}</p>
            <p className="text-muted">{addressOf(draft, 'delivery')}</p>
            <p className="text-muted">Receiver: {draft.delivery_contact_name}, {draft.delivery_contact_phone}</p>
          </div>
        </div>
      </Section>

      <Section title="Truck and price" onEdit={() => onEdit(2)}>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div><dt className="text-xs text-muted">Load type</dt><dd className="font-medium text-text">{draft.load_type === 'ftl' ? 'Full truck load' : 'Part truck load'}</dd></div>
          <div><dt className="text-xs text-muted">Vehicle</dt><dd className="font-medium text-text" data-testid="review-vehicle">{vehicle}</dd></div>
          {draft.capacity_t && <div><dt className="text-xs text-muted">Capacity</dt><dd className="font-medium text-text">{draft.capacity_t} t</dd></div>}
          {temp && <div><dt className="text-xs text-muted">Temperature</dt><dd className="font-medium text-text">{temp}</dd></div>}
        </dl>
        {handling.length > 0 && <p className="flex flex-wrap items-center gap-2 text-sm text-muted">Handling: <Chips items={handling} /></p>}
        {range && assist?.estimate ? (
          <p className="text-sm text-text" data-testid="review-pricing">
            Recommended freight: <span className="font-semibold">{range}</span> <span className="text-muted">({Math.round(assist.estimate.distance_km).toLocaleString('en-IN')} km)</span>.
            Logistic companies can book your load at any price in this range.
          </p>
        ) : (
          <p className="text-sm text-muted" data-testid="review-pricing">We will share the range once a logistic company reviews the trip.</p>
        )}
        <PriceRecommendationModal estimate={assistLoading ? null : assist?.estimate ?? null} />
      </Section>

      {error && <Alert tone="danger">{error}</Alert>}

      <div className="space-y-2">
        <Button size="lg" fullWidth loading={submitting} disabled={disabled} onClick={onSubmit} className="!h-14 text-base font-semibold">Submit Load</Button>
        <p className="text-center text-xs text-muted">
          {signedIn ? 'Nothing is posted until you press Submit Load.' : 'You will verify your mobile number next. Nothing is posted until then.'}
        </p>
      </div>
    </div>
  )
}
