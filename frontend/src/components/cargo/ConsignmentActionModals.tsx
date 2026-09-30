/**
 * The small forms behind a consignment's cargo actions (shipment drawer and vendor loads):
 * move to another vehicle, hold, hub in/out, re-attempt and start a return.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Alert, Button, FileButton, Input, Modal, Select, Textarea } from '@/components/ui'
import { depotsAPI } from '@/services/api'
import { errorMessage, formatKg } from '@/utils/display'
import {
  CONDITION_CODES, cargoKeys, custodyAPI, exceptionsAPI, transfersAPI,
  type CargoRef, type ConditionCode, type CustodyBody, type ExceptionType, type WhereIsIt,
} from '@/services/cargo'
import { useOperatingVehicles } from './useOperatingVehicles'
import { parsePieces, partialTransferNote } from './lots'
import { CONDITION_LABELS, EXCEPTION_TYPE_LABELS, exceptionTypeLabel, isOpenException, onBoardCount, positionOf } from './logic'

export type ConsignmentModal = 'move' | 'hold' | 'hub_in' | 'hub_out' | 'reattempt' | 'return' | 'pickup' | 'deliver'

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

/**
 * Move the goods, or part of them, to another vehicle: plans a transfer (POST /cargo/transfers)
 * and opens it. Fewer pieces than on board make a partial transfer: the backend splits the
 * consignment into a lot that moves and a lot that stays, and transfers the moving lot.
 */
export function MoveToVehicleModal({ cargoRef, code, where, onClose }: Common) {
  const navigate = useNavigate()
  const done = useDone(onClose)
  const onBoard = onBoardCount(where.pieces)
  const [pieces, setPieces] = useState(onBoard > 0 ? String(onBoard) : '')
  const [vehicleId, setVehicleId] = useState('')
  const [meet, setMeet] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [serverError, setServerError] = useState('')

  const vehicles = useOperatingVehicles()
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
      // A partial move split the goods first: the moving lot is on the transfer, the staying lot stays on board
      const split = transfer.splits?.[0]
      const planned = transfer.code ? `Transfer ${transfer.code} planned` : 'Transfer planned'
      const count = (x: number | null) => (x ?? 0).toLocaleString('en-IN')
      done(split
        ? `${planned}: ${count(split.moving.pieces)} move as lot ${split.moving.tracking_id ?? split.moving.label}, ${count(split.staying.pieces)} stay on board as lot ${split.staying.tracking_id ?? split.staying.label}. Both drivers are told.`
        : `${planned}. Both drivers are told.`)
      if (transfer.id) navigate(`/cargo/transfers/${transfer.id}`)
    },
    onError: err => setServerError(errorMessage(err, 'We could not plan the transfer. Try again.')),
  })

  const submit = () => {
    const next: Record<string, string> = {}
    if (!vehicleId) next.vehicle = 'Choose the vehicle that takes the goods.'
    if (onBoard < 1) next.vehicle = 'No pieces are on board to move.'
    const pe = wholeNumber(pieces, onBoard)
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
      title={`Move all or part of ${code} to another vehicle`}
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
        <Input
          label="Pieces to move"
          type="number"
          inputMode="numeric"
          min={1}
          max={onBoard}
          value={pieces}
          onChange={e => setPieces(e.target.value)}
          error={errors.pieces}
          hint={`${onBoard.toLocaleString('en-IN')} on board. Fewer than all moves part of it as a new lot.`}
          className="sm:max-w-xs"
          required
        />
        <PartialNote pieces={pieces} onBoard={onBoard} />
        <Input label="Meeting place" value={meet} onChange={e => setMeet(e.target.value)} error={errors.meet} maxLength={200} hint="Where the two drivers meet" required />
        {serverError && <Alert tone="danger">{serverError}</Alert>}
      </div>
    </Modal>
  )
}

