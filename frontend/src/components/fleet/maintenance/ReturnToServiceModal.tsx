import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { fleetAPI } from '@/services/api'
import { formatDate } from '@/utils/display'
import { Alert, Button, Checkbox, Input, Modal, Skeleton, Textarea } from '@/components/ui'
import { returnVehicleToService } from '../vehicleStatus'
import { apiErrorMessage, type ServiceItem } from '../health'
import { istToday } from './condition'
import { ServiceDetailsFields } from './ServiceDetailsFields'
import { detailsPayload, emptyDetails, type ServiceDetails } from './serviceDetails'
import { moneyOrNull } from './items'
import { maintenanceKeys, REASON_LABELS, type ConditionVehicle, type MaintenanceJob } from './types'
import { useRefreshVehicle } from './useRefreshVehicle'

const SUMMARY_FOR_REASON: Record<MaintenanceJob['reason_type'], string> = {
  scheduled_service: 'Scheduled service',
  breakdown: 'Breakdown repair',
  accident: 'Accident repair',
  tyre: 'Tyre work',
  other: 'Maintenance',
}

/**
 * Return to service: closes the maintenance job with the final odometer, what it cost, the parts
 * replaced and the papers. The visit becomes a service record, the schedule items serviced move
 * forward, and the vehicle is available again.
 */
export function ReturnToServiceModal({ vehicleId, plate, open, onClose }: {
  vehicleId: string
  plate: string
  open: boolean
  onClose: () => void
}) {
  const jobs = useQuery<MaintenanceJob[]>({
    queryKey: maintenanceKeys.jobs(vehicleId),
    queryFn: () => fleetAPI.maintenanceJobs({ vehicle_id: vehicleId }) as Promise<MaintenanceJob[]>,
    enabled: open,
  })
  const vehicle = useQuery<ConditionVehicle>({
    queryKey: maintenanceKeys.vehicle(vehicleId),
    queryFn: () => fleetAPI.vehicle(vehicleId) as Promise<ConditionVehicle>,
    enabled: open,
  })
  const plans = useQuery<ServiceItem[]>({
    queryKey: maintenanceKeys.plans(vehicleId),
    queryFn: () => fleetAPI.servicePlans(vehicleId) as Promise<ServiceItem[]>,
    enabled: open,
  })
  const job = jobs.data?.find(j => j.status === 'open') ?? null
  const ready = !jobs.isLoading && !vehicle.isLoading && !plans.isLoading

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={`Return ${plate} to service`}
      description={job ? 'Record what was done. The vehicle becomes available for dispatch again.' : undefined}
    >
      {!ready ? <Skeleton className="h-40 w-full" /> : job ? (
        <ReturnForm
          key={job.id}
          job={job}
          vehicleId={vehicleId}
          plate={plate}
          currentKm={vehicle.data?.odometer_km ?? null}
          planItems={(plans.data ?? []).map(p => p.item)}
          onClose={onClose}
        />
      ) : (
        <NoJob vehicleId={vehicleId} plate={plate} onClose={onClose} />
      )}
    </Modal>
  )
}

/** A vehicle in maintenance with no job (held after an SOS): it can still go back, without a record. */
function NoJob({ vehicleId, plate, onClose }: { vehicleId: string; plate: string; onClose: () => void }) {
  const refresh = useRefreshVehicle(vehicleId)
  const queryClient = useQueryClient()
  const back = useMutation({
    mutationFn: () => returnVehicleToService(vehicleId),
    onSuccess: () => {
      toast.success(`${plate} is back in service`)
      refresh()
      queryClient.invalidateQueries({ queryKey: ['fleet-summary'] })
      onClose()
    },
    onError: err => toast.error(apiErrorMessage(err, 'We could not return the vehicle to service.')),
  })
  return (
    <div className="space-y-4">
      <Alert tone="info" title="No maintenance job is open">
        {plate} was put in maintenance without one, for example after an SOS. Return it now if it is safe to dispatch, or open a job from the Maintenance section to keep a record.
      </Alert>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Keep in maintenance</Button>
        <Button loading={back.isPending} onClick={() => back.mutate()}>Return to service</Button>
      </div>
    </div>
  )
}

