import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { vehiclesAPI } from '@/services/api'
import toast from 'react-hot-toast'
import { FileText, Save, Truck, User } from 'lucide-react'
import { Modal, Button, Input, Select, StatusPill, useConfirm, type SelectOption } from '@/components/ui'
import { indianMobileError, rcNumberError } from '@/utils/validators'
import { expiryStatus } from '@/utils/documentExpiry'

// Must match backend-ts VehicleCreateSchema.vehicle_type; the server rejects anything else.
const VEHICLE_TYPES: SelectOption[] = [
  { value: 'truck', label: 'Truck' },
  { value: 'van', label: 'Van' },
  { value: 'bike', label: 'Bike' },
  { value: 'car', label: 'Car' },
]

const INDIAN_TRUCK_PRESETS: Record<string, { capacity_kg: number; container_length_ft: number; container_width_ft: number; container_height_ft: number; fuel_type: string; fuel_capacity_liters: number; fuel_efficiency_kmpl: number }> = {
  'Tata Ace (Chota Hathi)': { capacity_kg: 750, container_length_ft: 7, container_width_ft: 4.5, container_height_ft: 4.5, fuel_type: 'diesel', fuel_capacity_liters: 30, fuel_efficiency_kmpl: 18 },
  'Mahindra Bolero Pickup': { capacity_kg: 1200, container_length_ft: 8, container_width_ft: 5, container_height_ft: 5, fuel_type: 'diesel', fuel_capacity_liters: 50, fuel_efficiency_kmpl: 14 },
  'Ashok Leyland Dost': { capacity_kg: 1500, container_length_ft: 9, container_width_ft: 5.5, container_height_ft: 5, fuel_type: 'diesel', fuel_capacity_liters: 40, fuel_efficiency_kmpl: 16 },
  'Ashok Leyland Bada Dost': { capacity_kg: 2000, container_length_ft: 10, container_width_ft: 5.5, container_height_ft: 5.5, fuel_type: 'diesel', fuel_capacity_liters: 45, fuel_efficiency_kmpl: 15 },
  'Maruti Super Carry': { capacity_kg: 740, container_length_ft: 7, container_width_ft: 4.5, container_height_ft: 4, fuel_type: 'cng', fuel_capacity_liters: 30, fuel_efficiency_kmpl: 22 },
  'Tata Intra': { capacity_kg: 1500, container_length_ft: 9, container_width_ft: 5, container_height_ft: 5, fuel_type: 'diesel', fuel_capacity_liters: 40, fuel_efficiency_kmpl: 16 },
  'Tata Yodha': { capacity_kg: 2500, container_length_ft: 10, container_width_ft: 6, container_height_ft: 6, fuel_type: 'diesel', fuel_capacity_liters: 60, fuel_efficiency_kmpl: 14 },
  'Piaggio Ape Cargo': { capacity_kg: 500, container_length_ft: 5, container_width_ft: 4, container_height_ft: 4, fuel_type: 'cng', fuel_capacity_liters: 15, fuel_efficiency_kmpl: 25 },
  'Tata 407': { capacity_kg: 3500, container_length_ft: 14, container_width_ft: 6, container_height_ft: 6, fuel_type: 'diesel', fuel_capacity_liters: 80, fuel_efficiency_kmpl: 10 },
  'Eicher Pro 1049': { capacity_kg: 5000, container_length_ft: 17, container_width_ft: 7, container_height_ft: 7, fuel_type: 'diesel', fuel_capacity_liters: 120, fuel_efficiency_kmpl: 8 },
  'Tata 709 / 1109': { capacity_kg: 9000, container_length_ft: 19, container_width_ft: 7, container_height_ft: 7, fuel_type: 'diesel', fuel_capacity_liters: 150, fuel_efficiency_kmpl: 6 },
  'Eicher Pro 2049': { capacity_kg: 9000, container_length_ft: 20, container_width_ft: 7, container_height_ft: 7, fuel_type: 'diesel', fuel_capacity_liters: 150, fuel_efficiency_kmpl: 6 },
  'BharatBenz 1015R': { capacity_kg: 10000, container_length_ft: 20, container_width_ft: 7, container_height_ft: 7, fuel_type: 'diesel', fuel_capacity_liters: 160, fuel_efficiency_kmpl: 5.5 },
  'Tata Signa (Multi-axle)': { capacity_kg: 25000, container_length_ft: 32, container_width_ft: 8, container_height_ft: 8, fuel_type: 'diesel', fuel_capacity_liters: 300, fuel_efficiency_kmpl: 4 },
  'Ashok Leyland U-Truck': { capacity_kg: 25000, container_length_ft: 32, container_width_ft: 8, container_height_ft: 8, fuel_type: 'diesel', fuel_capacity_liters: 300, fuel_efficiency_kmpl: 4 },
  'Volvo FM / FMX': { capacity_kg: 40000, container_length_ft: 40, container_width_ft: 8, container_height_ft: 9, fuel_type: 'diesel', fuel_capacity_liters: 400, fuel_efficiency_kmpl: 3.5 },
  'Custom': { capacity_kg: 1000, container_length_ft: 0, container_width_ft: 0, container_height_ft: 0, fuel_type: 'diesel', fuel_capacity_liters: 60, fuel_efficiency_kmpl: 12 },
}

