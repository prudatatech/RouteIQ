import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil } from 'lucide-react'
import toast from 'react-hot-toast'
import { bookingsAPI } from '@/services/api'
import { Button, DetailList, Input, Modal, Select, Textarea } from '@/components/ui'
import { errorMessage } from '@/utils/display'
import { profileKey, useCustomerProfile } from './useCustomerProfile'
import {
  GST_STATES, profileChanges, profileToForm, validateProfile, type CustomerProfile, type ProfileField, type ProfileForm,
} from '@/utils/customerProfile'

/** The editor: a form in a modal that saves only what changed. Used from the booking drawer and the invoice page. */
export function CustomerProfileEditor({ customerId, open, onClose, onSaved }: {
  customerId: string
  open: boolean
  onClose: () => void
  onSaved?: (profile: CustomerProfile) => void
}) {
  const queryClient = useQueryClient()
  const profile = useCustomerProfile(open ? customerId : null)
  const [form, setForm] = useState<ProfileForm>(() => profileToForm(null))
  const [errors, setErrors] = useState<Partial<Record<ProfileField, string>>>({})
  const [serverError, setServerError] = useState<string | undefined>()

  useEffect(() => {
    if (open && profile.data) { setForm(profileToForm(profile.data)); setErrors({}); setServerError(undefined) }
  }, [open, profile.data])

  const save = useMutation({
    mutationFn: (changes: ReturnType<typeof profileChanges>) => bookingsAPI.saveCustomerProfile(customerId, changes),
    onSuccess: saved => {
      queryClient.setQueryData(profileKey(customerId), saved)
      // Names and invoices read from the profile, so refresh what shows them
      for (const key of ['customer-bookings', 'finance', 'shipments']) queryClient.invalidateQueries({ queryKey: [key] })
      toast.success('Customer details saved')
      onSaved?.(saved)
      onClose()
    },
    onError: err => setServerError(errorMessage(err, 'We could not save these details. Try again.')),
  })

  const set = (field: ProfileField) => (e: { target: { value: string } }) => {
    setForm(f => ({ ...f, [field]: e.target.value }))
    setErrors(er => ({ ...er, [field]: undefined }))
    setServerError(undefined)
  }

  const submit = () => {
    const found = validateProfile(form)
    setErrors(found)
    if (Object.keys(found).length > 0) return
    const changes = profileChanges(form, profile.data)
    if (Object.keys(changes).length === 0) { onClose(); return }
    setServerError(undefined)
    save.mutate(changes)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Customer details"
      description={`Used as the buyer on this customer's invoices${profile.data?.phone ? ` (${profile.data.phone})` : ''}. Invoices already issued keep the buyer they were issued with.`}
      onSubmit={submit}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={save.isPending} disabled={!profile.data}>Save details</Button>
        </>
      )}
    >
      {profile.isLoading && <p className="text-sm text-muted">Loading details…</p>}
      {profile.isError && <p role="alert" className="text-sm text-danger">We could not load this customer. Close this and try again.</p>}
      {profile.data && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Name" value={form.full_name} onChange={set('full_name')} maxLength={120} error={errors.full_name} />
          <Input label="Company name" value={form.company_name} onChange={set('company_name')} maxLength={160} error={errors.company_name} />
          <Input label="GSTIN" value={form.gstin} onChange={e => set('gstin')({ target: { value: e.target.value.toUpperCase() } })} maxLength={15} error={errors.gstin} className="font-mono" />
          <Input label="Email" type="email" value={form.email} onChange={set('email')} maxLength={160} error={errors.email} />
          <Textarea label="Billing address" className="sm:col-span-2" rows={2} value={form.billing_address} onChange={set('billing_address')} maxLength={300} error={errors.billing_address} />
          <Input label="City" value={form.city} onChange={set('city')} maxLength={80} error={errors.city} />
          <Select
            label="State"
            value={form.state}
            onChange={set('state')}
            error={errors.state}
            hint="A GSTIN's state must match this state"
            options={[{ value: '', label: 'Not set' }, ...GST_STATES.map(s => ({ value: s, label: s }))]}
          />
          <Input label="PIN code" inputMode="numeric" value={form.pincode} onChange={set('pincode')} maxLength={6} error={errors.pincode} />
          {serverError && <p role="alert" className="text-sm text-danger sm:col-span-2">{serverError}</p>}
        </div>
      )}
    </Modal>
  )
}

/** The customer's details for invoices with an Edit action. */
export function CustomerDetailsBlock({ customerId }: { customerId: string | null | undefined }) {
  const profile = useCustomerProfile(customerId)
  const [editing, setEditing] = useState(false)
  if (!customerId) return null
  const p = profile.data
  return (
    <section aria-label="Customer details" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-text">Customer details</h3>
        <Button variant="secondary" size="sm" icon={<Pencil size={14} />} onClick={() => setEditing(true)}>Edit</Button>
      </div>
      {profile.isLoading && <p className="text-sm text-muted">Loading details…</p>}
      {profile.isError && <p role="alert" className="text-sm text-danger">We could not load the customer details.</p>}
      {p && (
        <>
          {!p.billing_ready && <p className="text-sm text-muted">The GSTIN, billing address and state are not all on record, so invoices show the buyer without them.</p>}
          <DetailList
            items={[
              { label: 'Name', value: p.full_name || 'Not given' },
              { label: 'Company', value: p.company_name || 'Not given' },
              { label: 'GSTIN', value: p.gstin ? <span className="font-mono">{p.gstin}</span> : 'Not given' },
              { label: 'Email', value: p.email || 'Not given' },
              { label: 'Billing address', value: p.billing_address || 'Not given' },
              { label: 'City', value: p.city || 'Not given' },
              { label: 'State', value: p.state || 'Not given' },
              { label: 'PIN code', value: p.pincode || 'Not given' },
            ]}
          />
        </>
      )}
      <CustomerProfileEditor customerId={customerId} open={editing} onClose={() => setEditing(false)} />
    </section>
  )
}
