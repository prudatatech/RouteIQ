import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { fleetAPI } from '@/services/api'
import { Button, Input, Modal, Select, Textarea } from '@/components/ui'
import { apiErrorMessage, SERVICE_PRESETS, type ServiceItem } from './health'
import { useRefreshVehicle } from './maintenance/useRefreshVehicle'

/** Today's date in the browser's time zone as YYYY-MM-DD, for date inputs. */
const today = () => new Date().toLocaleDateString('en-CA')

/** Empty box means "not set"; anything else must be a number. */
function numberOrNull(value: string): number | null | undefined {
  if (value.trim() === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

export function OdometerModal({ vehicleId, plate, current, open, onClose }: {
  vehicleId: string
  plate: string
  current: number | null
  open: boolean
  onClose: () => void
}) {
  const [value, setValue] = useState(current != null ? String(Math.round(current)) : '')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const refresh = useRefreshVehicle(vehicleId)

  const km = numberOrNull(value)
  // A reading lower than the current one is a correction and needs a reason
  const lower = current != null && typeof km === 'number' && km < current

  const save = useMutation({
    mutationFn: ({ km, why }: { km: number; why?: string }) => fleetAPI.setOdometer(vehicleId, km, why),
    onSuccess: () => { toast.success('Odometer updated'); refresh(); onClose() },
    onError: err => setError(apiErrorMessage(err, 'We could not save the odometer. Try again.')),
  })

  const submit = () => {
    if (km == null || km < 0) { setError('Enter the reading on the dashboard, in km.'); return }
    if (lower && reason.trim().length < 3) { setError('This is lower than the current reading. Say why it is being corrected.'); return }
    setError('')
    save.mutate({ km, why: lower ? reason.trim() : undefined })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      onSubmit={submit}
      title={`Correct odometer for ${plate}`}
      description="Auto sync keeps adding the distance driven to what you enter here."
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={save.isPending}>Save reading</Button>
        </>
      )}
    >
      <div className="space-y-4">
        <Input label="Odometer" type="number" inputMode="decimal" min={0} value={value} onChange={e => setValue(e.target.value)} trailing="km" required />
        {lower && (
          <Textarea
            label="Why is it lower?"
            value={reason}
            onChange={e => setReason(e.target.value)}
            maxLength={300}
            hint="The odometer does not go back without a reason, for example a replaced instrument cluster."
            required
          />
        )}
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      </div>
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
      onSubmit={submit}
      title={plan ? `Change ${plan.item}` : 'Add a service item'}
      description="Say how often it is due and when it was last done. We work out when the next one falls due."
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={save.isPending}>Save item</Button>
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

// The log-service form lives with the rest of the maintenance workflow
export { LogServiceModal } from './maintenance/LogServiceModal'
