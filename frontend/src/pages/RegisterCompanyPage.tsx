import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { orgAPI, orgRegisterAPI } from '@/services/api'
import { Alert, Button, Card, Input, Textarea } from '@/components/ui'
import { errorMessage, serverFieldError } from '@/utils/display'
import { useOrgStore } from '@/store/orgStore'
import type { OrgRegistration } from '@/utils/orgs'

type Errors = Partial<Record<keyof OrgRegistration, string>>

const EMPTY: OrgRegistration = { name: '', legal_name: '', gstin: '', pan: '', state: '', city: '', address: '', pincode: '', phone: '', email: '' }

/** A signed-in person registers their logistics company. It stays pending until the MargixIndia team approves it. */
export default function RegisterCompanyPage() {
  const navigate = useNavigate()
  const [form, setForm] = useState<OrgRegistration>(EMPTY)
  const [errors, setErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const set = (key: keyof OrgRegistration, upper = false) => (value: string) => {
    setForm(f => ({ ...f, [key]: upper ? value.toUpperCase() : value }))
    setErrors(e => ({ ...e, [key]: undefined }))
    setFormError(null)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (submitting) return
    if (form.name.trim().length < 2) { setErrors({ name: 'Enter the company name (at least 2 characters).' }); return }
    setSubmitting(true)
    try {
      const org = await orgRegisterAPI.create('logistic_company', form)
      // The new organisation is the user's own now; make it the active one and show the waiting screen
      const memberships = await orgAPI.mine()
      useOrgStore.getState().setMemberships(memberships)
      useOrgStore.getState().setActiveOrg(org.id)
      toast.success('Registration sent')
      navigate('/waiting-for-approval', { replace: true })
    } catch (err) {
      const named = serverFieldError(err)
      if (named && named.field in EMPTY) setErrors({ [named.field]: named.message })
      else setFormError(errorMessage(err, 'We could not send your registration. Try again.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-bg text-text">
      <header className="mx-auto flex w-full max-w-content items-center px-4 py-4 sm:px-6">
        <Link to="/" className="flex items-center gap-2.5 rounded-control text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
          <img src="/margix-logo.png" alt="" className="h-8 w-8 object-contain" />
          <span className="text-lg font-semibold">MargixIndia</span>
        </Link>
      </header>
      <main className="mx-auto w-full max-w-form flex-1 px-4 pb-12 pt-4 sm:px-6">
        <h1 className="text-2xl font-semibold sm:text-3xl">Register your logistics company</h1>
        <p className="mt-1 text-sm text-muted sm:text-base">
          Tell us about your company. The MargixIndia team checks the details and approves it before you can start.
        </p>
        <Card padded className="mt-6">
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit} noValidate>
            <Input label="Company name" required className="sm:col-span-2" value={form.name} error={errors.name} onChange={ev => set('name')(ev.target.value)} autoComplete="organization" />
            <Input label="Legal name" hint="As on your GST certificate." className="sm:col-span-2" value={form.legal_name} error={errors.legal_name} onChange={ev => set('legal_name')(ev.target.value)} />
            <Input label="GSTIN" value={form.gstin} error={errors.gstin} onChange={ev => set('gstin', true)(ev.target.value)} maxLength={15} />
            <Input label="PAN" value={form.pan} error={errors.pan} onChange={ev => set('pan', true)(ev.target.value)} maxLength={10} />
            <Input label="State" value={form.state} error={errors.state} onChange={ev => set('state')(ev.target.value)} />
            <Input label="City" value={form.city} error={errors.city} onChange={ev => set('city')(ev.target.value)} />
            <Textarea label="Address" className="sm:col-span-2" value={form.address} error={errors.address} onChange={ev => set('address')(ev.target.value)} />
            <Input label="Pincode" value={form.pincode} error={errors.pincode} onChange={ev => set('pincode')(ev.target.value)} inputMode="numeric" maxLength={6} />
            <Input label="Phone" type="tel" value={form.phone} error={errors.phone} onChange={ev => set('phone')(ev.target.value)} autoComplete="tel" />
            <Input label="Company email" type="email" className="sm:col-span-2" value={form.email} error={errors.email} onChange={ev => set('email')(ev.target.value)} autoComplete="email" />
            {formError && <div className="sm:col-span-2"><Alert tone="danger" title="We could not send your registration">{formError}</Alert></div>}
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <Button type="submit" size="lg" loading={submitting}>Send for approval</Button>
              <Link to="/waiting-for-approval" className="inline-flex h-12 items-center px-3 text-sm text-muted hover:text-text">Cancel</Link>
            </div>
          </form>
        </Card>
      </main>
    </div>
  )
}
