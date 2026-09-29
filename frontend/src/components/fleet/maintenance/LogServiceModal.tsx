import { useId, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { fleetAPI } from '@/services/api'
import { Button, Input, Modal, useConfirm } from '@/components/ui'
import { returnVehicleToService } from '../vehicleStatus'
import { apiErrorMessage, SERVICE_PRESETS } from '../health'
import { ServiceDetailsFields } from './ServiceDetailsFields'
import { detailsPayload, emptyDetails, type ServiceDetails } from './serviceDetails'
import { moneyOrNull } from './items'
import { useRefreshVehicle } from './useRefreshVehicle'
import { istToday } from './condition'

/**
 * Log a service: what was done, the date, the odometer (filled in from the current reading), the total
 * cost, the workshop and attachments. Parts and repairs, labour, invoice number and a note are tucked away.
 */
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
  const listId = useId()
  const choices = [...new Set([...items, ...SERVICE_PRESETS])]
  const [item, setItem] = useState(presetItem ?? '')
  const [doneAt, setDoneAt] = useState(istToday())
  const [km, setKm] = useState(odometer != null ? String(Math.round(odometer)) : '')
  const [details, setDetails] = useState<ServiceDetails>(emptyDetails())
  const [error, setError] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const refresh = useRefreshVehicle(vehicleId)
  const { confirm } = useConfirm()
  const queryClient = useQueryClient()

  // A vehicle held in maintenance (e.g. after a serious SOS) is usually serviced next: offer to put it back.
  const offerReturnToService = async () => {
    const ok = await confirm({
      title: `Return ${plate} to service?`,
      message: `${plate} is in maintenance. If the service is done, put it back in service so it can be dispatched again.`,
      confirmLabel: 'Return to service',
      cancelLabel: 'Keep in maintenance',
    })
    if (!ok) return
    try {
      await returnVehicleToService(vehicleId)
      refresh()
      queryClient.invalidateQueries({ queryKey: ['fleet-summary'] })
      toast.success(`${plate} is back in service`)
    } catch (err) {
      toast.error(apiErrorMessage(err, 'We could not return the vehicle to service.'))
    }
  }

  const save = useMutation({
    mutationFn: (body: object) => fleetAPI.logService(vehicleId, body),
    onSuccess: (res: { expense_recorded?: boolean; vehicle_status?: string }) => {
      toast.success(res.expense_recorded ? 'Service logged and the cost added to expenses' : 'Service logged')
      refresh()
      onClose()
      if (res.vehicle_status === 'maintenance') void offerReturnToService()
    },
    onError: err => setError(apiErrorMessage(err, 'We could not log this service. Try again.')),
  })

  const submit = () => {
    const odo = moneyOrNull(km)
    const next: Record<string, string> = {}
    if (!item.trim()) next.item = 'Enter what was done, for example Engine oil.'
    if (odo === undefined) next.km = 'Enter the odometer as a number, in km.'
    if (!doneAt) next.doneAt = 'Choose the date of the service.'
    setErrors(next)
    const extra = detailsPayload(details)
    if (!extra.ok) { setError(extra.error); return }
    if (Object.keys(next).length > 0) return
    setError('')
    save.mutate({ item: item.trim(), done_at: doneAt, odometer_km: odo ?? null, ...extra.body })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      onSubmit={submit}
      size="md"
      title={`Log a service for ${plate}`}
      description="This moves the next due date of a matching service item forward."
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={save.isPending}>Log service</Button>
        </>
      )}
    >
      <div className="space-y-4">
        <Input
          label="What was done"
          value={item}
          onChange={e => setItem(e.target.value)}
          list={listId}
          maxLength={60}
          placeholder="Engine oil, Brakes, General service…"
          error={errors.item}
          required
          autoFocus
        />
        <datalist id={listId}>{choices.map(c => <option key={c} value={c} />)}</datalist>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Date" type="date" max={istToday()} value={doneAt} onChange={e => setDoneAt(e.target.value)} error={errors.doneAt} required />
          <Input label="Odometer" type="number" inputMode="numeric" min={0} value={km} onChange={e => setKm(e.target.value)} trailing="km" error={errors.km} hint={odometer == null ? 'The odometer is not known yet. Enter it if you can.' : undefined} />
        </div>
        <ServiceDetailsFields vehicleId={vehicleId} value={details} onChange={setDetails} />
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      </div>
    </Modal>
  )
}
