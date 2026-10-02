import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Page, PageHeader } from '@/components/ui'
import { publicAPI, vendorAPI } from '@/services/api'
import { useAuthStore } from '@/store/authStore'
import { useBlockedFromVendorActions } from '@/store/accountKind'
import NotVendorNotice from '@/components/vendor/NotVendorNotice'
import { clearGuestDraft, loadGuestDraft, saveGuestDraft } from '@/utils/guestDraft'
import { errorMessage } from '@/utils/display'
import type { BusinessProfile, LoadDraft, PostedLoad, ProductRow, Recommendation } from '@/types/load'
import AddressStep from '@/components/load-post/AddressStep'
import FormStepper from '@/components/load-post/FormStepper'
import StepActions from '@/components/load-post/StepActions'
import { scrollPageTop, useScrollToFirstInvalid } from '@/components/load-post/useScrollIntoView'
import BusinessProfileStep from '@/components/load-post/BusinessProfileStep'
import LoadConfirmation from '@/components/load-post/LoadConfirmation'
import OtpModal from '@/components/load-post/OtpModal'
import GoodsStep from '@/components/load-post/GoodsStep'
import { isProductRecommendation } from '@/components/load-post/helpers'
import RecommendationList from '@/components/load-post/RecommendationList'
import ReviewStep from '@/components/load-post/ReviewStep'
import TransportStep from '@/components/load-post/TransportStep'
import { useLoadAssist } from '@/components/load-post/useLoadAssist'
import {
  applyRecommendation, applyRowPatch, deriveCapacity, emptyDraft, emptyRow, itemTotals, LAST_STEP, STEP_LABELS, toPayload,
} from '@/components/load-post/logic'
import { mergeDraft } from '@/components/load-post/draft'
import { firstInvalidStep, stepForRecommendation, validateStep } from '@/components/load-post/validate'

/** Where the email and password sign-in sends the vendor back to: the saved form, at the review step. */
const RESUME_PATH = '/vendor/request?resume=1'
const EMAIL_SIGN_IN = `/login?next=${encodeURIComponent(RESUME_PATH)}`

/** The draft from this browser, or an empty one seeded from the lane the Find a truck page passed in the link. */
function initialDraft(params: URLSearchParams): LoadDraft {
  const saved = loadGuestDraft<Partial<LoadDraft>>('load')
  if (saved) return mergeDraft(saved)
  const d = emptyDraft()
  const city = (v: string | null) => (v ? v.split(',')[0].trim() : '')
  d.delivery_city = city(params.get('query'))
  d.pickup_city = city(params.get('from'))
  const weight = parseFloat(params.get('weight') ?? '')
  if (Number.isFinite(weight) && weight > 0) { d.items[0].weight_kg = String(weight) }
  return d
}

