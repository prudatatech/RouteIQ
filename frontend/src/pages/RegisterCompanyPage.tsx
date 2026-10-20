import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Building2, FileCheck, MapPin, ShieldCheck, ArrowRight, ArrowLeft } from 'lucide-react'
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
      {/* Top Navbar */}
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-16 w-full max-w-content items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5 rounded-control text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
            <img src="/margix-logo.png" alt="" className="h-8 w-8 object-contain" />
            <span className="text-lg font-bold tracking-tight">
              Margix<span className="text-brand">India</span>
            </span>
          </Link>
          <Link to="/login" className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-text">
            <ArrowLeft size={14} /> Back to Sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        {/* Page Header */}
        <div className="space-y-2 mb-8">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-soft text-brand text-xs font-bold uppercase tracking-wider">
            <Building2 size={13} /> Enterprise Transport Onboarding
          </div>
          <h1 className="text-2xl font-extrabold text-text sm:text-3xl tracking-tight">
            Register your logistics company
          </h1>
          <p className="text-sm text-muted sm:text-base leading-relaxed max-w-2xl">
            Tell us about your transport or logistics company. The MargixIndia operations team checks the details and approves it within 24-48 business hours.
          </p>
        </div>

        <Card padded className="shadow-raised border border-border">
          <form className="space-y-8" onSubmit={submit} noValidate>
            {/* Section 1: Business Identity */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 border-b border-border pb-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-control bg-brand-soft text-brand">
                  <Building2 size={16} />
                </span>
                <h2 className="text-sm font-bold text-text uppercase tracking-wider">1. Business Identity</h2>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Company name"
                  required
                  className="sm:col-span-2"
                  value={form.name}
                  error={errors.name}
                  onChange={ev => set('name')(ev.target.value)}
                  autoComplete="organization"
                  placeholder="e.g. Acme Logistics India Pvt Ltd"
                />
                <Input
                  label="Legal trade name"
                  hint="As registered on your GST certificate"
                  className="sm:col-span-2"
                  value={form.legal_name}
                  error={errors.legal_name}
                  onChange={ev => set('legal_name')(ev.target.value)}
                  placeholder="e.g. Acme Transport & Logistics Private Limited"
                />
                <Input
                  label="Company email"
                  type="email"
                  value={form.email}
                  error={errors.email}
                  onChange={ev => set('email')(ev.target.value)}
                  autoComplete="email"
                  placeholder="operations@acmelogistics.com"
                />
                <Input
                  label="Phone"
                  type="tel"
                  value={form.phone}
                  error={errors.phone}
                  onChange={ev => set('phone')(ev.target.value)}
                  autoComplete="tel"
                  placeholder="+91 98765 43210"
                />
              </div>
            </div>

            {/* Section 2: Statutory Compliance */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 border-b border-border pb-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-control bg-brand-soft text-brand">
                  <FileCheck size={16} />
                </span>
                <h2 className="text-sm font-bold text-text uppercase tracking-wider">2. Tax &amp; Regulatory Identification</h2>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="GSTIN"
                  hint="15 alphanumeric characters"
                  value={form.gstin}
                  error={errors.gstin}
                  onChange={ev => set('gstin', true)(ev.target.value)}
                  maxLength={15}
                  inputClassName="font-mono uppercase"
                  placeholder="27ABCDE1234F1Z5"
                />
                <Input
                  label="Company PAN"
                  hint="10 alphanumeric characters"
                  value={form.pan}
                  error={errors.pan}
                  onChange={ev => set('pan', true)(ev.target.value)}
                  maxLength={10}
                  inputClassName="font-mono uppercase"
                  placeholder="ABCDE1234F"
                />
              </div>
            </div>

            {/* Section 3: Headquarters Address */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 border-b border-border pb-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-control bg-brand-soft text-brand">
                  <MapPin size={16} />
                </span>
                <h2 className="text-sm font-bold text-text uppercase tracking-wider">3. Registered Office &amp; Address</h2>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Textarea
                  label="Address"
                  className="sm:col-span-2"
                  value={form.address}
                  error={errors.address}
                  onChange={ev => set('address')(ev.target.value)}
                  placeholder="Plot/Suite number, street, industrial area"
                  rows={2}
                />
                <Input
                  label="City"
                  value={form.city}
                  error={errors.city}
                  onChange={ev => set('city')(ev.target.value)}
                  placeholder="e.g. Mumbai"
                />
                <Input
                  label="State"
                  value={form.state}
                  error={errors.state}
                  onChange={ev => set('state')(ev.target.value)}
                  placeholder="e.g. Maharashtra"
                />
                <Input
                  label="Pincode"
                  value={form.pincode}
                  error={errors.pincode}
                  onChange={ev => set('pincode')(ev.target.value)}
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="400001"
                />
              </div>
            </div>

            {formError && (
              <Alert tone="danger" title="We could not send your registration">
                {formError}
              </Alert>
            )}

            <div className="pt-4 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-xs text-muted">
                <ShieldCheck size={16} className="text-success shrink-0" />
                <span>Encrypted submission · Margix Compliance Verified</span>
              </div>
              <div className="flex items-center gap-3 w-full sm:w-auto">
                <Link to="/waiting-for-approval" className="flex-1 sm:flex-initial text-center px-4 py-2 text-sm font-semibold text-muted hover:text-text">
                  Cancel
                </Link>
                <Button type="submit" size="lg" loading={submitting} className="flex-1 sm:flex-initial font-bold justify-center">
                  Send for approval <ArrowRight size={15} className="ml-1" />
                </Button>
              </div>
            </div>
          </form>
        </Card>
      </main>
    </div>
  )
}
