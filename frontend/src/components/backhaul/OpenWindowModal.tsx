import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { capacityAPI, shipmentsAPI, vehiclesAPI } from '@/services/api'
import { Button, Input, Modal, Select } from '@/components/ui'
import { errorMessage, formatKg } from '@/utils/display'
import { isMasterRow } from '@/components/cargo/lots'

interface VehicleOption { id: string; plate_number: string; available_capacity_kg: number | null }
interface ShipmentOption { id: string; tracking_id: string; status: string; origin_name: string | null; is_master?: boolean | null }

const DURATIONS = [
  { value: '15', label: '15 minutes' },
  { value: '30', label: '30 minutes' },
  { value: '60', label: '1 hour' },
  { value: '120', label: '2 hours' },
  { value: '240', label: '4 hours' },
  { value: '720', label: '12 hours' },
  { value: '1440', label: '24 hours' },
]

/** Shipments that are already finished cannot be offered as the reason for a window. */
const FINISHED = new Set(['delivered', 'cancelled', 'failed'])

export interface FormState { vehicle_id: string; floor_price: string; duration: string; shipment_id: string }
const blank = (): FormState => ({ vehicle_id: '', floor_price: '', duration: '60', shipment_id: '' })

/** Staff open a capacity bidding window: which vehicle, the minimum bid, how long, and an optional shipment it is linked to. */
export default function OpenWindowModal({ open, onClose, initial }: {
  open: boolean
  onClose: () => void
  /** Values to start the form with (a vehicle, a price, a linked shipment) when it is opened from a load. */
  initial?: Partial<FormState>
}) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<FormState>(blank)
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({})

  useEffect(() => {
    if (!open) return
    setForm({ ...blank(), ...initial })
    setErrors({})
    // Only when the modal opens: later edits to `initial` must not overwrite what staff typed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const vehicles = useQuery<VehicleOption[]>({
    queryKey: ['vehicles', 'options'],
    queryFn: () => vehiclesAPI.list() as Promise<VehicleOption[]>,
    enabled: open,
    staleTime: 60_000,
  })
  const shipments = useQuery<ShipmentOption[]>({
    queryKey: ['shipments', 'window-options'],
    queryFn: () => shipmentsAPI.list() as Promise<ShipmentOption[]>,
    enabled: open,
    staleTime: 60_000,
  })

  const withSpace = (vehicles.data ?? []).filter(v => Number(v.available_capacity_kg) > 0)
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm(f => ({ ...f, [key]: value }))

  const save = useMutation({
    mutationFn: () => capacityAPI.openWindow({
      vehicle_id: form.vehicle_id,
      floor_price: Number(form.floor_price),
      duration_minutes: Number(form.duration),
      shipment_id: form.shipment_id || null,
    }),
    onSuccess: () => {
      toast.success('Bidding window opened. Vendors can bid now.')
      queryClient.invalidateQueries({ queryKey: ['bids-board'] })
      queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      onClose()
    },
    onError: err => toast.error(errorMessage(err, 'We could not open this window. Try again.')),
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const next: typeof errors = {}
    if (!form.vehicle_id) next.vehicle_id = 'Choose a vehicle'
    const price = Number(form.floor_price)
    if (form.floor_price === '' || !Number.isFinite(price) || price < 0) next.floor_price = 'Enter the minimum bid you will accept'
    setErrors(next)
    if (Object.keys(next).length === 0) save.mutate()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Open a capacity bidding window"
      description="Vendors near the vehicle can bid for its free space until the window ends. You choose the winning bid."
      closeOnBackdrop={false}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="open-window-form" loading={save.isPending}>Open window</Button>
        </>
      }
    >
      <form id="open-window-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Select
          className="sm:col-span-2"
          label="Vehicle"
          required
          value={form.vehicle_id}
          onChange={e => set('vehicle_id', e.target.value)}
          error={errors.vehicle_id}
          hint={vehicles.isLoading ? 'Loading vehicles' : withSpace.length === 0 ? 'No vehicle has free space right now.' : 'Only vehicles with free space are listed.'}
          options={[
            { value: '', label: 'Choose a vehicle' },
            ...withSpace.map(v => ({ value: v.id, label: `${v.plate_number} · ${formatKg(v.available_capacity_kg)} free` })),
          ]}
        />
        <Input
          label="Minimum bid"
          required
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          leading="₹"
          hint="The lowest price for the whole load. Vendors cannot bid below it."
          value={form.floor_price}
          onChange={e => set('floor_price', e.target.value)}
          error={errors.floor_price}
        />
        <Select
          label="Open for"
          value={form.duration}
          onChange={e => set('duration', e.target.value)}
          options={DURATIONS}
        />
        <Select
          className="sm:col-span-2"
          label="Linked shipment"
          hint="Optional. A standby shipment for this space if no bid is chosen."
          value={form.shipment_id}
          onChange={e => set('shipment_id', e.target.value)}
          options={[
            { value: '', label: 'No shipment' },
            // A split master carries no goods of its own; its lots are offered instead
            ...(shipments.data ?? []).filter(s => !FINISHED.has(s.status) && !isMasterRow(s)).map(s => ({
              value: s.id,
              label: `${s.tracking_id}${s.origin_name ? ` · ${s.origin_name}` : ''}`,
            })),
          ]}
        />
      </form>
    </Modal>
  )
}
