import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { fleetAPI } from '@/services/api'
import { Alert, Button, Checkbox, Input, Modal, Select, Skeleton, Textarea } from '@/components/ui'
import { apiErrorMessage } from '../health'
import { istToday } from './condition'
import { maintenanceKeys, MAINTENANCE_REASONS, REASON_LABELS, type MaintenanceReason, type OpenWork } from './types'
import { useRefreshVehicle } from './useRefreshVehicle'

/**
 * Move a vehicle to maintenance. Asks why, when it should be back, and where it is going. A vehicle
 * with a route or a load is not moved until staff choose to release them; the driver is told.
 * Opened from the Fleet page, or from an SOS (breakdown or accident) to turn it into a job.
 */
export function MoveToMaintenanceModal({ vehicleId, plate, open, onClose, sos }: {
  vehicleId: string
  plate: string
  open: boolean
  onClose: () => void
  /** Set when this is started from an SOS alert: the alert is linked to the job and acknowledged. */
  sos?: { id: string; alert_type: string; description?: string | null }
}) {
  const startReason: MaintenanceReason = sos?.alert_type === 'accident' ? 'accident' : sos?.alert_type === 'breakdown' ? 'breakdown' : 'scheduled_service'
  const [reason, setReason] = useState<MaintenanceReason>(startReason)
  const [expected, setExpected] = useState('')
  const [workshop, setWorkshop] = useState('')
  const [note, setNote] = useState(sos?.description?.replace(/^\[Raised by staff[^\]]*\]\s*/, '') ?? '')
  const [release, setRelease] = useState(false)
  const [error, setError] = useState('')
  const refresh = useRefreshVehicle(vehicleId)
  const queryClient = useQueryClient()

  const preview = useQuery<{ open_work: OpenWork }>({
    queryKey: maintenanceKeys.preview(vehicleId),
    queryFn: () => fleetAPI.maintenancePreview(vehicleId),
    enabled: open,
    staleTime: 0,
  })
  const work = preview.data?.open_work

  const save = useMutation({
    mutationFn: (body: object) => fleetAPI.openMaintenance(vehicleId, body),
    onSuccess: () => {
      toast.success(`${plate} moved to maintenance`)
      refresh()
      queryClient.invalidateQueries({ queryKey: ['fleet-summary'] })
      queryClient.invalidateQueries({ queryKey: ['routes'] })
      queryClient.invalidateQueries({ queryKey: ['sos-alerts'] })
      onClose()
    },
    onError: err => {
      setError(apiErrorMessage(err, 'We could not move the vehicle to maintenance. Try again.'))
      queryClient.invalidateQueries({ queryKey: maintenanceKeys.preview(vehicleId) })
    },
  })

  const submit = () => {
    if (!expected) { setError('Say when the vehicle should be back.'); return }
    if (expected < istToday()) { setError('The expected return date cannot be in the past.'); return }
    if (work?.blocking && !release) { setError('Tick the box to release its routes and loads, or wait until they finish.'); return }
    setError('')
    save.mutate({
      reason_type: reason,
      expected_return_date: expected,
      workshop: workshop.trim() || null,
      note: note.trim() || null,
      release_work: work?.blocking ? release : false,
      sos_alert_id: sos?.id ?? null,
    })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      onSubmit={submit}
      title={`Move ${plate} to maintenance`}
      description="It is not offered for new work until you return it to service."
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={save.isPending} disabled={preview.isLoading}>Move to maintenance</Button>
        </>
      )}
    >
      <div className="space-y-4">
        {preview.isLoading && <Skeleton className="h-16 w-full" />}
        {work?.blocking && (
          <Alert tone="warning" title={`${plate} has work in progress`}>
            <p>{work.summary}.</p>
            {work.shipments_on_board > 0 && (
              <p className="mt-1">Shipments already picked up stay on the vehicle. Arrange for them to be moved.</p>
            )}
            <div className="mt-2">
              <Checkbox
                checked={release}
                onChange={e => setRelease(e.target.checked)}
                label="Release its routes and shipments"
                description="Its routes and loads are cancelled, shipments not yet picked up go back to the queue, and the driver is told."
              />
            </div>
          </Alert>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Reason"
            value={reason}
            onChange={e => setReason(e.target.value as MaintenanceReason)}
            options={MAINTENANCE_REASONS.map(r => ({ value: r, label: REASON_LABELS[r] }))}
            required
          />
          <Input label="Expected back on" type="date" min={istToday()} value={expected} onChange={e => setExpected(e.target.value)} required />
        </div>
        <Input label="Workshop or place" value={workshop} onChange={e => setWorkshop(e.target.value)} maxLength={120} hint="Optional, for example Sharma Motors, Jamshedpur" />
        <Textarea label="Note" value={note} onChange={e => setNote(e.target.value)} maxLength={500} hint="Optional, what is wrong or what needs doing" />
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      </div>
    </Modal>
  )
}