const DOCS = ['rc', 'insurance', 'fitness', 'permit', 'puc'] as const
type DocKind = (typeof DOCS)[number]

interface VehicleFormData {
  plate_number: string
  vehicle_type: string
  vehicle_model: string
  capacity_kg: number
  fuel_type: string
  fuel_capacity_liters: number
  fuel_efficiency_kmpl: number
  spark_id: string
  driver_name: string
  driver_phone: string
  container_length_ft: number
  container_width_ft: number
  container_height_ft: number
  status: string
  rc_number: string; rc_expiry: string; rc_document_url: string
  insurance_number: string; insurance_expiry: string; insurance_document_url: string
  fitness_certificate_number: string; fitness_expiry: string; fitness_document_url: string
  permit_number: string; permit_expiry: string; permit_document_url: string
  puc_number: string; puc_expiry: string; puc_document_url: string
}

const docNumberKey = (doc: DocKind) =>
  (doc === 'fitness' ? 'fitness_certificate_number' : `${doc}_number`) as
    'rc_number' | 'insurance_number' | 'fitness_certificate_number' | 'permit_number' | 'puc_number'
const docExpiryKey = (doc: DocKind) => `${doc}_expiry` as const

const DEFAULT_FORM_DATA: VehicleFormData = {
  plate_number: '', vehicle_type: 'truck', vehicle_model: '', capacity_kg: 1000,
  fuel_type: 'diesel', fuel_capacity_liters: 60, fuel_efficiency_kmpl: 12,
  spark_id: '', driver_name: '', driver_phone: '',
  container_length_ft: 0, container_width_ft: 0, container_height_ft: 0,
  rc_number: '', rc_expiry: '', rc_document_url: '',
  insurance_number: '', insurance_expiry: '', insurance_document_url: '',
  fitness_certificate_number: '', fitness_expiry: '', fitness_document_url: '',
  permit_number: '', permit_expiry: '', permit_document_url: '',
  puc_number: '', puc_expiry: '', puc_document_url: '',
  status: 'available',
}

const STEPS = [
  { num: 1, label: 'Vehicle details', description: 'Model and capacity', icon: Truck },
  { num: 2, label: 'Driver and GPS', description: 'Tracking setup', icon: User },
  { num: 3, label: 'Documents', description: 'RC, insurance and more', icon: FileText },
] as const

