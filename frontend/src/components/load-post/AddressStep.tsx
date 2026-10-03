import { useState } from 'react'
import type { ReactNode } from 'react'
import { Alert, Card, Input, Select, Button } from '@/components/ui'
import type { LoadDraft } from '@/types/load'
import { isWeekend, taxBasisLocal, todayIso } from './logic'
import type { StepErrors } from './validate'
import AddressBlock from './AddressBlock'
import { ArrowUp, ArrowDown, ShieldCheck } from 'lucide-react'

const SLOTS = [
  { value: 'morning', label: 'Morning, 6am–12pm' },
  { value: 'afternoon', label: 'Afternoon, 12–6pm' },
  { value: 'evening', label: 'Evening, 6–10pm' },
]

export default function AddressStep({ draft, onChange, errors, pickupNotes, deliveryNotes }: {
  draft: LoadDraft
  onChange: (patch: Partial<LoadDraft>) => void
  errors: StepErrors
  pickupNotes?: ReactNode
  deliveryNotes?: ReactNode
}) {
  const basis = taxBasisLocal(draft)
  
  // Toggle editing mode. If they haven't picked a city yet, default to editing.
  const [editingPickup, setEditingPickup] = useState(!draft.pickup_city)
  const [editingDelivery, setEditingDelivery] = useState(!draft.delivery_city)

  const set = (patch: Record<string, unknown>) => onChange(patch as Partial<LoadDraft>)

  return (
    <div className="space-y-8">
      {/* 1. Addresses */}
      <Card padded className="!p-6">
        <div className="relative space-y-6">
          {/* Vertical dashed line */}
          <div className="absolute bottom-10 left-4 top-10 w-px border-l-2 border-dashed border-border" />
          
          {/* Pickup */}
          <div className="flex gap-4">
            <div className="z-10 mt-1 flex h-8 w-8 flex-none items-center justify-center rounded-full bg-success text-white ring-4 ring-surface">
              <ArrowUp className="h-4 w-4" strokeWidth={3} />
            </div>
            <div className="flex-1">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase text-muted">Pickup</span>
                {!editingPickup && <Button variant="secondary" size="sm" onClick={() => setEditingPickup(true)}>Edit address</Button>}
              </div>
              {editingPickup ? (
                 <AddressBlock side="pickup" draft={draft} set={set} errors={errors} />
              ) : (
                <div>
                  <div className="text-lg font-semibold text-text">{draft.pickup_address || draft.pickup_city}</div>
                  <div className="text-sm text-muted">{draft.pickup_city} • PIN {draft.pickup_pincode} • {draft.pickup_state_name}</div>
                </div>
              )}
              {pickupNotes && <div className="mt-2">{pickupNotes}</div>}
            </div>
          </div>

          {/* Delivery */}
          <div className="flex gap-4">
            <div className="z-10 mt-1 flex h-8 w-8 flex-none items-center justify-center rounded-full bg-danger text-white ring-4 ring-surface">
              <ArrowDown className="h-4 w-4" strokeWidth={3} />
            </div>
            <div className="flex-1">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase text-muted">Drop</span>
                {!editingDelivery && <Button variant="secondary" size="sm" onClick={() => setEditingDelivery(true)}>Edit address</Button>}
              </div>
              {editingDelivery ? (
                 <AddressBlock side="delivery" draft={draft} set={set} errors={errors} />
              ) : (
                <div>
                  <div className="text-lg font-semibold text-text">{draft.delivery_address || draft.delivery_city}</div>
                  <div className="text-sm text-muted">{draft.delivery_city} • PIN {draft.delivery_pincode} • {draft.delivery_state_name}</div>
                </div>
              )}
              {deliveryNotes && <div className="mt-2">{deliveryNotes}</div>}
            </div>
          </div>
        </div>

        {/* Weight and Service Type summary */}
        <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
          <div>
            <div className="mb-1 text-xs text-muted">Weight</div>
            <div className="text-base font-semibold text-text">
              {draft.items[0]?.weight_kg || '0'} Kg <span className="text-sm font-normal text-muted">(Min. Parcel / LTL option)</span>
            </div>
          </div>
          <div className="text-right">
            <div className="mb-1 text-xs text-muted">Service type</div>
            <div className="text-base font-semibold text-text">
              {draft.load_type === 'ftl' ? 'Full Truck Load (FTL)' : 'Part Load (LTL)'}
            </div>
          </div>
        </div>
      </Card>

      {/* 2. Schedule & Timing */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase text-muted">Schedule & Timing</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Pickup Date *" type="date" min={todayIso()}
            value={draft.pickup_date} onChange={e => onChange({ pickup_date: e.target.value })}
            error={errors.pickup_date}
            hint={draft.pickup_date && isWeekend(draft.pickup_date) ? 'Weekends have limited availability.' : undefined}
          />
          <Select
            label="Pickup Time Slot" value={draft.pickup_slot} placeholder="Any time (Flexible slot)"
            onChange={e => onChange({ pickup_slot: e.target.value as LoadDraft['pickup_slot'] })} options={SLOTS}
            hint="Driver arrival window"
          />
        </div>
      </div>

      {/* 3. Point of Contact Details */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase text-muted">Point of Contact Details</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <Input
            label="Sender Contact *"
            value={draft.pickup_contact_name} onChange={e => set({ pickup_contact_name: e.target.value })}
            error={errors.pickup_contact_name} autoComplete="off"
          />
          <Input
            label="Sender Mobile *" type="tel" inputMode="tel"
            value={draft.pickup_contact_phone} onChange={e => set({ pickup_contact_phone: e.target.value })}
            error={errors.pickup_contact_phone} autoComplete="off"
          />
          <Input
            label="Receiver Name *"
            value={draft.delivery_contact_name} onChange={e => set({ delivery_contact_name: e.target.value })}
            error={errors.delivery_contact_name} autoComplete="off"
          />
          <Input
            label="Receiver Mobile *" type="tel" inputMode="tel"
            value={draft.delivery_contact_phone} onChange={e => set({ delivery_contact_phone: e.target.value })}
            error={errors.delivery_contact_phone} autoComplete="off"
          />
        </div>
        
        {/* Estimated Route Distance */}
        <div className="flex items-center justify-between rounded-control bg-surface-raised px-4 py-3 text-sm">
          <div className="flex items-center gap-2 text-muted">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
            </svg>
            <span>Estimated Route Distance: <span className="font-semibold text-text">Direct Interstate Corridor</span></span>
          </div>
          <span className="rounded bg-success/10 px-2 py-1 text-xs font-medium text-success">Verified Route</span>
        </div>
      </div>

      {/* 4. Dispatch Priority */}
      <div className="space-y-3">
        <div>
          <h3 className="text-base font-semibold text-text">Dispatch Priority</h3>
          <p className="text-sm text-muted">Select how swiftly your shipment requires truck allotment from our network</p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <button 
            type="button" 
            onClick={() => set({ priority: 'high' })}
            className={`relative rounded-lg border-2 p-4 text-left transition-colors ${draft.priority === 'high' ? 'border-danger bg-danger/5' : 'border-border hover:border-danger/30'}`}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-danger/10 px-2 py-0.5 text-xs font-semibold text-danger">
                <span className="h-1.5 w-1.5 rounded-full bg-danger"></span> High Priority
              </span>
              <span className="text-xs font-medium text-muted">+10-15% speed</span>
            </div>
            <div className="font-semibold text-text">Urgent Delivery</div>
            <div className="mt-1 text-xs text-muted">Broadcasted first to premium fleet operators with prioritized loading priority.</div>
          </button>

          <button 
            type="button" 
            onClick={() => set({ priority: 'medium' })}
            className={`relative rounded-lg border-2 p-4 text-left transition-colors ${draft.priority === 'medium' ? 'border-brand-fill bg-brand-fill/5' : 'border-border hover:border-brand-fill/30'}`}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-fill/20 px-2 py-0.5 text-xs font-semibold text-brand-dark">
                <ShieldCheck className="h-3.5 w-3.5" /> Medium (Recommended)
              </span>
              <span className="rounded bg-surface-raised px-1.5 py-0.5 text-xs font-medium text-text">Default</span>
            </div>
            <div className="font-semibold text-text">Normal Booking</div>
            <div className="mt-1 text-xs text-muted">Standard allocation time. Optimal balance of price, reliability and driver response.</div>
          </button>

          <button 
            type="button" 
            onClick={() => set({ priority: 'low' })}
            className={`relative rounded-lg border-2 p-4 text-left transition-colors ${draft.priority === 'low' ? 'border-success bg-success/5' : 'border-border hover:border-success/30'}`}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-raised px-2 py-0.5 text-xs font-semibold text-text">
                Low Priority
              </span>
              <span className="text-xs font-medium text-success">Economical</span>
            </div>
            <div className="font-semibold text-text">Flexible Schedule</div>
            <div className="mt-1 text-xs text-muted">No rush. Ideal for backhaul returns and discounted budget transport requests.</div>
          </button>
        </div>
      </div>

      {/* 5. GST Rules */}
      {basis !== 'unknown' && (
        <Alert tone="info" title={basis === 'inter' ? 'Interstate (CGST + IGST)' : 'Within state (CGST + SGST)'}>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <span>
              {basis === 'inter'
                ? `${draft.pickup_state_name} to ${draft.delivery_state_name}: IGST applies on the goods.`
                : `Both addresses operate within ${draft.pickup_state_name} billing limits: CGST (9%) and SGST (9%) apply equally.`}
            </span>
            <a href="#" className="whitespace-nowrap text-sm font-semibold text-brand-dark hover:underline">View GST Breakdown</a>
          </div>
        </Alert>
      )}
    </div>
  )
}
