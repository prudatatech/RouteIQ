import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { fleetAPI } from '@/services/api'
import { Button, Input, Modal, Select, Textarea } from '@/components/ui'
import { apiErrorMessage, fleetKeys, SERVICE_PRESETS, type ServiceItem } from './health'

/** Today's date in the browser's time zone as YYYY-MM-DD, for date inputs. */
const today = () => new Date().toLocaleDateString('en-CA')

/** Empty box means "not set"; anything else must be a number. */
function numberOrNull(value: string): number | null | undefined {
  if (value.trim() === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

function useRefreshVehicle(vehicleId: string) {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({ queryKey: ['fleet-vehicle-health', vehicleId] })
    queryClient.invalidateQueries({ queryKey: fleetKeys.log(vehicleId) })
    queryClient.invalidateQueries({ queryKey: fleetKeys.health })
    queryClient.invalidateQueries({ queryKey: fleetKeys.serviceDue })
    queryClient.invalidateQueries({ queryKey: ['vehicles'] })
  }
}

export function OdometerModal({ vehicleId, plate, current, open, onClose }: {
  vehicleId: string
  plate: string
  current: number | null
  open: boolean
  onClose: () => void
}) {
  const [value, setValue] = useState(current != null ? String(Math.round(current)) : '')
  const [error, setError] = useState('')
  const refresh = useRefreshVehicle(vehicleId)

  const save = useMutation({
    mutationFn: (km: number) => fleetAPI.setOdometer(vehicleId, km),
    onSuccess: () => { toast.success('Odometer updated'); refresh(); onClose() },
    onError: err => setError(apiErrorMessage(err, 'We could not save the odometer. Try again.')),
  })

  const submit = () => {
    const km = numberOrNull(value)
    if (km == null || km < 0) { setError('Enter the reading on the dashboard, in km.'); return }
    setError('')
    save.mutate(km)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={`Correct odometer for ${plate}`}
      description="The reading counted from GPS keeps adding to what you enter here."
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={save.isPending} onClick={submit}>Save reading</Button>
        </>
      )}
    >
      <Input label="Odometer" type="number" inputMode="decimal" min={0} value={value} onChange={e => setValue(e.target.value)} trailing="km" error={error} required />
    </Modal>
  )
}

export function PlanModal({ vehicleId, plan, open, onClose }: {
  vehicleId: string
  /** The item being changed, or null to add a new one. */
  plan: ServiceItem | null
  open: boolean
  onClose: () => void
}) {
  const [item, setItem] = useState(plan?.item ?? '')
  const [intervalKm, setIntervalKm] = useState(plan?.interval_km != null ? String(plan.interval_km) : '')
  const [intervalDays, setIntervalDays] = useState(plan?.interval_days != null ? String(plan.interval_days) : '')
  const [lastKm, setLastKm] = useState(plan?.last_done_km != null ? String(Math.round(plan.last_done_km)) : '')
  const [lastAt, setLastAt] = useState(plan?.last_done_at?.slice(0, 10) ?? '')
  const [error, setError] = useState('')
  const refresh = useRefreshVehicle(vehicleId)

  const save = useMutation({
    mutationFn: (body: object) => fleetAPI.savePlan(vehicleId, body),
    onSuccess: () => { toast.success('Service item saved'); refresh(); onClose() },
    onError: err => setError(apiErrorMessage(err, 'We could not save this item. Try again.')),
  })

  const submit = () => {
    const km = numberOrNull(intervalKm)
    const days = numberOrNull(intervalDays)
    const last = numberOrNull(lastKm)
    if (!item.trim()) { setError('Enter what needs servicing, for example Engine oil.'); return }
    if (km === undefined || days === undefined || last === undefined) { setError('Use numbers only for kilometres and days.'); return }
    if (km == null && days == null) { setError('Set how often it is due: every some km, every some days, or both.'); return }
    setError('')
    save.mutate({ item: item.trim(), interval_km: km, interval_days: days, last_done_km: last, last_done_at: lastAt || null })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={plan ? `Change ${plan.item}` : 'Add a service item'}
      description="Say how often it is due and when it was last done. We work out when the next one falls due."
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={save.isPending} onClick={submit}>Save item</Button>
        </>
      )}
    >
      <div className="space-y-4">
        {!plan && (
          <Select
            label="Common items"
            value=""
            onChange={e => { if (e.target.value) setItem(e.target.value) }}
            options={SERVICE_PRESETS.map(p => ({ value: p, label: p }))}
            placeholder="Pick one, or type your own below"
          />
        )}
        <Input label="Item" value={item} onChange={e => setItem(e.target.value)} disabled={!!plan} maxLength={60} required />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Due every" type="number" inputMode="numeric" min={1} value={intervalKm} onChange={e => setIntervalKm(e.target.value)} trailing="km" />
          <Input label="Or every" type="number" inputMode="numeric" min={1} value={intervalDays} onChange={e => setIntervalDays(e.target.value)} trailing="days" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Last done at" type="number" inputMode="decimal" min={0} value={lastKm} onChange={e => setLastKm(e.target.value)} trailing="km" hint="Odometer reading at that service" />
          <Input label="Last done on" type="date" max={today()} value={lastAt} onChange={e => setLastAt(e.target.value)} />
        </div>
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      </div>
    </Modal>
  )
}

