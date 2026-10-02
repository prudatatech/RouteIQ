import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Alert, Button, Page, PageHeader } from '@/components/ui'
import { publicAPI, vendorAPI } from '@/services/api'
import { useAuthStore } from '@/store/authStore'
import { clearGuestDraft, loadGuestDraft, saveGuestDraft } from '@/utils/guestDraft'
import { errorMessage } from '@/utils/display'
import type { BusinessProfile, LoadDraft, PostedLoad, ProductRow, Recommendation } from '@/types/load'
import AddressStep from '@/components/load-post/AddressStep'
import BusinessProfileStep from '@/components/load-post/BusinessProfileStep'
import HsnSearch from '@/components/load-post/HsnSearch'
import LoadConfirmation from '@/components/load-post/LoadConfirmation'
import OtpModal from '@/components/load-post/OtpModal'
import ProductRows from '@/components/load-post/ProductRows'
import RecommendationList from '@/components/load-post/RecommendationList'
import ReviewStep from '@/components/load-post/ReviewStep'
import TransportStep from '@/components/load-post/TransportStep'
import { useLoadAssist } from '@/components/load-post/useLoadAssist'
import {
  applyRecommendation, emptyDraft, emptyRow, firstInvalidStep, LAST_STEP, mergeDraft, STEP_LABELS, stepForRecommendation,
  toPayload, validateStep,
} from '@/components/load-post/logic'

/** Where the email and password sign-in sends the vendor back to: the saved form, at the review step. */
const RESUME_PATH = '/vendor/request?resume=1'
const EMAIL_SIGN_IN = `/login?as=vendor&next=${encodeURIComponent(RESUME_PATH)}`

/** The draft from this browser, or an empty one seeded from the lane the Find a truck page passed in the link. */
function initialDraft(params: URLSearchParams): LoadDraft {
  const saved = loadGuestDraft<Partial<LoadDraft>>('load')
  if (saved) return mergeDraft(saved)
  const d = emptyDraft()
  const city = (v: string | null) => (v ? v.split(',')[0].trim() : '')
  d.delivery_city = city(params.get('query'))
  d.pickup_city = city(params.get('from'))
  const weight = parseFloat(params.get('weight') ?? '')
  if (Number.isFinite(weight) && weight > 0) d.items[0].weight_kg = String(weight)
  return d
}

