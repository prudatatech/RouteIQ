/**
 * The small forms behind a consignment's cargo actions (shipment drawer and vendor loads):
 * move to another vehicle, hold, hub in/out, re-attempt and start a return.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Alert, Button, Input, Modal, Select, Textarea } from '@/components/ui'
import { depotsAPI, vehiclesAPI } from '@/services/api'
import { errorMessage, formatKg } from '@/utils/display'
import {
  CONDITION_CODES, cargoKeys, custodyAPI, exceptionsAPI, transfersAPI,
  type CargoRef, type ConditionCode, type CustodyBody, type ExceptionType, type WhereIsIt,
} from '@/services/cargo'
import { CONDITION_LABELS, EXCEPTION_TYPE_LABELS, exceptionTypeLabel, isOpenException, onBoardCount, positionOf } from './logic'

export type ConsignmentModal = 'move' | 'hold' | 'hub_in' | 'hub_out' | 'reattempt' | 'return'

interface Common {
  cargoRef: CargoRef
  code: string
  where: WhereIsIt
  onClose: () => void
}

function useDone(onClose: () => void) {
  const queryClient = useQueryClient()
  return (message: string) => {
    queryClient.invalidateQueries({ queryKey: cargoKeys.all })
    queryClient.invalidateQueries({ queryKey: ['shipments'] })
    toast.success(message)
    onClose()
  }
}

const wholeNumber = (raw: string, max: number | null, what = 'pieces'): string | undefined => {
  const n = Number(raw)
  if (!raw.trim()) return `Enter the number of ${what}.`
  if (!Number.isInteger(n) || n < 1) return 'Enter a whole number of 1 or more.'
  if (max != null && n > max) return `Only ${max.toLocaleString('en-IN')} ${what} are here.`
  return undefined
}

function Footer({ onClose, busy, label, danger }: { onClose: () => void; busy: boolean; label: string; danger?: boolean }) {
  return (
    <>
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button type="submit" variant={danger ? 'danger' : 'primary'} loading={busy}>{label}</Button>
    </>
  )
}

interface VehicleRow { id: string; plate_number: string; status?: string | null; available_capacity_kg?: number | null; vehicle_type?: string | null }

/** Move the goods to another vehicle: plans a transfer (POST /cargo/transfers) and opens it. */
export function MoveToVehicleModal({ cargoRef, code, where, onClose }: Common) {
  const navigate = useNavigate()
  const done = useDone(onClose)
  const onBoard = onBoardCount(where.pieces)
  const [vehicleId, setVehicleId] = useState('')
  const [pieces, setPieces] = useState(String(onBoard || ''))
  const [meet, setMeet] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [serverError, setServerError] = useState('')

  const vehicles = useQuery({
    queryKey: ['vehicles', 'transfer-targets'],
    queryFn: async () => ((await vehiclesAPI.list()) as VehicleRow[])
      .filter(v => ['available', 'idle', 'on_route'].includes(v.status ?? ''))
      .sort((a, b) => a.plate_number.localeCompare(b.plate_number)),
  })
  const options = (vehicles.data ?? []).filter(v => v.id !== where.vehicle?.id)

  const create = useMutation({
    mutationFn: () => {
      const pos = positionOf(where.vehicle)
      return transfersAPI.create({
        from_vehicle_id: where.vehicle!.id,
        to_vehicle_id: vehicleId,
        items: [{ ref: cargoRef, pieces: Number(pieces) }],
        meet_address: meet.trim(),
        ...(pos ? { meet_lat: pos.lat, meet_lng: pos.lng } : {}),
      })
    },
    onSuccess: transfer => {
      done(transfer.code ? `Transfer ${transfer.code} planned. Both drivers are told.` : 'Transfer planned. Both drivers are told.')
      if (transfer.id) navigate(`/cargo/transfers/${transfer.id}`)
    },
    onError: err => setServerError(errorMessage(err, 'We could not plan the transfer. Try again.')),
  })

  const submit = () => {
    const next: Record<string, string> = {}
    if (!vehicleId) next.vehicle = 'Choose the vehicle that takes the goods.'
    const pe = wholeNumber(pieces, onBoard || null)
    if (pe) next.pieces = pe
    if (!meet.trim()) next.meet = 'Say where the vehicles meet.'
    setErrors(next)
    if (Object.keys(next).length > 0) return
    setServerError('')
    create.mutate()
  }

  return (
    <Modal
      open
      onClose={onClose}
      onSubmit={submit}
      closeOnBackdrop={false}
      title={`Move ${code} to another vehicle`}
      description={`From ${where.vehicle?.plate_number ?? 'its vehicle'}. A transfer is planned; both drivers count the pieces at the handover.`}
      footer={<Footer onClose={onClose} busy={create.isPending} label="Plan transfer" />}
    >
      <div className="space-y-4">
        <Select
          label="New vehicle"
          value={vehicleId}
          onChange={e => setVehicleId(e.target.value)}
          placeholder={vehicles.isLoading ? 'Loading vehicles…' : options.length === 0 ? 'No vehicle is free' : 'Choose a vehicle'}
          disabled={vehicles.isLoading || options.length === 0}
          options={options.map(v => ({
            value: v.id,
            label: `${v.plate_number}${v.available_capacity_kg != null ? ` · ${formatKg(v.available_capacity_kg)} free` : ''}`,
          }))}
          error={errors.vehicle ?? (vehicles.isError ? 'We could not load vehicles. Close and try again.' : undefined)}
          hint="The server checks the vehicle has room for the goods."
          required
        />
        <Input label="Pieces to move" type="number" inputMode="numeric" min={1} max={onBoard || undefined} value={pieces} onChange={e => setPieces(e.target.value)} error={errors.pieces} hint={onBoard ? `${onBoard.toLocaleString('en-IN')} on board` : undefined} required />
        <Input label="Meeting place" value={meet} onChange={e => setMeet(e.target.value)} error={errors.meet} maxLength={200} hint="Where the two drivers meet" required />
        {serverError && <Alert tone="danger">{serverError}</Alert>}
      </div>
    </Modal>
  )
}

