import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ArrowLeft, ArrowRight, Minimize2, Package, X } from 'lucide-react'
import { Button, IconButton, Modal, useConfirm } from '@/components/ui'
import { shipmentsAPI } from '@/services/api'
import { useDraftStore, type DraftShipmentData } from '@/store/draftStore'
import { apiErrorMessage } from '@/components/shipments/format'
import StepIndicator from '@/components/shipments/wizard/StepIndicator'
import RouteStep from '@/components/shipments/wizard/RouteStep'
import CargoStep from '@/components/shipments/wizard/CargoStep'
import VehicleStep from '@/components/shipments/wizard/VehicleStep'
import ReviewStep from '@/components/shipments/wizard/ReviewStep'
import { buildShipmentPayload } from '@/components/shipments/wizard/payload'
import { STEPS, firstInvalidStep, validateStep, type StepId } from '@/components/shipments/wizard/validation'

/**
 * Create shipment, in four steps: Route, Cargo, Vehicle, Review. Opened from anywhere
 * through the draft store; the draft survives closing, minimizing and reloads.
 */
export default function AddShipmentModal() {
  const { isModalOpen, isMinimized, formData, setFormData, openModal, minimizeModal, expandModal, closeModal, clearDraft } = useDraftStore()
  const queryClient = useQueryClient()
  const { confirm } = useConfirm()
  const [stepIndex, setStepIndex] = useState(0)
  // Steps the user has tried to leave; their errors show from then on.
  const [attempted, setAttempted] = useState<Set<StepId>>(new Set())
  const body = useRef<HTMLDivElement>(null)

  // Errors belong to one sitting: closing the window, or a new one opening, starts with none showing
  useEffect(() => { if (!isModalOpen) setAttempted(new Set()) }, [isModalOpen])

  const step = STEPS[stepIndex].id
  const errors = attempted.has(step) ? validateStep(step, formData) : {}
  const update = (patch: Partial<DraftShipmentData>) => setFormData(prev => ({ ...prev, ...patch }))

  const goTo = (id: StepId) => {
    setStepIndex(STEPS.findIndex(s => s.id === id))
    // The dialog body scrolls; start each step at its top.
    body.current?.parentElement?.scrollTo({ top: 0 })
  }

  const mutation = useMutation({
    mutationFn: (data: DraftShipmentData) => shipmentsAPI.create(buildShipmentPayload(data)),
    onSuccess: () => {
      clearDraft()
      setStepIndex(0)
      setAttempted(new Set())
      queryClient.invalidateQueries({ queryKey: ['shipments'] })
      queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      queryClient.invalidateQueries({ queryKey: ['fleet-summary'] })
      toast.success('Shipment created')
    },
    onError: (error: unknown) => toast.error(apiErrorMessage(error, 'We could not create the shipment. Try again.')),
  })

  const next = () => {
    if (Object.keys(validateStep(step, formData)).length > 0) {
      setAttempted(prev => new Set(prev).add(step))
      return
    }
    goTo(STEPS[stepIndex + 1].id)
  }

  const submit = () => {
    const invalid = firstInvalidStep(formData)
    if (invalid) {
      setAttempted(prev => new Set(prev).add(invalid))
      goTo(invalid)
      toast.error('Some details are missing. Check the highlighted fields.')
      return
    }
    mutation.mutate(formData)
  }

  const startOver = async () => {
    const ok = await confirm({
      title: 'Start over?',
      message: 'Everything entered for this shipment is cleared.',
      confirmLabel: 'Clear draft',
      tone: 'danger',
    })
    if (!ok) return
    clearDraft()
    setStepIndex(0)
    setAttempted(new Set())
    openModal()
  }

  if (!isModalOpen) return null

  if (isMinimized) {
    const from = formData.origin_name || 'No pickup yet'
    const to = formData.delivery_point_name || 'no destination yet'
    return (
      <div
        role="region"
        aria-label="Shipment draft"
        className="fixed inset-x-4 bottom-4 z-40 mx-auto flex max-w-md items-center gap-3 rounded-full border border-border bg-surface py-2 pl-4 pr-2 shadow-raised animate-fade-in-up"
      >
        <Package size={18} aria-hidden="true" className="shrink-0 text-brand" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-text">Shipment draft</p>
          <p className="truncate text-xs text-muted">{from} to {to}</p>
        </div>
        <Button size="sm" variant="secondary" onClick={expandModal}>Resume</Button>
        <IconButton size="sm" label="Close draft" icon={<X size={16} />} onClick={closeModal} />
      </div>
    )
  }

  const isLast = stepIndex === STEPS.length - 1

  return (
    <Modal
      open
      onClose={closeModal}
      title="Create shipment"
      description="Your draft is kept if you close this window."
      size="lg"
      closeOnBackdrop={false}
      footer={
        <>
          <div className="flex gap-2 sm:mr-auto">
            <Button variant="ghost" icon={<Minimize2 size={16} />} onClick={minimizeModal}>Minimize</Button>
            <Button variant="ghost" onClick={startOver}>Start over</Button>
          </div>
          {stepIndex > 0 && (
            <Button variant="secondary" icon={<ArrowLeft size={16} />} onClick={() => goTo(STEPS[stepIndex - 1].id)}>Back</Button>
          )}
          {isLast ? (
            <Button onClick={submit} loading={mutation.isPending}>Create shipment</Button>
          ) : (
            <Button onClick={next}>
              Next: {STEPS[stepIndex + 1].label} <ArrowRight size={16} aria-hidden="true" />
            </Button>
          )}
        </>
      }
    >
      <div ref={body} className="space-y-6">
        <StepIndicator steps={STEPS} current={stepIndex} />
        {step === 'route' && <RouteStep data={formData} update={update} errors={errors} />}
        {step === 'cargo' && <CargoStep data={formData} update={update} errors={errors} />}
        {step === 'vehicle' && <VehicleStep data={formData} update={update} errors={errors} />}
        {step === 'review' && <ReviewStep data={formData} goTo={goTo} />}
      </div>
    </Modal>
  )
}
