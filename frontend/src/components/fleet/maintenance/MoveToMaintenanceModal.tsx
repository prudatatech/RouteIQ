import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { depotsAPI, fleetAPI } from '@/services/api'
import { OPEN_EXCEPTION_FILTER, cargoKeys, exceptionsAPI } from '@/services/cargo'
import { holdCaseFor } from '@/components/cargo/logic'
import { OnBoardList } from '@/components/cargo/OnBoardList'
import { onBoardTotals, useOnBoard } from '@/components/cargo/useOnBoard'
import { formatKg } from '@/utils/display'
import { Alert, Button, Checkbox, Input, Modal, Select, Skeleton, Textarea } from '@/components/ui'
import { apiErrorMessage } from '../health'
import { istToday } from './condition'
import { maintenanceKeys, MAINTENANCE_REASONS, REASON_LABELS, type MaintenanceReason, type OpenWork } from './types'
import { useRefreshVehicle } from './useRefreshVehicle'

type CargoPlan = 'transship' | 'hub' | 'hold'

const PLAN_OPTIONS: { value: CargoPlan; label: string; description: string }[] = [
  { value: 'transship', label: 'Plan a transfer now', description: 'After the move, pick a relief vehicle on the case that opens.' },
  { value: 'hub', label: 'Move to a hub', description: 'The goods are sent to the depot you choose.' },
  { value: 'hold', label: 'Hold with the vehicle', description: 'The goods stay on the vehicle, on hold under the case that opens.' },
]

/** What POST /fleet/vehicles/:id/maintenance answers that the cargo plan needs. */
interface OpenedJob { id: string; released_work?: { cargo_exception_id?: string | null } | null }

/**
 * The case holding the goods after the move. Releasing the work holds them on one case per
 * vehicle (a breakdown, accident or, for a scheduled service, `other`), which may be the case an
 * SOS already opened: the job answers its id; otherwise the hold case linked to the job is found.
 */
