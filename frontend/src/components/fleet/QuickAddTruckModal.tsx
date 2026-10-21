import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Sparkles, Truck } from 'lucide-react'
import toast from 'react-hot-toast'
import { Modal, Button, Input, Select, type SelectOption } from '@/components/ui'
import { vehiclesAPI } from '@/services/api'

interface QuickTruckTypeOption extends SelectOption {
  vehicle_type: 'truck' | 'van' | 'bike' | 'car'
  body_type?: string
  is_reefer?: boolean
  capacity_kg: number
}

const QUICK_TRUCK_TYPES: QuickTruckTypeOption[] = [
  { value: 'open', label: 'Open / Flatbed Truck', vehicle_type: 'truck', body_type: 'open', capacity_kg: 9000 },
  { value: 'container', label: 'Container Truck', vehicle_type: 'truck', body_type: 'container', capacity_kg: 10000 },
  { value: 'trailer', label: 'Trailer', vehicle_type: 'truck', body_type: 'trailer', capacity_kg: 25000 },
  { value: 'reefer', label: 'Reefer / Cold Chain', vehicle_type: 'truck', body_type: 'reefer', is_reefer: true, capacity_kg: 10000 },
  { value: 'tanker', label: 'Tanker', vehicle_type: 'truck', body_type: 'tanker', capacity_kg: 15000 },
  { value: 'tipper', label: 'Tipper', vehicle_type: 'truck', body_type: 'open', capacity_kg: 12000 },
  { value: 'odc', label: 'ODC (Over Dimensional Cargo)', vehicle_type: 'truck', body_type: 'open', capacity_kg: 35000 },
  { value: 'mini_truck', label: 'Mini Truck / Tata Ace', vehicle_type: 'truck', body_type: 'closed', capacity_kg: 750 },
  { value: 'pickup', label: 'Pickup / Bolero Pickup', vehicle_type: 'truck', body_type: 'open', capacity_kg: 1200 },
]

interface Props {
  open: boolean
  onClose: () => void
  onSuccess?: (vehicle: unknown) => void
}

export default function QuickAddTruckModal({ open, onClose, onSuccess }: Props) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [truckTypeKey, setTruckTypeKey] = useState<string>('open')
  const [plateNumber, setPlateNumber] = useState<string>('')
  const [plateError, setPlateError] = useState<string>('')

  const selectedType = QUICK_TRUCK_TYPES.find(t => t.value === truckTypeKey) || QUICK_TRUCK_TYPES[0]

  const cleanPlate = (raw: string) => raw.toUpperCase().replace(/[^A-Z0-9-]/g, '').trim()

  const handlePlateChange = (val: string) => {
    setPlateNumber(cleanPlate(val))
    if (plateError) setPlateError('')
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const formatted = cleanPlate(plateNumber)
      if (!formatted || formatted.length < 4) {
        throw new Error('Enter a valid registration plate number (e.g. MH-01-AB-1234)')
      }

      const payload = {
        plate_number: formatted,
        vehicle_type: selectedType.vehicle_type,
        body_type: selectedType.body_type,
        is_reefer: selectedType.is_reefer ?? false,
        capacity_kg: selectedType.capacity_kg,
        profile_status: 'quick_added' as const,
        status: 'available' as const,
      }

      return vehiclesAPI.create(payload)
    },
    onSuccess: (savedVehicle) => {
      queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      queryClient.invalidateQueries({ queryKey: ['fleet-summary'] })
      queryClient.invalidateQueries({ queryKey: ['ops-today'] })

      toast.success(`Truck ${cleanPlate(plateNumber)} added! Opening matching loads…`, {
        icon: '🚛',
        duration: 4000,
      })

      onSuccess?.(savedVehicle)
      onClose()

      // Redirect straight to loads matching this truck type per Feature Spec
      navigate(`/requests?source=vendor&vehicle_type=${encodeURIComponent(selectedType.vehicle_type)}`)
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { detail?: string } }; message?: string })?.response?.data?.detail
        || (err as { message?: string })?.message
        || 'Could not add truck. Try again.'
      setPlateError(msg)
      toast.error(msg)
    },
  })

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault()
    const formatted = cleanPlate(plateNumber)
    if (!formatted || formatted.length < 4) {
      const msg = 'Please enter a valid registration number (minimum 4 characters)'
      setPlateError(msg)
      toast.error(msg)
      return
    }
    mutation.mutate()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Quick Add Truck"
      description="List a truck in ~15 seconds to see matching loads right away. Full documents and driver can be added anytime later."
      size="md"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            loading={mutation.isPending}
            icon={<ArrowRight size={16} />}
          >
            Add Truck & View Loads
          </Button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="rounded-card border border-warning/30 bg-warning-soft/20 p-3 text-xs text-text">
          <div className="flex items-center gap-1.5 font-medium text-warning">
            <Sparkles size={14} className="shrink-0" />
            <span>Fast Capacity Listing (Step 1 of 2)</span>
          </div>
          <p className="mt-1 text-muted">
            Submitting instantly registers capacity under your fleet. Documents (RC, Insurance, PUC) and driver assignment can be finished later from the Fleet page without blocking load quoting.
          </p>
        </div>

        <div className="space-y-3">
          <Select
            label="Truck Type"
            value={truckTypeKey}
            onChange={e => setTruckTypeKey(e.target.value)}
            options={QUICK_TRUCK_TYPES}
            required
            hint={`Standard capacity: ~${(selectedType.capacity_kg / 1000).toFixed(1)} MT`}
          />

          <Input
            label="Truck / Registration Number"
            placeholder="e.g. MH-01-AB-1234 or DL-01-AA-9999"
            value={plateNumber}
            onChange={e => handlePlateChange(e.target.value)}
            error={plateError}
            required
            autoFocus
            leading={<Truck size={16} />}
            hint="Format: State code, district number, series & 4-digit number"
          />
        </div>
      </form>
    </Modal>
  )
}
