import type { ReactNode } from 'react'
import { Pencil } from 'lucide-react'
import { Alert, Button, Card } from '@/components/ui'
import type { AssistResult, LoadDraft, VehicleClass } from '@/types/load'
import { formatDate } from '@/utils/display'
import GstSummary from './GstSummary'
import { EWAY_THRESHOLD_INR, ewayLocal, inr, itemTotals, kgText, rateText, TEMP_RANGES } from './logic'

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

/** Step 5: everything entered, read-only, with Edit buttons and the big Submit Load button. */
export default function ReviewStep({ draft, assist, assistLoading, vehicles, onEdit, onSubmit, submitting, signedIn, error }: {
  draft: LoadDraft
  assist: AssistResult | null
  assistLoading?: boolean
  vehicles: VehicleClass[]
  onEdit: (step: number) => void
  onSubmit: () => void
  submitting: boolean
  signedIn: boolean
  error?: string | null
}) {
  const totals = itemTotals(draft.items)
  const local = ewayLocal(draft.items)
  const eway = assist?.eway.required ?? local.required
  const vehicle = vehicles.find(v => v.key === draft.vehicle_class)?.name ?? draft.vehicle_class
  const temp = draft.temp_choice ? TEMP_RANGES[draft.temp_choice].label : null

  return (
    <div className="space-y-4">
      <Card padded className="!p-4" aria-label="Load summary">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div><dt className="text-xs text-muted">Total weight</dt><dd className="font-semibold tabular text-text">{kgText(totals.weight_kg)}</dd></div>
          <div><dt className="text-xs text-muted">Total declared value</dt><dd className="font-semibold tabular text-text">{totals.declared_value > 0 ? inr(totals.declared_value) : 'Not declared'}</dd></div>
          <div><dt className="text-xs text-muted">Route</dt><dd className="font-semibold text-text">{draft.pickup_city} → {draft.delivery_city}</dd></div>
          <div><dt className="text-xs text-muted">Pickup date</dt><dd className="font-semibold text-text">{draft.pickup_date ? formatDate(draft.pickup_date) : '—'}</dd></div>
        </dl>
      </Card>

      <Section title="Products" onEdit={() => onEdit(1)}>
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
      </Section>

      <GstSummary tax={assist?.tax ?? null} hasValue={totals.declared_value > 0} loading={assistLoading} />

      <Alert tone={eway ? 'warning' : 'info'}>
        {eway
          ? (local.hazmat && local.declared_value <= EWAY_THRESHOLD_INR
            ? 'e-Way Bill will be auto-generated, required because your load has hazardous goods.'
            : `e-Way Bill will be auto-generated, required because total value ${inr(totals.declared_value)} exceeds ${inr(EWAY_THRESHOLD_INR)}.`)
          : 'e-Way Bill not required: total value is below the threshold.'}
      </Alert>

      <Section title="Pickup and delivery" onEdit={() => onEdit(2)}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-0.5 text-sm">
            <p className="font-medium text-text">Pickup: {draft.pickup_city}</p>
            <p className="text-muted">{draft.pickup_address} — {draft.pickup_pincode}{draft.pickup_state_name ? `, ${draft.pickup_state_name}` : ''}</p>
            <p className="text-muted">{draft.pickup_date ? formatDate(draft.pickup_date) : ''}{draft.pickup_slot ? `, ${SLOT_TEXT[draft.pickup_slot]}` : ''}</p>
            <p className="text-muted">{draft.pickup_contact_name}, {draft.pickup_contact_phone}</p>
          </div>
          <div className="space-y-0.5 text-sm">
            <p className="font-medium text-text">Delivery: {draft.delivery_city}</p>
            <p className="text-muted">{draft.delivery_address} — {draft.delivery_pincode}{draft.delivery_state_name ? `, ${draft.delivery_state_name}` : ''}</p>
            {draft.delivery_date && <p className="text-muted">By {formatDate(draft.delivery_date)}</p>}
            {(draft.delivery_contact_name || draft.delivery_contact_phone) && <p className="text-muted">{draft.delivery_contact_name} {draft.delivery_contact_phone}</p>}
          </div>
        </div>
        {(draft.loading_dock || draft.access_restrictions) && (
          <p className="text-sm text-muted">{draft.loading_dock ? 'Loading dock available. ' : ''}{draft.access_restrictions}</p>
        )}
      </Section>

      <Section title="Transport" onEdit={() => onEdit(3)}>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div><dt className="text-xs text-muted">Load type</dt><dd className="font-medium text-text">{draft.load_type === 'ftl' ? 'Full truck load' : 'Part truck load'}</dd></div>
          <div><dt className="text-xs text-muted">Vehicle</dt><dd className="font-medium text-text">{vehicle}</dd></div>
          <div><dt className="text-xs text-muted">Capacity</dt><dd className="font-medium text-text">{draft.capacity_t} t</dd></div>
          {temp && <div><dt className="text-xs text-muted">Temperature</dt><dd className="font-medium text-text">{temp}</dd></div>}
        </dl>
        {draft.special_handling.length > 0 && <p className="text-sm text-muted">Handling: {draft.special_handling.map(h => HANDLING_TEXT[h]).join(', ')}</p>}
        {draft.budget_inr && <p className="text-sm text-muted">Your budget: {inr(Number(draft.budget_inr))}</p>}
        {draft.quote_requested && <p className="text-sm text-muted">Quotation requested.</p>}
        {assist?.estimate && (
          <p className="text-sm text-text">Estimated freight: <span className="font-semibold">{inr(assist.estimate.low)} – {inr(assist.estimate.high)}</span> <span className="text-muted">{assist.estimate.label}</span></p>
        )}
      </Section>

      {error && <Alert tone="danger">{error}</Alert>}

      <div className="space-y-2">
        <Button size="lg" fullWidth loading={submitting} onClick={onSubmit} className="!h-14 text-base font-semibold">Submit Load</Button>
        <p className="text-center text-xs text-muted">
          {signedIn ? 'Nothing is posted until you press Submit Load.' : 'You will verify your mobile number next. Nothing is posted until then.'}
        </p>
      </div>
    </div>
  )
}