async function findHoldCase(vehicleId: string, job: OpenedJob | undefined): Promise<{ id: string; code: string } | null> {
  const cases = await exceptionsAPI.list({ vehicle_id: vehicleId, status: OPEN_EXCEPTION_FILTER })
  const byId = job?.released_work?.cargo_exception_id ? cases.find(c => c.id === job.released_work!.cargo_exception_id) : undefined
  return byId ?? holdCaseFor(cases, { maintenanceJobId: job?.id ?? null })
}

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
  const [plan, setPlan] = useState<CargoPlan | ''>('')
  const [depotId, setDepotId] = useState('')
  const [error, setError] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const refresh = useRefreshVehicle(vehicleId)
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const preview = useQuery<{ open_work: OpenWork }>({
    queryKey: maintenanceKeys.preview(vehicleId),
    queryFn: () => fleetAPI.maintenancePreview(vehicleId),
    enabled: open,
    staleTime: 0,
  })
  const work = preview.data?.open_work

  const onBoard = useOnBoard(vehicleId, { enabled: open })
  const cargo = onBoard.data?.items ?? []
  const hasCargo = cargo.length > 0
  const totals = onBoardTotals(cargo)
  const depots = useQuery({ queryKey: ['depots'], queryFn: depotsAPI.list, enabled: open && plan === 'hub' })
  // Routes and loads not yet picked up need the tick; goods already on board follow the plan instead.
  const needsRelease = !!work?.blocking && (!hasCargo || (work.routes.length > 0 || work.manifests.length > 0))

  /** The move went through and goods were on board: carry out the plan on the case the backend opened. */
  const planCargo = async (job: OpenedJob | undefined) => {
    try {
      const found = await findHoldCase(vehicleId, job)
      if (!found) {
        toast('The goods on board are on hold. Open Cargo, then Problems, to plan them.', { duration: 8000 })
      } else if (plan === 'transship') {
        navigate(`/cargo/exceptions/${found.id}?action=transship`)
      } else if (plan === 'hub') {
        await exceptionsAPI.act(found.id, { action: 'move_to_hub', depot_id: depotId })
        toast.success(`Goods are on their way to the hub under case ${found.code}`)
      } else {
        toast.success(`Goods held on the vehicle under case ${found.code}`)
      }
    } catch (err) {
      toast.error(apiErrorMessage(err, 'The vehicle is in maintenance, but the goods could not be planned. Open Cargo, then Problems, to finish.'))
    } finally {
      queryClient.invalidateQueries({ queryKey: cargoKeys.all })
    }
  }

  const save = useMutation({
    mutationFn: (body: object) => fleetAPI.openMaintenance(vehicleId, body) as Promise<OpenedJob>,
    onSuccess: async job => {
      toast.success(`${plate} moved to maintenance`)
      refresh()
      queryClient.invalidateQueries({ queryKey: ['fleet-summary'] })
      queryClient.invalidateQueries({ queryKey: ['routes'] })
      queryClient.invalidateQueries({ queryKey: ['sos-alerts'] })
      onClose()
      if (hasCargo) await planCargo(job)
    },
    onError: err => {
      setError(apiErrorMessage(err, 'We could not move the vehicle to maintenance. Try again.'))
      queryClient.invalidateQueries({ queryKey: maintenanceKeys.preview(vehicleId) })
    },
  })

  const submit = () => {
    const next: Record<string, string> = {}
    if (!expected) next.expected = 'Say when the vehicle should be back.'
    else if (expected < istToday()) next.expected = 'The expected return date cannot be in the past.'
    if (needsRelease && !release) next.release = 'Tick the box to release its trips and loads, or wait until they finish.'
    if (hasCargo && !plan) next.plan = 'Choose what happens to the goods on board.'
    if (hasCargo && plan === 'hub' && !depotId) next.depot = 'Choose the hub to send the goods to.'
    setErrors(next)
    if (Object.keys(next).length > 0) return
    setError('')
    save.mutate({
      reason_type: reason,
      expected_return_date: expected,
      workshop: workshop.trim() || null,
      note: note.trim() || null,
      release_work: work?.blocking ? (needsRelease ? release : true) : false,
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
          <Button type="submit" loading={save.isPending} disabled={preview.isLoading || onBoard.isLoading || onBoard.isError}>Move to maintenance</Button>
        </>
      )}
    >
      <div className="space-y-4">
        {(preview.isLoading || onBoard.isLoading) && <Skeleton className="h-16 w-full" />}
        {onBoard.isError && (
          <Alert tone="danger" title="We could not check the cargo on board">
            <p>Try again before moving the vehicle, so no goods are left without a plan.</p>
            <div className="mt-2"><Button variant="secondary" size="sm" onClick={() => onBoard.refetch()}>Try again</Button></div>
          </Alert>
        )}
        {work?.blocking && (
          <Alert tone="warning" title={`${plate} has work in progress`}>
            <p>{work.summary}.</p>
            {needsRelease && (
              <div className="mt-2">
                <Checkbox
                  checked={release}
                  onChange={e => setRelease(e.target.checked)}
                  error={errors.release}
                  label="Release its trips and loads"
                  description={hasCargo
                    ? 'Its trips and loads are cancelled, shipments not yet picked up go back to the queue, and the driver is told. Goods already on board follow the plan below.'
                    : 'Its trips and loads are cancelled, shipments not yet picked up go back to the queue, and the driver is told.'}
                />
              </div>
            )}
          </Alert>
        )}
        {hasCargo && (
          <fieldset className="space-y-3 rounded-card border border-border p-3">
            <legend className="px-1 text-sm font-medium text-text">Goods on board</legend>
            <p className="text-sm text-muted">
              {totals.consignments.toLocaleString('en-IN')} {totals.consignments === 1 ? 'consignment' : 'consignments'}, {totals.pieces.toLocaleString('en-IN')} pieces, {formatKg(totals.weightKg)}. Choose what happens to them.
            </p>
            <div className="max-h-48 overflow-y-auto rounded-control border border-border px-3">
              <OnBoardList items={cargo} compact />
            </div>
            <div className="space-y-2" role="radiogroup" aria-label="Plan for the goods on board" aria-invalid={!!errors.plan}>
              {PLAN_OPTIONS.map(o => (
                <label key={o.value} className="flex cursor-pointer items-start gap-2.5 text-sm">
                  <input
                    type="radio"
                    name="cargo-plan"
                    value={o.value}
                    checked={plan === o.value}
                    onChange={() => { setPlan(o.value); setErrors(prev => ({ ...prev, plan: '' })) }}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-brand"
                  />
                  <span><span className="block font-medium text-text">{o.label}</span><span className="block text-xs text-muted">{o.description}</span></span>
                </label>
              ))}
            </div>
            {errors.plan && <p className="text-sm text-danger" role="alert">{errors.plan}</p>}
            {plan === 'hub' && (
              <Select
                label="Hub"
                value={depotId}
                onChange={e => setDepotId(e.target.value)}
                options={[{ value: '', label: depots.isLoading ? 'Loading hubs…' : 'Choose a hub' }, ...(depots.data ?? []).map(d => ({ value: d.id, label: d.name }))]}
                error={errors.depot ?? (depots.isError ? 'We could not load the hubs. Close this and try again.' : undefined)}
                required
              />
            )}
          </fieldset>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Reason"
            value={reason}
            onChange={e => setReason(e.target.value as MaintenanceReason)}
            options={MAINTENANCE_REASONS.map(r => ({ value: r, label: REASON_LABELS[r] }))}
            required
          />
          <Input label="Expected back on" type="date" min={istToday()} value={expected} onChange={e => setExpected(e.target.value)} error={errors.expected} required />
        </div>
        <Input label="Workshop or place" value={workshop} onChange={e => setWorkshop(e.target.value)} maxLength={120} hint="Optional, for example Sharma Motors, Jamshedpur" />
        <Textarea label="Note" value={note} onChange={e => setNote(e.target.value)} maxLength={500} hint="Optional, what is wrong or what needs doing" />
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      </div>
    </Modal>
  )
}