/** Put the goods on hold with a reason (custody `hold`, staff only). */
export function HoldModal({ cargoRef, code, onClose }: Common) {
  const done = useDone(onClose)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const hold = useMutation({
    mutationFn: () => custodyAPI.record({ ref: cargoRef, kind: 'hold', reason: reason.trim(), notes: reason.trim() }),
    onSuccess: () => done(`${code} is on hold`),
    onError: err => setError(errorMessage(err, 'We could not put it on hold. Try again.')),
  })
  return (
    <Modal
      open
      onClose={onClose}
      onSubmit={() => { if (!reason.trim()) { setError('Say why the goods are held.'); return } setError(''); hold.mutate() }}
      title={`Hold ${code}`}
      description="The goods stay where they are and nothing moves until the hold is released."
      footer={<Footer onClose={onClose} busy={hold.isPending} label="Put on hold" />}
    >
      <Textarea label="Reason" value={reason} onChange={e => setReason(e.target.value)} error={error} maxLength={500} required data-autofocus />
    </Modal>
  )
}

/** Record goods arriving at or leaving a hub (custody `hub_in` / `hub_out`), with the count and condition. */
export function HubModal({ cargoRef, code, where, onClose, direction }: Common & { direction: 'in' | 'out' }) {
  const done = useDone(onClose)
  const available = direction === 'in' ? onBoardCount(where.pieces) : (where.pieces.total ?? 0) - where.pieces.delivered - where.pieces.short - where.pieces.returned
  const [depotId, setDepotId] = useState('')
  const [pieces, setPieces] = useState(available > 0 ? String(available) : '')
  const [condition, setCondition] = useState<ConditionCode>('good')
  const [notes, setNotes] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [serverError, setServerError] = useState('')
  const depots = useQuery({ queryKey: ['depots'], queryFn: depotsAPI.list, enabled: direction === 'in' })

  const save = useMutation({
    mutationFn: () => {
      const body: CustodyBody = {
        ref: cargoRef,
        kind: direction === 'in' ? 'hub_in' : 'hub_out',
        pieces: Number(pieces),
        condition,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        ...(direction === 'in' ? { to_depot_id: depotId } : { from_depot_id: where.depot!.id }),
      }
      return custodyAPI.record(body)
    },
    onSuccess: () => done(direction === 'in' ? `${code} checked in at the hub` : `${code} checked out of the hub`),
    onError: err => setServerError(errorMessage(err, 'We could not record it. Try again.')),
  })

  const submit = () => {
    const next: Record<string, string> = {}
    if (direction === 'in' && !depotId) next.depot = 'Choose the hub.'
    const pe = wholeNumber(pieces, available > 0 ? available : null)
    if (pe) next.pieces = pe
    if (condition !== 'good' && !notes.trim()) next.notes = 'Describe the problem; a case opens for it.'
    setErrors(next)
    if (Object.keys(next).length > 0) return
    setServerError('')
    save.mutate()
  }

  return (
    <Modal
      open
      onClose={onClose}
      onSubmit={submit}
      title={direction === 'in' ? `Hub in: ${code}` : `Hub out: ${code}`}
      description={direction === 'in'
        ? `Count the pieces as they come off ${where.vehicle?.plate_number ?? 'the vehicle'}.`
        : `Count the pieces as they leave ${where.depot?.name ?? 'the hub'}.`}
      footer={<Footer onClose={onClose} busy={save.isPending} label={direction === 'in' ? 'Record hub in' : 'Record hub out'} />}
    >
      <div className="space-y-4">
        {direction === 'in' && (
          <Select
            label="Hub"
            value={depotId}
            onChange={e => setDepotId(e.target.value)}
            placeholder={depots.isLoading ? 'Loading hubs…' : 'Choose a hub'}
            disabled={depots.isLoading}
            options={(depots.data ?? []).map(d => ({ value: d.id, label: d.name }))}
            error={errors.depot ?? (depots.isError ? 'We could not load the hubs. Close and try again.' : undefined)}
            required
          />
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Pieces counted" type="number" inputMode="numeric" min={1} value={pieces} onChange={e => setPieces(e.target.value)} error={errors.pieces} hint={available > 0 ? `${available.toLocaleString('en-IN')} expected` : undefined} required />
          <Select label="Condition" value={condition} onChange={e => setCondition(e.target.value as ConditionCode)} options={CONDITION_CODES.map(c => ({ value: c, label: CONDITION_LABELS[c] }))} required />
        </div>
        <Textarea label="Notes" value={notes} onChange={e => setNotes(e.target.value)} error={errors.notes} maxLength={500} hint={condition === 'good' ? 'Optional' : 'Required when the condition is not good'} />
        {serverError && <Alert tone="danger">{serverError}</Alert>}
      </div>
    </Modal>
  )
}

/** Local "2026-10-01T09:30", tomorrow at this time. */
function tomorrowInput(): string {
  const d = new Date(Date.now() + 24 * 3_600_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Schedule another delivery attempt on the open refused or undeliverable case. */
export function ReattemptModal({ code, where, caseId, onClose }: Common & { caseId: string }) {
  const done = useDone(onClose)
  const [when, setWhen] = useState(tomorrowInput)
  const [error, setError] = useState('')
  const kase = where.open_exceptions.find(e => e.id === caseId)
  const save = useMutation({
    mutationFn: () => exceptionsAPI.act(caseId, { action: 'reattempt', scheduled_for: new Date(when).toISOString() }),
    onSuccess: () => done(`Re-attempt for ${code} scheduled`),
    onError: err => setError(errorMessage(err, 'We could not schedule the re-attempt. Try again.')),
  })
  const submit = () => {
    const at = new Date(when).getTime()
    if (!when || Number.isNaN(at)) { setError('Say when to try again.'); return }
    if (at < Date.now()) { setError('Pick a time in the future.'); return }
    setError('')
    save.mutate()
  }
  const attempts = `${where.delivery_attempts.toLocaleString('en-IN')}${where.max_delivery_attempts ? ` of ${where.max_delivery_attempts.toLocaleString('en-IN')}` : ''}`
  return (
    <Modal
      open
      onClose={onClose}
      onSubmit={submit}
      title={`Re-attempt delivery of ${code}`}
      description={`Attempts so far: ${attempts}.${kase ? ` Scheduled under ${kase.code}.` : ''}`}
      footer={<Footer onClose={onClose} busy={save.isPending} label="Schedule re-attempt" />}
    >
      <Input label="Try again at" type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} error={error} required />
    </Modal>
  )
}

const RETURN_REASONS: ExceptionType[] = ['refused', 'undeliverable', 'damage', 'other']

/**
 * Start a return to the sender. Uses the consignment's open case when it has one; otherwise a
 * case is opened first, so the return has an owner and a record.
 */
export function StartReturnModal({ cargoRef, code, where, onClose }: Common) {
  const done = useDone(onClose)
  const openCases = where.open_exceptions.filter(e => isOpenException(e.status))
  const [caseId, setCaseId] = useState(openCases[0]?.id ?? '')
  const [type, setType] = useState<ExceptionType | ''>('')
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [serverError, setServerError] = useState('')

  const save = useMutation({
    mutationFn: async () => {
      let target = caseId
      if (!target) {
        const created = await exceptionsAPI.raise({
          type: type as ExceptionType,
          severity: 'medium',
          description: note.trim(),
          items: [{ ref: cargoRef, pieces_affected: onBoardCount(where.pieces) || (where.pieces.total ?? 0), condition: 'good' }],
          ...(where.vehicle?.id ? { vehicle_id: where.vehicle.id } : {}),
        })
        target = created.id
      }
      await exceptionsAPI.act(target, { action: 'return_to_origin', note: note.trim() || undefined })
    },
    onSuccess: () => done(`Return started for ${code}. The sender is told.`),
    onError: err => setServerError(errorMessage(err, 'We could not start the return. Try again.')),
  })

  const submit = () => {
    const next: Record<string, string> = {}
    if (!caseId && !type) next.type = 'Choose why it goes back.'
    if (!caseId && !note.trim()) next.note = 'Say why the goods go back.'
    setErrors(next)
    if (Object.keys(next).length > 0) return
    setServerError('')
    save.mutate()
  }

  return (
    <Modal
      open
      onClose={onClose}
      onSubmit={submit}
      closeOnBackdrop={false}
      title={`Return ${code} to the sender`}
      description="A return leg is added; the goods travel back with their own custody record."
      footer={<Footer onClose={onClose} busy={save.isPending} label="Start return" />}
    >
      <div className="space-y-4">
        {openCases.length > 0 ? (
          <Select
            label="Case"
            value={caseId}
            onChange={e => setCaseId(e.target.value)}
            options={[
              ...openCases.map(e => ({ value: e.id, label: `${e.code} · ${exceptionTypeLabel(e.type)}` })),
              { value: '', label: 'Open a new case for the return' },
            ]}
            hint="The return is recorded on this case."
          />
        ) : (
          <Alert tone="info">This consignment has no open case, so one is opened for the return.</Alert>
        )}
        {!caseId && (
          <Select
            label="Why it goes back"
            value={type}
            onChange={e => setType(e.target.value as ExceptionType)}
            placeholder="Choose"
            options={RETURN_REASONS.map(t => ({ value: t, label: EXCEPTION_TYPE_LABELS[t] }))}
            error={errors.type}
            required
          />
        )}
        <Textarea label={caseId ? 'Note' : 'Details'} value={note} onChange={e => setNote(e.target.value)} error={errors.note} maxLength={500} required={!caseId} hint={caseId ? 'Optional' : undefined} />
        {serverError && <Alert tone="danger">{serverError}</Alert>}
      </div>
    </Modal>
  )
}