function ReturnForm({ job, vehicleId, plate, currentKm, planItems, onClose }: {
  job: MaintenanceJob
  vehicleId: string
  plate: string
  currentKm: number | null
  planItems: string[]
  onClose: () => void
}) {
  const [summary, setSummary] = useState(SUMMARY_FOR_REASON[job.reason_type])
  const [doneAt, setDoneAt] = useState(istToday())
  const [km, setKm] = useState(currentKm != null ? String(Math.round(currentKm)) : '')
  const [reason, setReason] = useState('')
  const [serviced, setServiced] = useState<string[]>([])
  const [details, setDetails] = useState<ServiceDetails>(() => emptyDetails(job.workshop ?? ''))
  const [error, setError] = useState('')
  const refresh = useRefreshVehicle(vehicleId)
  const queryClient = useQueryClient()

  const finalKm = moneyOrNull(km)
  const lower = currentKm != null && typeof finalKm === 'number' && finalKm < currentKm
  const sorted = useMemo(() => [...planItems].sort((a, b) => a.localeCompare(b)), [planItems])

  const close = useMutation({
    mutationFn: (body: object) => fleetAPI.closeMaintenanceJob(job.id, body),
    onSuccess: () => {
      toast.success(`${plate} is back in service`)
      refresh()
      queryClient.invalidateQueries({ queryKey: ['fleet-summary'] })
      queryClient.invalidateQueries({ queryKey: ['sos-alerts'] })
      onClose()
    },
    onError: err => setError(apiErrorMessage(err, 'We could not return the vehicle to service. Try again.')),
  })

  const submit = () => {
    if (finalKm == null) { setError('Enter the odometer reading on the dashboard, in km.'); return }
    if (!summary.trim()) { setError('Enter what was done.'); return }
    if (lower && reason.trim().length < 3) { setError('The reading is lower than the current one. Say why it is being corrected.'); return }
    const extra = detailsPayload(details)
    if (!extra.ok) { setError(extra.error); return }
    setError('')
    close.mutate({
      final_odometer_km: finalKm,
      correction_reason: lower ? reason.trim() : null,
      summary: summary.trim(),
      done_at: doneAt,
      serviced_items: serviced,
      ...extra.body,
    })
  }

  const late = job.is_overdue ? ` It was expected back on ${formatDate(job.expected_return_date)}.` : ''
  return (
    <form
      noValidate
      onSubmit={e => { e.preventDefault(); submit() }}
      className="space-y-4"
    >
      <p className="text-sm text-muted">
        In maintenance since {formatDate(job.opened_at)} ({REASON_LABELS[job.reason_type].toLowerCase()}
        {job.workshop ? `, ${job.workshop}` : ''}).{late}
      </p>
      <Input label="What was done" value={summary} onChange={e => setSummary(e.target.value)} maxLength={60} required />
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Odometer now" type="number" inputMode="decimal" min={0} value={km} onChange={e => setKm(e.target.value)} trailing="km" required />
        <Input label="Date done" type="date" max={istToday()} value={doneAt} onChange={e => setDoneAt(e.target.value)} required />
      </div>
      {lower && (
        <Textarea
          label="Why is the reading lower?"
          value={reason}
          onChange={e => setReason(e.target.value)}
          maxLength={300}
          hint="The odometer does not go back without a reason, for example a new instrument cluster."
          required
        />
      )}
      {sorted.length > 0 && (
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium text-text">Service items done</legend>
          <p className="text-xs text-muted">Their next due date is counted from today.</p>
          <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
            {sorted.map(p => (
              <Checkbox
                key={p}
                label={p}
                checked={serviced.includes(p)}
                onChange={e => setServiced(e.target.checked ? [...serviced, p] : serviced.filter(x => x !== p))}
              />
            ))}
          </div>
        </fieldset>
      )}
      <ServiceDetailsFields vehicleId={vehicleId} value={details} onChange={setDetails} />
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      <div className="flex flex-col-reverse gap-2 border-t border-border pt-3 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" loading={close.isPending}>Return to service</Button>
      </div>
    </form>
  )
}