export default function VendorShipmentRequestPage() {
  const [params] = useSearchParams()
  const queryClient = useQueryClient()
  const token = useAuthStore(s => s.token)
  const blockedKind = useBlockedFromVendorActions()

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

  // The load type follows the suggestion until the person chooses one; the vehicle follows it while "Recommend for my goods" is on.
  useEffect(() => {
    const s = assist?.suggested
    if (!s) return
    const next: Partial<LoadDraft> = {}
    if (!draft.transport_touched && draft.load_type !== s.load_type) next.load_type = s.load_type
    // The server may suggest a type without a vehicle (nothing fits yet)
    const vehicle = s.vehicle_class ?? ''
    if (draft.vehicle_mode === 'recommend' && draft.vehicle_class !== vehicle) next.vehicle_class = vehicle
    if (Object.keys(next).length > 0) patch(next)
  }, [assist, draft.transport_touched, draft.vehicle_mode, draft.load_type, draft.vehicle_class, patch])

  // The capacity is never typed: it follows the suggestion and the chosen vehicle, and is sent as capacity_t.
  const capacity = deriveCapacity(assist?.suggested.capacity_t, vehicles.find(v => v.key === draft.vehicle_class), draft.vehicle_mode === 'manual')
  const capacityText = capacity === null || itemTotals(draft.items).weight_kg <= 0 ? '' : String(capacity)
  useEffect(() => {
    if (draft.capacity_t !== capacityText) patch({ capacity_t: capacityText })
  }, [capacityText, draft.capacity_t, patch])

  const step = draft.step
  const errors = attempted[step] ? validateStep(draft, step) : {}
  const recs = useMemo(() => assist?.recommendations ?? [], [assist])
  const recsFor = (s: number, codes?: string[]): Recommendation[] =>
    recs.filter(r => stepForRecommendation(r.code) === s && (!codes || codes.includes(r.code)))
  const apply = (action: NonNullable<Recommendation['action']>) => setDraft(d => applyRecommendation(d, action))
  const notes = (list: Recommendation[]) => <RecommendationList recommendations={list} onApply={apply} vehicles={vehicles} />

  const formRoot = useRef<HTMLElement>(null)
  const [focusTick, setFocusTick] = useState(0)
  useScrollToFirstInvalid(formRoot, focusTick)

  const goTo = (s: number) => { patch({ step: s }); scrollPageTop() }
  const next = () => {
    setAttempted(a => ({ ...a, [step]: true }))
    if (Object.keys(validateStep(draft, step)).length === 0) goTo(step + 1)
    else setFocusTick(t => t + 1)
  }

  const changeRow = (i: number, p: Partial<ProductRow>) => setDraft(d => ({ ...d, items: d.items.map((r, n) => (n === i ? applyRowPatch(r, p) : r)) }))
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
    if (blockedKind) return
    const bad = firstInvalidStep(draft)
    if (bad !== null) {
      setAttempted(a => ({ ...a, [bad]: true }))
      patch({ step: bad })
      setFocusTick(t => t + 1)
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
    const est = assist?.estimate
    return (
      <Page width="form">
        <LoadConfirmation
          loadId={posted.id} loadNumber={posted.load_number}
          pickupCity={draft.pickup_city} deliveryCity={draft.delivery_city} pickupDate={draft.pickup_date || null}
          vehicleName={vehicleName} statusNote={posted.status_note ?? null} onPostAnother={postAnother}
          priority={posted.priority ?? draft.priority}
          priceMin={posted.price_min_inr ?? est?.low ?? null} priceMax={posted.price_max_inr ?? est?.high ?? null}
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

  return (
    <Page width="form" className="!space-y-4">
      <PageHeader title="Post a load" description="Tell us what you are moving and where. You sign in only when you submit." />

      {blockedKind && <NotVendorNotice kind={blockedKind} />}
      {draft.reposted_from && (
        <Alert tone="info" title="Copied from an earlier load">Everything is filled in except the pickup date. Choose the new pickup date, then review.</Alert>
      )}
      {resumed && step === LAST_STEP && (
        <Alert tone="success" title="Welcome back">Your load is exactly as you left it. Press Submit Load when you are ready.</Alert>
      )}

      <FormStepper step={step} onGo={goTo} />

      <section aria-labelledby="step-title" className="space-y-3" ref={formRoot}>
        <h2 id="step-title" className="scroll-mt-24 text-lg font-semibold text-text">{STEP_LABELS[step]}</h2>

        {step === 0 && (
          <AddressStep
            draft={draft} onChange={patch} errors={errors}
            pickupNotes={notes(recsFor(0, ['same_day_pickup']))}
            deliveryNotes={notes(recsFor(0, ['same_city']))}
          />
        )}
        {step === 1 && (
          <GoodsStep
            items={draft.items} onChangeRow={changeRow} onAdd={addRow} onRemove={removeRow} errors={errors}
            recommendations={recs}
            notes={notes(recsFor(1).filter(r => r.code !== 'bulk_template' && r.code !== 'eway_required' && !isProductRecommendation(r)))}
            bulkHint={recs.find(r => r.code === 'bulk_template')?.message}
          />
        )}
        {step === 2 && (
          <TransportStep
            draft={draft} onChange={patch} errors={errors} vehicles={vehicles} vehiclesLoading={vehiclesQuery.isLoading}
            assist={assist} assistLoading={assistLoading}
            truckNotes={notes(recsFor(2).filter(r => r.code !== 'budget_below_estimate'))}
          />
        )}
        {step === 3 && (
          <>
            {notes(recs.filter(r => r.severity === 'warn' && r.code !== 'eway_required' && r.code !== 'budget_below_estimate' && !isProductRecommendation(r)))}
            <ReviewStep
              draft={draft} assist={assist} assistLoading={assistLoading} vehicles={vehicles}
              onEdit={goTo} onSubmit={onSubmit} submitting={submitting} signedIn={!!token} error={submitError} disabled={!!blockedKind}
            />
          </>
        )}
      </section>

      <StepActions step={step} last={LAST_STEP} onBack={() => goTo(step - 1)} onNext={next} />

      <OtpModal
        open={otpOpen}
        onClose={() => setOtpOpen(false)}
        emailSignInHref={EMAIL_SIGN_IN}
        onVerified={() => { setOtpOpen(false); void afterSignIn() }}
      />
    </Page>
  )
}
