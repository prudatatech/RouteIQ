import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Button, Checkbox, Input, Modal, Select, type SelectOption } from '@/components/ui'
import { publicAPI, tplPortalAPI } from '@/services/api'
import { errorMessage } from '@/utils/display'
import { rcNumberError } from '@/utils/validators'
import type { NetVehicle } from '@/types/network'
import { VEHICLE_DOCS, toVehicleInput, type VehicleForm } from '../networkHelpers'

// The same types, bodies and document fields as the company vehicle form (components/fleet/VehicleWizardModal.tsx).
const VEHICLE_TYPES: SelectOption[] = [
  { value: 'truck', label: 'Truck' },
  { value: 'van', label: 'Van' },
  { value: 'bike', label: 'Bike' },
  { value: 'car', label: 'Car' },
]
const BODY_TYPES: SelectOption[] = [
  { value: '', label: 'Not set' },
  { value: 'closed', label: 'Closed' },
  { value: 'open', label: 'Open' },
  { value: 'container', label: 'Container' },
  { value: 'reefer', label: 'Reefer' },
  { value: 'tanker', label: 'Tanker' },
  { value: 'trailer', label: 'Trailer' },
]

const EMPTY: VehicleForm = {
  plate_number: '', vehicle_type: 'truck', body_type: '', vehicle_class: '', vehicle_model: '', capacity_kg: '',
  hazmat_certified: false, is_reefer: false,
  rc_number: '', rc_expiry: '', insurance_number: '', insurance_expiry: '', fitness_certificate_number: '', fitness_expiry: '',
  permit_number: '', permit_expiry: '', puc_number: '', puc_expiry: '',
}

const fromVehicle = (v: NetVehicle | null): VehicleForm => {
  if (!v) return EMPTY
  const next: VehicleForm = { ...EMPTY }
  for (const key of Object.keys(EMPTY) as (keyof VehicleForm)[]) {
    const value = (v as unknown as Record<string, unknown>)[key]
    if (typeof EMPTY[key] === 'boolean') (next as Record<string, unknown>)[key] = Boolean(value)
    else if (value != null) (next as Record<string, unknown>)[key] = key.endsWith('_expiry') ? String(value).slice(0, 10) : String(value)
  }
  return next
}

/** Add or edit one of the partner's vehicles. A vehicle can take loads once its RC and insurance numbers are filled in. */
export default function VehicleFormModal({ partnerId, vehicle, open, onClose }: {
  partnerId: string
  vehicle: NetVehicle | null
  open: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<VehicleForm>(EMPTY)
  const [submitted, setSubmitted] = useState(false)
  useEffect(() => { if (open) { setForm(fromVehicle(vehicle)); setSubmitted(false) } }, [open, vehicle])
  const set = <K extends keyof VehicleForm>(key: K, value: VehicleForm[K]) => setForm(prev => ({ ...prev, [key]: value }))

  const classes = useQuery({ queryKey: ['vehicle-classes'], queryFn: publicAPI.vehicleClasses, enabled: open, staleTime: 3_600_000 })
  const classOptions: SelectOption[] = [{ value: '', label: 'Not set' }, ...(classes.data ?? []).map(c => ({ value: c.key, label: c.name }))]

  const capacity = Number(form.capacity_kg)
  const errors = {
    plate_number: !form.plate_number.trim() ? 'Enter the number plate' : undefined,
    capacity_kg: !form.capacity_kg || !Number.isFinite(capacity) || capacity <= 0 ? 'Enter the capacity in kg' : undefined,
    rc_number: form.rc_number.trim() ? rcNumberError(form.rc_number) : undefined,
  }
  const hasError = Object.values(errors).some(Boolean)

  const save = useMutation({
    mutationFn: () => (vehicle
      ? tplPortalAPI.updateVehicle(partnerId, vehicle.id, toVehicleInput(form))
      : tplPortalAPI.addVehicle(partnerId, toVehicleInput(form))),
    onSuccess: () => {
      toast.success(vehicle ? 'Vehicle updated' : 'Vehicle added')
      queryClient.invalidateQueries({ queryKey: ['tpl-portal-vehicles', partnerId] })
      onClose()
    },
    onError: err => toast.error(errorMessage(err, 'We could not save this vehicle. Try again.')),
  })

  const submit = () => {
    setSubmitted(true)
    if (!hasError) save.mutate()
  }
  const shown = <K extends keyof typeof errors>(key: K) => (submitted ? errors[key] : undefined)

  return (
    <Modal
      open={open}
      onClose={onClose}
      onSubmit={submit}
      size="lg"
      title={vehicle ? `Edit ${vehicle.plate_number}` : 'Add a vehicle'}
      description="Fill in the RC and insurance numbers so companies can see it is ready for loads."
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={save.isPending}>{vehicle ? 'Save changes' : 'Add vehicle'}</Button>
        </>
      )}
    >
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Number plate" required value={form.plate_number} onChange={e => set('plate_number', e.target.value)} error={shown('plate_number')} />
          <Input label="Capacity (kg)" required type="number" min={0} value={form.capacity_kg} onChange={e => set('capacity_kg', e.target.value)} error={shown('capacity_kg')} />
          <Select label="Vehicle type" options={VEHICLE_TYPES} value={form.vehicle_type} onChange={e => set('vehicle_type', e.target.value)} />
          <Select label="Vehicle class" options={classOptions} value={form.vehicle_class} onChange={e => set('vehicle_class', e.target.value)} />
          <Select label="Body type" options={BODY_TYPES} value={form.body_type} onChange={e => set('body_type', e.target.value)} />
          <Input label="Make and model" value={form.vehicle_model} onChange={e => set('vehicle_model', e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Checkbox label="Certified for hazardous goods" checked={form.hazmat_certified} onChange={e => set('hazmat_certified', e.target.checked)} />
          <Checkbox label="Refrigerated body" checked={form.is_reefer} onChange={e => set('is_reefer', e.target.checked)} />
        </div>
        <div className="space-y-3">
          <p className="text-sm font-medium text-text">Documents</p>
          {VEHICLE_DOCS.map(d => (
            <div key={d.key} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input
                label={`${d.name} number`}
                value={form[d.number]}
                onChange={e => set(d.number, e.target.value)}
                error={d.key === 'rc' && submitted ? errors.rc_number : undefined}
              />
              <Input label={`${d.name} expires on`} type="date" value={form[d.expiry]} onChange={e => set(d.expiry, e.target.value)} />
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}