export function LogServiceModal({ vehicleId, plate, items, odometer, presetItem, open, onClose }: {
  vehicleId: string
  plate: string
  /** Items on the vehicle's schedule. */
  items: string[]
  odometer: number | null
  presetItem?: string
  open: boolean
  onClose: () => void
}) {
  const choices = [...new Set([...items, ...SERVICE_PRESETS])]
  const [item, setItem] = useState(presetItem ?? items[0] ?? '')
  const [doneAt, setDoneAt] = useState(today())
  const [km, setKm] = useState(odometer != null ? String(Math.round(odometer)) : '')
  const [cost, setCost] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const refresh = useRefreshVehicle(vehicleId)

  const save = useMutation({
    mutationFn: (body: object) => fleetAPI.logService(vehicleId, body),
    onSuccess: (res: { expense_recorded?: boolean; cost?: number | null }) => {
      toast.success(res.expense_recorded ? 'Service logged and the cost added to expenses' : 'Service logged')
      refresh()
      onClose()
    },
    onError: err => setError(apiErrorMessage(err, 'We could not log this service. Try again.')),
  })

  const submit = () => {
    const odo = numberOrNull(km)
    const price = numberOrNull(cost)
    if (!item.trim()) { setError('Choose what was serviced.'); return }
    if (odo === undefined || price === undefined) { setError('Use numbers only for the odometer and cost.'); return }
    setError('')
    save.mutate({ item: item.trim(), done_at: doneAt, odometer_km: odo, cost: price, note: note.trim() || null })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Log a service for ${plate}`}
      description="This moves the item's next due date forward. A cost is added to expenses as maintenance."
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={save.isPending} onClick={submit}>Log service</Button>
        </>
      )}
    >
      <div className="space-y-4">
        <Select label="What was serviced" value={item} onChange={e => setItem(e.target.value)} options={choices.map(c => ({ value: c, label: c }))} placeholder="Choose an item" required />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Date" type="date" max={today()} value={doneAt} onChange={e => setDoneAt(e.target.value)} required />
          <Input label="Odometer" type="number" inputMode="decimal" min={0} value={km} onChange={e => setKm(e.target.value)} trailing="km" hint={odometer == null ? 'The odometer is not known yet. Enter it if you can.' : undefined} />
        </div>
        <Input label="Cost" type="number" inputMode="decimal" min={0} value={cost} onChange={e => setCost(e.target.value)} leading="₹" hint="Optional" />
        <Textarea label="Note" value={note} onChange={e => setNote(e.target.value)} maxLength={500} hint="Optional, for example the workshop or parts used" />
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      </div>
    </Modal>
  )
}
