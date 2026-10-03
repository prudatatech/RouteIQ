import { useState } from 'react'
import type { ReactNode } from 'react'
import { Alert, Card, Input, Select, Button, Checkbox } from '@/components/ui'
import type { LoadDraft } from '@/types/load'
import { isWeekend, taxBasisLocal, todayIso } from './logic'
import type { StepErrors } from './validate'
import AddressBlock from './AddressBlock'
import { ArrowUp, ArrowDown, ShieldCheck, User, Calendar, AlertCircle } from 'lucide-react'

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
    <div className="mx-auto max-w-4xl space-y-6 pb-20">
      {/* Page Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <div className="mb-3 inline-flex items-center rounded-full bg-brand-fill/20 px-3 py-1 text-xs font-semibold text-brand-dark">
            <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-brand-dark"></span> Step 1 of 4: Booking Details
          </div>
          <h1 className="text-2xl font-bold text-text">Logistics Dispatch Setup</h1>
          <p className="text-sm text-muted">Specify pickup scheduling, verified contact parties, and fleet priority routing.</p>
        </div>
        <div className="hidden items-center gap-2 rounded-full border border-border bg-surface px-4 py-1.5 text-sm font-medium shadow-sm md:flex">
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-success text-white">
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
          </span>
          Autosaved draft
        </div>
      </div>

      {/* Addresses */}
      <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
        <div className="relative space-y-6">
          {/* Vertical dashed line */}
          <div className="absolute bottom-10 left-4 top-10 w-px border-l-2 border-dashed border-border" />
          
          {/* Pickup */}
          <div className="flex gap-4">
            <div className="z-10 mt-1 flex h-8 w-8 flex-none items-center justify-center rounded-full bg-success text-white ring-4 ring-surface">
              <ArrowUp className="h-4 w-4" strokeWidth={3} />
            </div>
            <div className="flex-1" role="group" aria-label="Pickup">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase text-muted">Pickup</span>
                {!editingPickup && <Button variant="secondary" size="sm" onClick={() => setEditingPickup(true)}>Edit address</Button>}
              </div>
              {editingPickup ? (
                 <AddressBlock side="pickup" draft={draft} set={set} errors={errors} />
              ) : (
                <div data-testid="pickup-address-summary">
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
            <div className="flex-1" role="group" aria-label="Delivery">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase text-muted">Drop</span>
                {!editingDelivery && <Button variant="secondary" size="sm" onClick={() => setEditingDelivery(true)}>Edit address</Button>}
              </div>
              {editingDelivery ? (
                 <AddressBlock side="delivery" draft={draft} set={set} errors={errors} />
              ) : (
                <div data-testid="delivery-address-summary">
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
      </div>

      {/* 1. Schedule & Timing */}
      <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-fill/20 text-lg font-bold text-brand-dark">1</div>
            <div>
              <h3 className="text-lg font-bold text-text">Pickup Date & Time Window</h3>
              <p className="text-sm text-muted">Choose when the carrier should pick up the freight</p>
            </div>
          </div>
          <div className="flex items-center rounded-full border border-border bg-surface-subtle p-1 text-sm font-medium">
            <button type="button" className="rounded-full px-4 py-1.5 hover:bg-surface" onClick={() => onChange({ pickup_date: todayIso() })}>Today</button>
            <button type="button" className="rounded-full px-4 py-1.5 hover:bg-surface" onClick={() => {
              const tmrw = new Date(); tmrw.setDate(tmrw.getDate() + 1);
              onChange({ pickup_date: tmrw.toISOString().split('T')[0] })
            }}>Tomorrow</button>
            <button type="button" className="rounded-full bg-brand-fill px-4 py-1.5 text-brand-dark shadow-sm">Custom Date</button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 flex justify-between text-xs font-bold uppercase tracking-wide text-text">
              <span>Pickup Date <span className="text-danger">*</span></span>
              <span className="text-muted">DD-MM-YYYY</span>
            </label>
            <Input
              hideLabel label="Pickup Date"
              type="date" min={todayIso()}
              value={draft.pickup_date} onChange={e => onChange({ pickup_date: e.target.value })}
              error={errors.pickup_date}
              leading={<Calendar size={16} />}
              inputClassName="pl-10"
            />
            {draft.pickup_date && isWeekend(draft.pickup_date) && (
              <div className="mt-3 flex items-center gap-1.5 rounded bg-brand-fill/10 px-3 py-2 text-xs font-medium text-brand-dark">
                <AlertCircle size={14} /> Weekends have limited availability.
              </div>
            )}
          </div>
          <div>
            <label className="mb-1.5 flex justify-between text-xs font-bold uppercase tracking-wide text-text">
              <span>Pickup Time Slot <span className="text-danger">*</span></span>
              <span className="text-success">Standard Window</span>
            </label>
            <Select
              hideLabel label="Pickup Time Slot"
              value={draft.pickup_slot} placeholder="Any time"
              onChange={e => onChange({ pickup_slot: e.target.value as LoadDraft['pickup_slot'] })} options={SLOTS}
            />
            <p className="mt-2 text-xs text-muted">When the driver should arrive at loading dock</p>
          </div>
        </div>
      </div>

      {/* 2. Point of Contact Details */}
      <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-fill/20 text-lg font-bold text-brand-dark">2</div>
            <div>
              <h3 className="text-lg font-bold text-text">Direct Contact Details</h3>
              <p className="text-sm text-muted">Driver coordinates directly with both parties via phone and SMS updates</p>
            </div>
          </div>
          <Checkbox label="Receiver is same as Sender" className="hidden md:flex rounded bg-surface-subtle px-3 py-1.5 font-medium" />
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* Origin Card */}
          <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-text">
                <span className="h-2 w-2 rounded-full bg-success"></span> Origin / Pickup Contact
              </div>
              <span className="rounded border border-border bg-surface-subtle px-2 py-0.5 text-xs font-medium text-muted">Sender</span>
            </div>
            <div className="space-y-4">
              <Input
                label="Pickup Contact Name" required
                value={draft.pickup_contact_name} onChange={e => set({ pickup_contact_name: e.target.value })}
                error={errors.pickup_contact_name} autoComplete="off"
                leading={<User size={16} />}
              />
              <Input
                label="Pickup Contact Mobile" required type="tel" inputMode="tel"
                value={draft.pickup_contact_phone} onChange={e => set({ pickup_contact_phone: e.target.value })}
                error={errors.pickup_contact_phone} autoComplete="off"
                leading={<span className="-ml-3 flex h-full items-center rounded-l-control border-r border-border bg-surface-subtle px-3 text-sm font-semibold text-text">+91</span>}
                inputClassName="pl-[60px]"
              />
            </div>
          </div>

          {/* Destination Card */}
          <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-text">
                <span className="h-2 w-2 rounded-full bg-brand-fill"></span> Delivery / Destination Contact
              </div>
              <span className="rounded border border-brand-fill/20 bg-brand-fill/5 px-2 py-0.5 text-xs font-medium text-brand-dark">Receiver</span>
            </div>
            <div className="space-y-4">
              <Input
                label="Receiver Name" required
                value={draft.delivery_contact_name} onChange={e => set({ delivery_contact_name: e.target.value })}
                error={errors.delivery_contact_name} autoComplete="off"
                leading={<User size={16} />}
              />
              <Input
                label={
                  <div className="flex w-full items-center justify-between">
                    <span>Receiver Mobile</span>
                    <span className="text-[10px] font-semibold text-success">✓ SMS Track Enabled</span>
                  </div>
                }
                required type="tel" inputMode="tel"
                value={draft.delivery_contact_phone} onChange={e => set({ delivery_contact_phone: e.target.value })}
                error={errors.delivery_contact_phone} autoComplete="off"
                leading={<span className="-ml-3 flex h-full items-center rounded-l-control border-r border-border bg-surface-subtle px-3 text-sm font-semibold text-text">+91</span>}
                inputClassName="pl-[60px]"
              />
            </div>
          </div>
        </div>
        
        {/* Estimated Route Distance */}
        <div className="flex items-center justify-between rounded-xl bg-surface-subtle px-4 py-3 text-sm border border-border">
          <div className="flex items-center gap-2 text-muted">
            <svg className="h-5 w-5 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
            </svg>
            <span>Estimated Route Distance: <span className="font-semibold text-text">Direct Interstate Corridor</span></span>
          </div>
          <span className="rounded-full bg-success/10 px-3 py-1 text-xs font-semibold text-success">Verified Route</span>
        </div>
      </div>

      {/* 3. Dispatch Priority */}
      <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm space-y-6" role="radiogroup" aria-label="Priority">
        <div className="flex gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-fill/20 text-lg font-bold text-brand-dark">3</div>
          <div>
            <h3 className="text-lg font-bold text-text">Dispatch Priority Level</h3>
            <p className="text-sm text-muted">Determine how quickly a truck is assigned and dispatched for this load</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          <button 
            type="button" 
            role="radio"
            aria-checked={draft.priority === 'high'}
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
            role="radio"
            aria-checked={draft.priority === 'medium'}
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
            role="radio"
            aria-checked={draft.priority === 'low'}
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