function Stepper({ step, onGo }: { step: number; onGo: (s: number) => void }) {
  return (
    <nav aria-label="Steps">
      <p className="text-sm font-medium text-text sm:hidden">Step {step + 1} of {STEP_LABELS.length}: {STEP_LABELS[step]}</p>
      <ol className="mt-2 flex gap-1 sm:mt-0">
        {STEP_LABELS.map((label, i) => (
          <li key={label} className="min-w-0 flex-1">
            <button
              type="button"
              disabled={i > step}
              onClick={() => onGo(i)}
              aria-current={i === step ? 'step' : undefined}
              className={clsx(
                'flex w-full flex-col gap-1 border-t-4 pt-1.5 text-left text-xs',
                i <= step ? 'border-brand-fill' : 'border-border',
                i === step ? 'font-semibold text-text' : 'text-muted',
                i > step && 'cursor-default',
              )}
            >
              <span className="hidden truncate sm:block">{i + 1}. {label}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  )
}

export default function VendorShipmentRequestPage() {
  const [params] = useSearchParams()
  const queryClient = useQueryClient()
  const token = useAuthStore(s => s.token)

  const [draft, setDraft] = useState<LoadDraft>(() => {
    const d = initialDraft(params)
    // Back from the email sign-in: show the review again. Nothing is posted until Submit Load is pressed.
    return params.get('resume') === '1' ? { ...d, step: LAST_STEP } : d
  })
  const [attempted, setAttempted] = useState<Record<number, boolean>>({})
  const [stage, setStage] = useState<'form' | 'profile' | 'done'>('form')
  const [posted, setPosted] = useState<PostedLoad | null>(null)
  const [otpOpen, setOtpOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [profileInitial, setProfileInitial] = useState<Partial<BusinessProfile>>({})
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [cameBack] = useState(() => params.get('resume') === '1')
  const resumed = cameBack && !!token

  const patch = useCallback((p: Partial<LoadDraft>) => setDraft(d => ({ ...d, ...p })), [])

  // Save on every change. A posted load is gone from the draft.
  useEffect(() => {
    if (stage === 'done') return
    saveGuestDraft('load', draft)
  }, [draft, stage])

  const vehiclesQuery = useQuery({ queryKey: ['public', 'vehicle-classes'], queryFn: () => publicAPI.vehicleClasses(), staleTime: 60 * 60 * 1000 })
  const vehicles = useMemo(() => [...(vehiclesQuery.data ?? [])].sort((a, b) => a.sort - b.sort), [vehiclesQuery.data])

  const { assist, loading: assistLoading } = useLoadAssist(draft, stage === 'form')

  // While the person has not chosen the transport themselves, it follows the suggestion.
  useEffect(() => {
    const s = assist?.suggested
    if (!s || draft.transport_touched) return
    const capacity = String(s.capacity_t)
    if (draft.load_type !== s.load_type || draft.vehicle_class !== s.vehicle_class || draft.capacity_t !== capacity) {
      patch({ load_type: s.load_type, vehicle_class: s.vehicle_class, capacity_t: capacity })
    }
  }, [assist, draft.transport_touched, draft.load_type, draft.vehicle_class, draft.capacity_t, patch])

  const step = draft.step
  const errors = attempted[step] ? validateStep(draft, step) : {}
  const recs = useMemo(() => assist?.recommendations ?? [], [assist])
  const recsFor = (s: number, codes?: string[]): Recommendation[] =>
    recs.filter(r => stepForRecommendation(r.code) === s && (!codes || codes.includes(r.code)))
  const apply = (action: NonNullable<Recommendation['action']>) => setDraft(d => applyRecommendation(d, action))
  const notes = (list: Recommendation[]) => <RecommendationList recommendations={list} onApply={apply} vehicles={vehicles} />

  const goTo = (s: number) => { patch({ step: s }); window.scrollTo?.({ top: 0 }) }
  const next = () => {
    setAttempted(a => ({ ...a, [step]: true }))
    if (Object.keys(validateStep(draft, step)).length === 0) goTo(step + 1)
  }

  const changeRow = (i: number, p: Partial<ProductRow>) => setDraft(d => ({ ...d, items: d.items.map((r, n) => (n === i ? { ...r, ...p } : r)) }))
  const addRow = () => setDraft(d => ({ ...d, items: [...d.items, emptyRow()] }))
  const removeRow = (i: number) => setDraft(d => (i === 0 ? d : { ...d, items: d.items.filter((_, n) => n !== i) }))

  // ----- submit -----

  const post = async () => {
    setSubmitting(true); setSubmitError(null)
    try {
      const result = await vendorAPI.postLoad(toPayload(draft))
      clearGuestDraft('load')
      setPosted(result)
      setStage('done')
      queryClient.invalidateQueries({ queryKey: ['vendor', 'posted-loads'] })
    } catch (err) {
      setSubmitError(errorMessage(err, 'We could not post your load. Nothing was lost; try again.'))
      setStage('form')
    } finally {
      setSubmitting(false)
    }
  }

  /** After sign-in: the business profile once, then the post. */
  const afterSignIn = async () => {
    setSubmitting(true); setSubmitError(null)
    try {
      const profile = await vendorAPI.businessProfile().catch(() => null)
      if (!profile || !profile.complete) {
        setProfileInitial(profile ?? {})
        setStage('profile')
        setSubmitting(false)
        return
      }
    } catch { /* fall through to the post */ }
    await post()
  }

  const onSubmit = () => {
    const bad = firstInvalidStep(draft)
    if (bad !== null) {
      setAttempted(a => ({ ...a, [bad]: true }))
      goTo(bad)
      return
    }
    if (!token) { setOtpOpen(true); return }
    void afterSignIn()
  }

  const saveProfile = async (profile: BusinessProfile) => {
    setProfileSaving(true); setProfileError(null)
    try {
      await vendorAPI.saveBusinessProfile(profile)
    } catch (err) {
      setProfileError(errorMessage(err, 'We could not save your details. Try again.'))
      setProfileSaving(false)
      return
    }
    setProfileSaving(false)
    await post()
  }

  const postAnother = () => {
    clearGuestDraft('load')
    setDraft(emptyDraft())
    setAttempted({})
    setPosted(null)
    setStage('form')
    setSubmitError(null)
  }

  // ----- screens -----

  if (stage === 'done' && posted) {
    const vehicleName = vehicles.find(v => v.key === draft.vehicle_class)?.name ?? draft.vehicle_class
    return (
      <Page width="form">
        <LoadConfirmation
          loadId={posted.id} loadNumber={posted.load_number}
          pickupCity={draft.pickup_city} deliveryCity={draft.delivery_city} pickupDate={draft.pickup_date || null}
          vehicleName={vehicleName} onPostAnother={postAnother}
        />
      </Page>
    )
  }

  if (stage === 'profile') {
    return (
      <Page width="form">
        <BusinessProfileStep
          initial={profileInitial} saving={profileSaving || submitting} error={profileError}
          onSave={saveProfile} onBack={() => setStage('form')}
        />
      </Page>
    )
  }

  const first = draft.items[0]

  return (
    <Page width="form">
      <PageHeader title="Post a load" description="Tell us what you are moving and where. You sign in only when you submit." />

      {draft.reposted_from && (
        <Alert tone="info" title="Copied from an earlier load">Everything is filled in except the dates. Choose the new pickup date, then review.</Alert>
      )}
      {resumed && step === LAST_STEP && (
        <Alert tone="success" title="Welcome back">Your load is exactly as you left it. Press Submit Load when you are ready.</Alert>
      )}

      <Stepper step={step} onGo={goTo} />

      <section aria-labelledby="step-title" className="space-y-4">
        <h2 id="step-title" className="text-lg font-semibold text-text">{STEP_LABELS[step]}</h2>

        {step === 0 && (
          <div className="space-y-4">
            <HsnSearch
              row={first} index={0} onChange={p => changeRow(0, p)}
              errors={{ name: errors.product_name_0, hsn: errors.hsn_code_0, rate: errors.gst_rate_0 }}
            />
            {notes(recsFor(0))}
          </div>
        )}
        {step === 1 && (
          <div className="space-y-4">
            <ProductRows
              items={draft.items} onChangeRow={changeRow} onAdd={addRow} onRemove={removeRow} errors={errors}
              bulkHint={recs.find(r => r.code === 'bulk_template')?.message}
            />
            {notes(recsFor(1).filter(r => r.code !== 'bulk_template'))}
          </div>
        )}
        {step === 2 && (
          <AddressStep
            draft={draft} onChange={patch} errors={errors}
            pickupNotes={notes(recsFor(2, ['same_day_pickup']))}
            deliveryNotes={notes(recsFor(2, ['same_city', 'interstate_igst']))}
          />
        )}
        {step === 3 && (
          <TransportStep
            draft={draft} onChange={patch} errors={errors} vehicles={vehicles} vehiclesLoading={vehiclesQuery.isLoading}
            assist={assist} notes={notes(recsFor(3))}
          />
        )}
        {step === 4 && (
          <>
            {notes(recs.filter(r => r.severity === 'warn' && r.code !== 'eway_required'))}
            <ReviewStep
              draft={draft} assist={assist} assistLoading={assistLoading} vehicles={vehicles}
              onEdit={goTo} onSubmit={onSubmit} submitting={submitting} signedIn={!!token} error={submitError}
            />
          </>
        )}
      </section>

      {step < LAST_STEP && (
        <div className="flex gap-2 sm:justify-end">
          {step > 0 && <Button variant="secondary" size="lg" onClick={() => goTo(step - 1)}>Back</Button>}
          <Button size="lg" className="flex-1 sm:flex-none" onClick={next}>Next</Button>
        </div>
      )}
      {step === LAST_STEP && (
        <div><Button variant="ghost" onClick={() => goTo(step - 1)}>Back</Button></div>
      )}

      <OtpModal
        open={otpOpen}
        onClose={() => setOtpOpen(false)}
        emailSignInHref={EMAIL_SIGN_IN}
        onVerified={() => { setOtpOpen(false); void afterSignIn() }}
      />
    </Page>
  )
}
