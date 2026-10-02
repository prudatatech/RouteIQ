import { useState } from 'react'
import { Alert, Button, Card, Input, Select } from '@/components/ui'
import type { BusinessProfile } from '@/types/load'
import { checkGstin, normalizeGstin } from '@/utils/gstin'
import { emptyProfile, profileErrors } from './helpers'

// The backend's enums (schemas/loads.ts): anything else is refused
const BUSINESS_TYPES = ['manufacturer', 'trader', 'distributor', 'retailer', 'exporter', 'other']
  .map(v => ({ value: v, label: v[0].toUpperCase() + v.slice(1) }))
const MONTHLY = ['1-5', '6-20', '21-50', '50+'].map(v => ({ value: v, label: v }))



/** Asked once after the first sign-in (PRD 9). The same details are used for every later load. */
export default function BusinessProfileStep({ initial, saving, error, onSave, onBack }: {
  initial?: Partial<BusinessProfile>
  saving: boolean
  error?: string | null
  onSave: (profile: BusinessProfile) => void
  onBack: () => void
}) {
  const [p, setP] = useState<BusinessProfile>({ ...emptyProfile(), ...initial })
  const [attempted, setAttempted] = useState(false)
  const errors = attempted ? profileErrors(p) : {}
  const set = (patch: Partial<BusinessProfile>) => setP(prev => ({ ...prev, ...patch }))

  const submit = () => {
    setAttempted(true)
    if (Object.keys(profileErrors(p)).length > 0) return
    onSave({ ...p, gstin: normalizeGstin(p.gstin), full_name: p.full_name.trim(), business_name: p.business_name.trim() })
  }

  const live = p.gstin.trim().length >= 15 ? checkGstin(p.gstin) : null

  return (
    <Card padded className="space-y-4 !p-4 sm:!p-6" role="form" aria-label="Business profile">
      <div>
        <h2 className="text-lg font-semibold text-text">One last thing: your business details</h2>
        <p className="text-sm text-muted">We ask this once. It appears on your lorry receipts (LR), invoices and e-Way Bills.</p>
      </div>
      <Input label="Full name" required value={p.full_name} onChange={e => set({ full_name: e.target.value })} error={errors.full_name} autoComplete="name" />
      <Input label="Business name" required value={p.business_name} onChange={e => set({ business_name: e.target.value })} error={errors.business_name} autoComplete="organization" />
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-text">Account type <span className="text-danger" aria-hidden="true">*</span></legend>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {([['customer', 'Customer'], ['business_partner', 'Business Partner']] as const).map(([v, l]) => (
            <label key={v} className="flex cursor-pointer items-center gap-2">
              <input type="radio" name="account_type" checked={p.account_type === v} onChange={() => set({ account_type: v })} className="h-4 w-4 accent-brand" /> {l}
            </label>
          ))}
        </div>
      </fieldset>
      <Input
        label="GSTIN" required={p.account_type === 'business_partner'} value={p.gstin} maxLength={15}
        onChange={e => set({ gstin: e.target.value.toUpperCase() })} error={errors.gstin}
        hint={live?.valid ? 'This GSTIN looks right.' : 'Optional for a Customer. Used for your e-Way Bill and GST invoice.'}
      />
      <Input label="Business address" required value={p.address} onChange={e => set({ address: e.target.value })} error={errors.address} autoComplete="street-address" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Pin code" required inputMode="numeric" maxLength={6} value={p.pincode} onChange={e => set({ pincode: e.target.value.replace(/\D/g, '').slice(0, 6) })} error={errors.pincode} autoComplete="postal-code" />
        <Input label="Email (optional)" type="email" value={p.email} onChange={e => set({ email: e.target.value })} error={errors.email} hint="We send your documents here when you are not on WhatsApp." autoComplete="email" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Business type" value={p.business_type} placeholder="Choose" onChange={e => set({ business_type: e.target.value as BusinessProfile['business_type'] })} options={BUSINESS_TYPES} />
        <Select label="Average monthly loads" value={p.monthly_loads} placeholder="Choose" onChange={e => set({ monthly_loads: e.target.value as BusinessProfile['monthly_loads'] })} options={MONTHLY} />
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onBack}>Back to my load</Button>
        <Button loading={saving} onClick={submit}>Save and submit load</Button>
      </div>
    </Card>
  )
}