/** "30 of 100 will move as a new lot" under the pieces box, once the count is a valid number. */
function PartialNote({ pieces, onBoard }: { pieces: string; onBoard: number }) {
  const n = parsePieces(pieces)
  const note = partialTransferNote(n != null && n <= onBoard ? n : null, onBoard)
  return note.partial
    ? <Alert tone="info">{note.text}</Alert>
    : <p className="text-sm text-text">{note.text}</p>
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
  const [vehicleId, setVehicleId] = useState('')
  const [nextStatus, setNextStatus] = useState<'in_transit' | 'out_for_delivery'>('in_transit')
  const [pieces, setPieces] = useState(available > 0 ? String(available) : '')
  const [condition, setCondition] = useState<ConditionCode>('good')
  const [notes, setNotes] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [serverError, setServerError] = useState('')
  const depots = useQuery({ queryKey: ['depots'], queryFn: depotsAPI.list, enabled: direction === 'in' })
  // Leaving a hub: the vehicle that collects the goods (the backend puts the remaining drops on its route)
  const vehicles = useOperatingVehicles(direction === 'out')

  const save = useMutation({
    mutationFn: () => {
      const body: CustodyBody = {
        ref: cargoRef,
        kind: direction === 'in' ? 'hub_in' : 'hub_out',
        pieces: Number(pieces),
        condition,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        ...(direction === 'in'
          ? { depot_id: depotId }
          : { depot_id: where.depot?.id, vehicle_id: vehicleId, ...(where.rto ? {} : { next_status: nextStatus }) }),
      }
      return custodyAPI.record(body)
    },
    onSuccess: () => done(direction === 'in' ? `${code} checked in at the hub` : `${code} checked out of the hub`),
    onError: err => setServerError(errorMessage(err, 'We could not record it. Try again.')),
  })

  const submit = () => {
    const next: Record<string, string> = {}
    if (direction === 'in' && !depotId) next.depot = 'Choose the hub.'
    if (direction === 'out' && !vehicleId) next.vehicle = 'Choose the vehicle collecting the goods.'
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
        {direction === 'out' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Collecting vehicle"
              value={vehicleId}
              onChange={e => setVehicleId(e.target.value)}
              placeholder={vehicles.isLoading ? 'Loading vehicles…' : 'Choose a vehicle'}
              disabled={vehicles.isLoading}
              options={(vehicles.data ?? []).map(v => ({ value: v.id, label: `${v.plate_number}${v.available_capacity_kg != null ? ` · ${formatKg(v.available_capacity_kg)} free` : ''}` }))}
              error={errors.vehicle ?? (vehicles.isError ? 'We could not load vehicles. Close and try again.' : undefined)}
              required
            />
            {where.rto
              ? <p className="self-end text-sm text-muted">These goods are on a return, so they leave as returning.</p>
              : (
                <Select
                  label="Next"
                  value={nextStatus}
                  onChange={e => setNextStatus(e.target.value as 'in_transit' | 'out_for_delivery')}
                  options={[{ value: 'in_transit', label: 'In transit' }, { value: 'out_for_delivery', label: 'Out for delivery' }]}
                />
              )}
          </div>
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
      // The action takes no note: a note on an existing case goes on the case log first
      if (caseId && note.trim()) await exceptionsAPI.act(target, { action: 'add_note', note: note.trim() })
      await exceptionsAPI.act(target, { action: 'return_to_origin' })
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

/**
 * Record the pickup from the control room (custody `pickup`): the pieces are counted onto the
 * planned vehicle. A count below the booking, or a condition other than good, opens a case.
 */
export function PickupModal({ cargoRef, code, where, onClose }: Common) {
  const done = useDone(onClose)
  const booked = where.pieces.total
  const [pieces, setPieces] = useState(booked != null ? String(booked) : '')
  const [condition, setCondition] = useState<ConditionCode>('good')
  const [seal, setSeal] = useState('')
  const [notes, setNotes] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [serverError, setServerError] = useState('')

  const save = useMutation({
    mutationFn: () => custodyAPI.record({
      ref: cargoRef,
      kind: 'pickup',
      pieces: Number(pieces),
      condition,
      ...(where.vehicle?.id ? { vehicle_id: where.vehicle.id } : {}),
      ...(seal.trim() ? { seal_number: seal.trim() } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    }),
    onSuccess: res => done(res.exception_ids.length > 0 ? `${code} picked up. A case was opened for what was found.` : `${code} picked up`),
    onError: err => setServerError(errorMessage(err, 'We could not record the pickup. Try again.')),
  })

  const submit = () => {
    const next: Record<string, string> = {}
    const pe = wholeNumber(pieces, null)
    if (pe) next.pieces = pe
    if (condition !== 'good' && !notes.trim()) next.notes = 'Describe the problem; a case opens for it.'
    setErrors(next)
    if (Object.keys(next).length > 0) return
    setServerError('')
    save.mutate()
  }

  const counted = Number(pieces)
  return (
    <Modal
      open
      onClose={onClose}
      onSubmit={submit}
      title={`Record pickup: ${code}`}
      description={`Count the pieces as they go onto ${where.vehicle?.plate_number ?? 'the vehicle'}.`}
      footer={<Footer onClose={onClose} busy={save.isPending} label="Record pickup" />}
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Pieces counted" type="number" inputMode="numeric" min={1} value={pieces} onChange={e => setPieces(e.target.value)} error={errors.pieces} hint={booked != null ? `${booked.toLocaleString('en-IN')} booked` : 'Not counted at booking'} required />
          <Select label="Condition" value={condition} onChange={e => setCondition(e.target.value as ConditionCode)} options={CONDITION_CODES.map(c => ({ value: c, label: CONDITION_LABELS[c] }))} required />
        </div>
        {booked != null && Number.isInteger(counted) && counted > 0 && counted !== booked && (
          <Alert tone="warning">{counted < booked ? `${booked - counted} short of the booking: a shortage case opens.` : `${counted - booked} more than booked: an excess case opens.`}</Alert>
        )}
        <Input label="Seal number" value={seal} onChange={e => setSeal(e.target.value)} maxLength={60} hint="Optional. It is checked again at delivery." inputClassName="font-mono" />
        <Textarea label="Notes" value={notes} onChange={e => setNotes(e.target.value)} error={errors.notes} maxLength={500} hint={condition === 'good' ? 'Optional' : 'Required when the condition is not good'} />
        {serverError && <Alert tone="danger">{serverError}</Alert>}
      </div>
    </Modal>
  )
}

const PHOTO_TYPES = ['image/jpeg', 'image/png']

/**
 * Record a full delivery from the control room (custody `delivery`). The backend wants who
 * received it and proof: a photo, the delivery OTP, or (staff only) a reason that is logged.
 * A partial delivery or a refusal is recorded by the driver, or through the case.
 */
export function DeliveryModal({ cargoRef, code, where, onClose }: Common) {
  const done = useDone(onClose)
  const onBoard = onBoardCount(where.pieces)
  const [receiver, setReceiver] = useState('')
  const [condition, setCondition] = useState<ConditionCode>('good')
  const [damaged, setDamaged] = useState('')
  const [otp, setOtp] = useState('')
  const [reason, setReason] = useState('')
  const [photo, setPhoto] = useState<{ path: string; name: string } | null>(null)
  const [uploading, setUploading] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [serverError, setServerError] = useState('')

  const upload = async (file: File) => {
    if (!PHOTO_TYPES.includes(file.type)) { setErrors(e => ({ ...e, proof: 'Upload a JPG or PNG photo.' })); return }
    setUploading(true)
    try {
      const path = await custodyAPI.uploadPhoto(cargoRef, file)
      setPhoto({ path, name: file.name })
      setErrors(e => { const next = { ...e }; delete next.proof; return next })
    } catch (err) {
      setErrors(e => ({ ...e, proof: errorMessage(err, 'We could not upload the photo. Try again.') }))
    } finally {
      setUploading(false)
    }
  }

  const save = useMutation({
    mutationFn: () => {
      const d = Number(damaged)
      return custodyAPI.record({
        ref: cargoRef,
        kind: 'delivery',
        pieces: onBoard,
        receiver_name: receiver.trim(),
        condition,
        ...(damaged.trim() && d > 0 ? { pieces_damaged: d } : {}),
        ...(photo ? { photo_paths: [photo.path] } : {}),
        ...(otp.trim() ? { otp: otp.trim() } : {}),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      })
    },
    onSuccess: res => done(res.exception_ids.length > 0 ? `${code} delivered. A case was opened for the remarks.` : `${code} delivered`),
    onError: err => setServerError(errorMessage(err, 'We could not record the delivery. Try again.')),
  })

  const submit = () => {
    const next: Record<string, string> = {}
    if (!receiver.trim()) next.receiver = 'Enter who received the goods.'
    if (where.delivery_otp_required && !otp.trim()) next.otp = 'This shipment needs the delivery code the receiver was sent.'
    if (!photo && !otp.trim() && reason.trim().length < 3) next.proof = 'Add a delivery photo or the delivery code, or say why there is neither.'
    if (damaged.trim()) {
      const n = Number(damaged)
      if (!Number.isInteger(n) || n < 0) next.damaged = 'Enter a whole number.'
      else if (n > onBoard) next.damaged = `Only ${onBoard.toLocaleString('en-IN')} pieces are delivered.`
    }
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
      title={`Record delivery: ${code}`}
      description={`All ${onBoard.toLocaleString('en-IN')} ${onBoard === 1 ? 'piece' : 'pieces'} on ${where.vehicle?.plate_number ?? 'the vehicle'} are delivered. The driver records partial deliveries and refusals in the app.`}
      footer={<Footer onClose={onClose} busy={save.isPending} label="Record delivery" />}
    >
      <div className="space-y-4">
        <Input label="Received by" value={receiver} onChange={e => setReceiver(e.target.value)} error={errors.receiver} maxLength={200} required data-autofocus />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Condition" value={condition} onChange={e => setCondition(e.target.value as ConditionCode)} options={CONDITION_CODES.map(c => ({ value: c, label: CONDITION_LABELS[c] }))} required />
          <Input label="Pieces damaged" type="number" inputMode="numeric" min={0} value={damaged} onChange={e => setDamaged(e.target.value)} error={errors.damaged} hint="Optional. A damage case opens." />
        </div>
        <Input
          label="Delivery OTP"
          value={otp}
          onChange={e => setOtp(e.target.value)}
          error={errors.otp}
          inputMode="numeric"
          maxLength={6}
          autoComplete="one-time-code"
          hint={where.delivery_otp_required ? 'Required: the code the receiver was sent' : 'Optional'}
          required={where.delivery_otp_required}
        />
        <div className="space-y-2">
          <p className="text-sm font-medium text-text">Proof of delivery</p>
          <div className="flex flex-wrap items-center gap-3">
            <FileButton accept="image/jpeg,image/png" loading={uploading} onFile={upload}>{photo ? 'Replace photo' : 'Add a photo'}</FileButton>
            {photo && <span className="min-w-0 break-all text-sm text-muted">{photo.name}</span>}
          </div>
          <Textarea
            label="Reason, when there is no photo or code"
            value={reason}
            onChange={e => setReason(e.target.value)}
            maxLength={300}
            hint="Logged with the delivery, for example: the receiver confirmed by phone."
          />
          {errors.proof && <p className="text-xs text-danger" role="alert">{errors.proof}</p>}
        </div>
        {serverError && <Alert tone="danger">{serverError}</Alert>}
      </div>
    </Modal>
  )
}