export default function VehicleWizardModal({ isOpen, onClose, initialData = null }: {
  isOpen: boolean
  onClose: () => void
  initialData?: (Partial<Record<keyof VehicleFormData, string | number | null | undefined>> & { id: string }) | null
}) {
  const queryClient = useQueryClient()
  const [step, setStep] = useState(1)
  const [formData, setFormData] = useState<VehicleFormData>(DEFAULT_FORM_DATA)
  const [attempted, setAttempted] = useState<Set<number>>(new Set())
  const { confirm } = useConfirm()
  // The form as it was when the window opened, to tell whether anything changed.
  const baseline = useRef('')
  const isEditing = !!initialData
  // A draft is saved as archived; a live vehicle must never be archived by closing its form.
  const canSaveDraft = !isEditing || initialData.status === 'archived'

  useEffect(() => {
    if (isOpen) {
      const clean = Object.fromEntries(
        Object.entries(initialData ?? {}).filter(([, v]) => v !== null && v !== undefined),
      )
      const next = { ...DEFAULT_FORM_DATA, ...clean } as VehicleFormData
      baseline.current = JSON.stringify(next)
      setFormData(next)
      setAttempted(new Set())
      setStep(1)
    }
  }, [isOpen, initialData])

  const set = <K extends keyof VehicleFormData>(key: K, value: VehicleFormData[K]) =>
    setFormData(prev => ({ ...prev, [key]: value }))

  const withNullableDocs = (data: VehicleFormData) => {
    const payload: Record<string, unknown> = { ...data }
    for (const doc of DOCS) {
      if (!payload[`${doc}_expiry`]) payload[`${doc}_expiry`] = null
      if (!payload[docNumberKey(doc)]) payload[docNumberKey(doc)] = null
    }
    return payload
  }

  const saveDraft = async () => {
    try {
      const payload = withNullableDocs({ ...formData, status: 'archived' })
      if (!payload.plate_number) payload.plate_number = `DRFT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`
      if (isEditing) await vehiclesAPI.update(initialData.id, payload)
      else await vehiclesAPI.create(payload)
      queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      queryClient.invalidateQueries({ queryKey: ['fleet-summary'] })
      toast.success('Draft saved. Finish it later from the Archived filter.')
      onClose()
    } catch {
      toast.error('We could not save the draft. Try again.')
    }
  }

  const requestClose = async () => {
    if (JSON.stringify(formData) === baseline.current || mutation.isPending) { onClose(); return }
    const discard = await confirm({
      title: 'Discard your changes?',
      message: canSaveDraft ? 'Use Save draft to keep what you entered.' : 'The vehicle keeps its current details.',
      confirmLabel: 'Discard changes',
      cancelLabel: 'Keep editing',
      tone: 'danger',
    })
    if (discard) onClose()
  }

  const handleTypeChange = (type: string) => {
    const updates: Partial<VehicleFormData> = { vehicle_type: type }
    if ((!formData.vehicle_model || formData.vehicle_model === 'Custom') && type === 'truck') {
      updates.capacity_kg = 9000
      updates.container_length_ft = 19
      updates.container_width_ft = 7
      updates.container_height_ft = 7
    }
    setFormData(prev => ({ ...prev, ...updates }))
  }

  const handleCapacityChange = (cap: number) => {
    const updates: Partial<VehicleFormData> = { capacity_kg: cap }
    if ((!formData.vehicle_model || formData.vehicle_model === 'Custom') && formData.vehicle_type === 'truck') {
      let closest = INDIAN_TRUCK_PRESETS['Tata Ace (Chota Hathi)']
      let minDiff = Infinity
      for (const [name, preset] of Object.entries(INDIAN_TRUCK_PRESETS)) {
        if (name === 'Custom') continue
        const diff = Math.abs(preset.capacity_kg - cap)
        if (diff < minDiff) { minDiff = diff; closest = preset }
      }
      updates.container_length_ft = closest.container_length_ft
      updates.container_width_ft = closest.container_width_ft
      updates.container_height_ft = closest.container_height_ft
    }
    setFormData(prev => ({ ...prev, ...updates }))
  }

  const stepErrors = (n: number): Record<string, string> => {
    const errors: Record<string, string> = {}
    if (n === 1) {
      if (!formData.plate_number.trim()) errors.plate = 'Enter the plate number.'
      if (!(formData.capacity_kg > 0)) errors.capacity = 'Enter a capacity above 0.'
    }
    if (n === 2) {
      if (!formData.driver_name.trim()) errors.driver = 'Enter the driver’s name.'
      if (!formData.driver_phone.trim()) errors.phone = 'Enter the driver’s phone number.'
      else {
        const phoneErr = indianMobileError(formData.driver_phone)
        if (phoneErr) errors.phone = phoneErr
      }
    }
    return errors
  }

  const handleNext = () => {
    if (Object.keys(stepErrors(step)).length > 0) {
      setAttempted(prev => new Set(prev).add(step))
      return
    }
    setStep(s => s + 1)
  }

  const mutation = useMutation({
    mutationFn: (data: VehicleFormData) => {
      const payload = withNullableDocs({ ...data, status: data.status === 'archived' ? 'available' : (data.status || 'available') })
      return isEditing ? vehiclesAPI.update(initialData.id, payload) : vehiclesAPI.create(payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      queryClient.invalidateQueries({ queryKey: ['fleet-summary'] })
      toast.success(isEditing ? 'Vehicle updated' : 'Vehicle added')
      onClose()
    },
    onError: (err: { response?: { data?: { detail?: string } } }) => toast.error(err.response?.data?.detail || 'Failed to save the vehicle'),
  })

  const handleFinish = () => {
    const missing = DOCS.filter(doc => !formData[docNumberKey(doc)]?.trim() || !formData[docExpiryKey(doc)]?.trim())
    if (missing.length > 0 || rcNumberError(formData.rc_number)) {
      setAttempted(prev => new Set(prev).add(3))
      toast.error(missing.length > 0 ? `Add the number and expiry date for: ${missing.map(d => d.toUpperCase()).join(', ')}. Or save a draft.` : 'Check the RC number.')
      return
    }
    mutation.mutate(formData)
  }

  const presetOptions: SelectOption[] = [
    { value: '', label: 'Custom build' },
    ...Object.keys(INDIAN_TRUCK_PRESETS).map(m => ({ value: m, label: `${m} — ${INDIAN_TRUCK_PRESETS[m].capacity_kg.toLocaleString('en-IN')} kg` })),
  ]

  return (
    <Modal
      open={isOpen}
      onClose={requestClose}
      closeOnBackdrop={false}
      size="xl"
      title={isEditing ? 'Update vehicle' : 'Add vehicle'}
      description={STEPS[step - 1].description}
      footer={
        <>
          {canSaveDraft
            ? <Button variant="ghost" icon={<Save size={16} />} onClick={saveDraft}>Save draft</Button>
            : <Button variant="ghost" onClick={requestClose}>Cancel</Button>}
          <div className="flex-1" />
          <Button variant="secondary" onClick={() => setStep(s => Math.max(1, s - 1))} disabled={step === 1}>Back</Button>
          {step < 3 ? (
            <Button onClick={handleNext}>Next</Button>
          ) : (
            <Button onClick={handleFinish} loading={mutation.isPending}>{isEditing ? 'Update vehicle' : 'Add vehicle'}</Button>
          )}
        </>
      }
    >
      <div className="mb-6 flex items-center gap-2" role="tablist" aria-label="Vehicle wizard steps">
        {STEPS.map(s => (
          <div
            key={s.num}
            className={'flex flex-1 items-center gap-2 rounded-control border px-3 py-2 text-xs ' + (step === s.num ? 'border-brand bg-brand-soft text-brand' : 'border-border text-muted')}
          >
            <s.icon size={14} aria-hidden="true" />
            <span className="font-medium">{s.label}</span>
          </div>
        ))}
      </div>

      {step === 1 && (
        <div className="space-y-4">
          <Input
            label="Plate number"
            required
            placeholder="e.g. MH-01-AB-1234"
            value={formData.plate_number}
            error={attempted.has(1) ? stepErrors(1).plate : undefined}
            onChange={e => set('plate_number', e.target.value.toUpperCase())}
          />
          <Select
            label="Truck model (preset)"
            options={presetOptions}
            value={formData.vehicle_model}
            onChange={e => {
              const m = e.target.value
              const preset = INDIAN_TRUCK_PRESETS[m]
              if (preset && m !== 'Custom') {
                setFormData(prev => ({
                  ...prev, vehicle_model: m, capacity_kg: preset.capacity_kg,
                  container_length_ft: preset.container_length_ft, container_width_ft: preset.container_width_ft,
                  container_height_ft: preset.container_height_ft, fuel_type: preset.fuel_type,
                  fuel_capacity_liters: preset.fuel_capacity_liters, fuel_efficiency_kmpl: preset.fuel_efficiency_kmpl,
                }))
              } else {
                set('vehicle_model', m)
              }
            }}
          />
          <div className="grid grid-cols-2 gap-4">
            <Select label="Vehicle type" options={VEHICLE_TYPES} value={formData.vehicle_type} onChange={e => handleTypeChange(e.target.value)} />
            <Input label="Capacity (kg)" type="number" required min={1} value={formData.capacity_kg || ''} error={attempted.has(1) ? stepErrors(1).capacity : undefined} onChange={e => handleCapacityChange(Number(e.target.value))} />
          </div>
          <div>
            <p className="mb-1.5 text-sm font-medium text-text">Container dimensions (L × W × H, feet)</p>
            <div className="grid grid-cols-3 gap-4">
              <Input hideLabel label="Length" type="number" step="0.5" trailing="L" value={formData.container_length_ft || ''} onChange={e => set('container_length_ft', Number(e.target.value))} />
              <Input hideLabel label="Width" type="number" step="0.5" trailing="W" value={formData.container_width_ft || ''} onChange={e => set('container_width_ft', Number(e.target.value))} />
              <Input hideLabel label="Height" type="number" step="0.5" trailing="H" value={formData.container_height_ft || ''} onChange={e => set('container_height_ft', Number(e.target.value))} />
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <Input label="Spark GPS ID" hint="Optional hardware device ID" value={formData.spark_id} onChange={e => set('spark_id', e.target.value)} />
          <div className="grid grid-cols-2 gap-4">
            <Input label="Driver name" required value={formData.driver_name} error={attempted.has(2) ? stepErrors(2).driver : undefined} onChange={e => set('driver_name', e.target.value)} />
            <Input
              label="Driver phone"
              required
              type="tel"
              inputMode="tel"
              placeholder="+91 98765 43210"
              value={formData.driver_phone}
              onChange={e => set('driver_phone', e.target.value)}
              error={attempted.has(2) ? stepErrors(2).phone : indianMobileError(formData.driver_phone)}
            />
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <p className="rounded-control border border-info/30 bg-info-soft px-4 py-3 text-sm text-text">
            Upload vehicle documents to stay compliant. If you don't have them all yet, save this as a draft and come back later.
          </p>
          {DOCS.map(doc => {
            const expiry = expiryStatus(formData[docExpiryKey(doc)])
            return (
              <div key={doc} className="space-y-2 rounded-control border border-border p-4">
                <div className="grid grid-cols-2 gap-4">
                  <Input
                    label={`${doc.toUpperCase()} number`}
                    value={formData[docNumberKey(doc)] || ''}
                    onChange={e => set(docNumberKey(doc), e.target.value.toUpperCase())}
                    required
                    error={(doc === 'rc' ? rcNumberError(formData.rc_number) : undefined) ?? (attempted.has(3) && !formData[docNumberKey(doc)]?.trim() ? 'Enter the number.' : undefined)}
                  />
                  <Input
                    label="Expiry date"
                    required
                    error={attempted.has(3) && !formData[docExpiryKey(doc)]?.trim() ? 'Choose the expiry date.' : undefined}
                    type="date"
                    value={formData[docExpiryKey(doc)] || ''}
                    onChange={e => set(docExpiryKey(doc), e.target.value)}
                  />
                </div>
                {expiry && <StatusPill tone={expiry.tone} dot={false}>{expiry.label}</StatusPill>}
              </div>
            )
          })}
        </div>
      )}
    </Modal>
  )
}
