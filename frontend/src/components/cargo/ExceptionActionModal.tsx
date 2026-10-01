import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { Truck } from 'lucide-react'
import { Alert, Button, Checkbox, EmptyState, ErrorState, Input, Modal, Select, Skeleton, Textarea } from '@/components/ui'
import { depotsAPI } from '@/services/api'
import { errorMessage, formatKg, formatKm, formatMinutes, formatPieces } from '@/utils/display'
import {
  CLAIM_TYPES, CONDITION_CODES, RESOLUTIONS, cargoKeys, exceptionsAPI, type ClaimType, type ExceptionDetail, type ExceptionType, type ReliefVehicle,
} from '@/services/cargo'
import {
  ACTION_META, CLAIM_TYPE_LABELS, CONDITION_LABELS, RESOLUTION_LABELS, buildAction, consignmentCode, refKey, validateAction, type ActionValues, type PanelAction,
} from './logic'

/** The claim type a case suggests. */
const CLAIM_FOR: Partial<Record<ExceptionType, ClaimType>> = {
  damage: 'damage', shortage: 'shortage', theft: 'theft', vehicle_accident: 'damage', seal_tamper: 'shortage', delay: 'delay', weather: 'damage',
}

/** Local "2026-10-01T09:30" for a datetime-local input, `hours` from now. */
function localInput(hoursFromNow: number): string {
  const d = new Date(Date.now() + hoursFromNow * 3_600_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function initialValues(action: PanelAction, kase: ExceptionDetail, preset: ActionValues): ActionValues {
  const base: ActionValues = {}
  if (action === 'raise_claim') base.claim_type = CLAIM_FOR[kase.type] ?? ''
  if ((action === 'write_off' || action === 'raise_claim') && kase.items.length === 1) base.ref = refKey(kase.items[0])
  if (action === 'write_off') base.pieces = String((kase.items.length === 1 ? kase.items[0].pieces_affected : null) ?? '')
  if (action === 'deliver_with_remarks') base.condition = kase.items.find(i => i.condition && i.condition !== 'good')?.condition ?? ''
  if (action === 'wait_for_repair') base.expected_at = localInput(4)
  if (action === 'reattempt') base.scheduled_for = localInput(24)
  if (action === 'transship' && kase.lat != null && kase.lng != null) {
    base.meet_lat = String(kase.lat)
    base.meet_lng = String(kase.lng)
  }
  return { ...base, ...preset }
}

/** One guided action as a small form: checked here, sent to POST /cargo/exceptions/:id/actions. */
export default function ExceptionActionModal({ kase, action, preset = {}, reliefVehicles, onClose }: {
  kase: ExceptionDetail
  action: PanelAction
  /** Values chosen elsewhere on the page, such as a relief vehicle picked on the map. */
  preset?: ActionValues
  /** The ranked relief vehicles, when the page has already loaded them. */
  reliefVehicles?: { data?: ReliefVehicle[]; isLoading: boolean; isError: boolean; refetch: () => void }
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const meta = ACTION_META[action]
  const [values, setValues] = useState<ActionValues>(() => initialValues(action, kase, preset))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [serverError, setServerError] = useState('')
  const [meetAtVehicle, setMeetAtVehicle] = useState(kase.lat != null && kase.lng != null)
  // Editing a field clears the server's earlier answer, which was about the old values
  const set = (key: string) => (e: { target: { value: string } }) => { setServerError(''); setValues(v => ({ ...v, [key]: e.target.value })) }
  // write_off and raise_claim act on one consignment: the backend needs `ref` when the case has more than one
  const needsRef = kase.items.length > 1
  const picked = kase.items.find(i => refKey(i) === values.ref) ?? (kase.items.length === 1 ? kase.items[0] : undefined)
  const maxPieces = (picked ? picked.pieces_held ?? picked.pieces_affected : null) ?? undefined

  const depots = useQuery({ queryKey: ['depots'], queryFn: depotsAPI.list, enabled: action === 'move_to_hub' })

  const send = useMutation({
    mutationFn: () => {
      const body = buildAction(action, meetAtVehicle ? values : { ...values, meet_lat: '', meet_lng: '' })
      return exceptionsAPI.act(kase.id, body)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: cargoKeys.all })
      toast.success(`${meta.label}: done`)
      onClose()
    },
    onError: err => setServerError(errorMessage(err, `We could not ${meta.label.toLowerCase()}. Try again.`)),
  })

  const submit = () => {
    const next = validateAction(action, values, { maxPieces, needsRef })
    setErrors(next)
    if (Object.keys(next).length > 0) return
    setServerError('')
    send.mutate()
  }

  let body: React.ReactNode = null
  switch (action) {
    case 'transship':
      body = (
        <>
          <ReliefPicker
            relief={reliefVehicles}
            value={values.to_vehicle_id ?? ''}
            onChange={id => setValues(v => ({ ...v, to_vehicle_id: id }))}
            error={errors.to_vehicle_id}
          />
          <Input label="Meeting place" value={values.meet_address ?? ''} onChange={set('meet_address')} error={errors.meet_address} maxLength={200} hint="A safe place both drivers can reach, for example a dhaba or toll plaza" required />
          {kase.lat != null && kase.lng != null && (
            <Checkbox
              checked={meetAtVehicle}
              onChange={e => setMeetAtVehicle(e.target.checked)}
              label="Pin the meeting point where the case was raised"
              description={`${kase.lat.toFixed(5)}, ${kase.lng.toFixed(5)}`}
            />
          )}
        </>
      )
      break
    case 'move_to_hub':
      body = depots.isError
        ? <ErrorState compact title="We could not load the hubs" onRetry={() => depots.refetch()} />
        : (
          <Select
            label="Hub"
            value={values.depot_id ?? ''}
            onChange={set('depot_id')}
            placeholder={depots.isLoading ? 'Loading hubs…' : 'Choose a hub'}
            disabled={depots.isLoading}
            options={(depots.data ?? []).map(d => ({ value: d.id, label: d.name }))}
            error={errors.depot_id}
            hint="A transfer to the hub is planned; the driver drops the goods and the hub counts them in."
            required
          />
        )
      break
    case 'wait_for_repair':
      body = <Input label="Repair expected by" type="datetime-local" value={values.expected_at ?? ''} onChange={set('expected_at')} error={errors.expected_at} hint="The goods stay on the vehicle, on hold, until then." required />
      break
    case 'continue_after_repair':
      body = <p className="text-sm text-text">The hold is released and the vehicle carries on with its trip and the same goods. Only do this once the vehicle is safe to drive.</p>
      break
    case 'return_to_origin':
      body = <p className="text-sm text-text">Goods on a working vehicle start back to the sender now; goods on a broken vehicle or at a hub are flagged for return and go back after their transfer or hub departure. The sender is told. Add a note to the case first if you want to record why.</p>
      break
    case 'reattempt':
      body = <Input label="Try again at" type="datetime-local" value={values.scheduled_for ?? ''} onChange={set('scheduled_for')} error={errors.scheduled_for} required />
      break
    case 'deliver_with_remarks':
      body = (
        <>
          <Input label="Received by" value={values.receiver_name ?? ''} onChange={set('receiver_name')} error={errors.receiver_name} maxLength={200} required data-autofocus />
          <Textarea
            label="Remarks for the proof of delivery"
            value={values.note ?? ''}
            onChange={set('note')}
            error={errors.note}
            maxLength={500}
            hint="For example: 2 cartons with crushed corners, accepted by the receiver. Logged as the proof in place of a photo."
            required
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Condition" value={values.condition ?? ''} onChange={set('condition')} placeholder="As recorded" options={CONDITION_CODES.map(c => ({ value: c, label: CONDITION_LABELS[c] }))} />
            <Input label="Pieces damaged" type="number" inputMode="numeric" min={0} value={values.pieces_damaged ?? ''} onChange={set('pieces_damaged')} hint="Optional" />
          </div>
          <Input label="Delivery OTP" value={values.otp ?? ''} onChange={set('otp')} inputMode="numeric" maxLength={6} autoComplete="one-time-code" hint="Needed when the shipment asks for the delivery code" />
          <p className="text-sm text-muted">Every shipment of the case still waiting to be delivered is recorded as delivered, and the case is resolved.</p>
        </>
      )
      break
    case 'write_off':
      body = (
        <>
          {needsRef && <ConsignmentPicker kase={kase} value={values.ref ?? ''} onChange={set('ref')} error={errors.ref} />}
          <Input label="Pieces to write off" type="number" inputMode="numeric" min={1} max={maxPieces} value={values.pieces ?? ''} onChange={set('pieces')} error={errors.pieces} hint={maxPieces ? `Up to ${maxPieces.toLocaleString('en-IN')}` : undefined} required />
          <Textarea label="Reason" value={values.note ?? ''} onChange={set('note')} error={errors.note} maxLength={500} required />
          <Alert tone="warning">Written-off pieces are marked lost or damaged and leave the shipment’s count. This cannot be undone here.</Alert>
        </>
      )
      break
    case 'raise_claim':
      body = (
        <div className="grid gap-4 sm:grid-cols-2">
          {needsRef && <div className="sm:col-span-2"><ConsignmentPicker kase={kase} value={values.ref ?? ''} onChange={set('ref')} hint="Leave empty to claim for the first shipment of the case." autoFocus /></div>}
          <Select data-autofocus={needsRef ? undefined : true} label="Claim for" value={values.claim_type ?? ''} onChange={set('claim_type')} placeholder="Choose" options={CLAIM_TYPES.map(t => ({ value: t, label: CLAIM_TYPE_LABELS[t] }))} error={errors.claim_type} required />
          <Input label="Amount claimed" type="number" inputMode="decimal" min={0} step="0.01" leading="₹" value={values.claimed_amount ?? ''} onChange={set('claimed_amount')} error={errors.claimed_amount} hint="A claim cannot be more than the goods' declared value. With none on record, the office sets a limit." required />
        </div>
      )
      break
    case 'resolve':
      body = (
        <>
          <Select label="Outcome" value={values.resolution ?? ''} onChange={set('resolution')} placeholder="Choose" options={RESOLUTIONS.map(r => ({ value: r, label: RESOLUTION_LABELS[r] }))} error={errors.resolution} required />
          <Textarea label="How it was settled" value={values.note ?? ''} onChange={set('note')} error={errors.note} maxLength={1000} required />
        </>
      )
      break
    case 'add_note':
      body = <Textarea label="Note" value={values.note ?? ''} onChange={set('note')} error={errors.note} maxLength={2000} rows={4} required data-autofocus />
      break
  }

  return (
    <Modal
      open
      onClose={onClose}
      onSubmit={submit}
      closeOnBackdrop={false}
      size={action === 'transship' ? 'lg' : 'md'}
      title={`${meta.label}: ${kase.code}`}
      description={meta.description}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant={meta.tone === 'danger' ? 'danger' : 'primary'} loading={send.isPending}>{meta.label}</Button>
        </>
      )}
    >
      <div className="space-y-4">
        {body}
        {serverError && <Alert tone="danger">{serverError}</Alert>}
      </div>
    </Modal>
  )
}

/** Which consignment of a case an action is for. */
function ConsignmentPicker({ kase, value, onChange, error, hint, autoFocus }: {
  kase: ExceptionDetail
  value: string
  onChange: (e: { target: { value: string } }) => void
  error?: string
  hint?: string
  autoFocus?: boolean
}) {
  return (
    <Select
      data-autofocus={autoFocus ? true : undefined}
      label="Shipment"
      value={value}
      onChange={onChange}
      placeholder="Choose"
      options={kase.items.map(i => ({ value: refKey(i), label: `${consignmentCode(i)}${i.pieces_held != null ? ` · ${formatPieces(i.pieces_held)} held` : ''}` }))}
      error={error}
      hint={hint}
      required={!hint}
    />
  )
}

/** Relief vehicles ranked by the server (distance, then free space, then cargo types), as radio cards. */
function ReliefPicker({ relief, value, onChange, error }: {
  relief?: { data?: ReliefVehicle[]; isLoading: boolean; isError: boolean; refetch: () => void }
  value: string
  onChange: (id: string) => void
  error?: string
}) {
  if (!relief || relief.isLoading) return <div className="space-y-2"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>
  if (relief.isError) return <ErrorState compact title="We could not load relief vehicles" onRetry={relief.refetch} />
  const list = relief.data ?? []
  if (list.length === 0) {
    return <EmptyState compact icon={<Truck size={22} />} title="No relief vehicle found" description="No operating, approved vehicle with a known position was found. Move the goods to a hub instead, or wait for the repair." />
  }
  return (
    <fieldset aria-describedby={error ? 'relief-error' : undefined}>
      <legend className="mb-2 text-sm font-medium text-text">Relief vehicle <span className="text-danger" aria-hidden="true">*</span></legend>
      <div className="max-h-72 space-y-2 overflow-y-auto">
        {list.map((r, i) => (
          <label
            key={r.vehicle.id}
            className={clsx(
              'flex cursor-pointer items-center gap-3 rounded-control border px-3 py-3 transition-colors focus-within:ring-2 focus-within:ring-brand/30',
              value === r.vehicle.id ? 'border-brand bg-brand-soft' : 'border-border hover:bg-surface-subtle',
            )}
          >
            <input type="radio" name="relief" value={r.vehicle.id} checked={value === r.vehicle.id} onChange={() => onChange(r.vehicle.id)} className="h-4 w-4 shrink-0 accent-brand" />
            <span className="min-w-0 flex-1">
              <span className="block font-mono text-sm font-medium text-text">{i + 1}. {r.vehicle.plate_number}</span>
              <span className="block text-xs text-muted">
                {[`${formatKm(r.distance_km)} away`, r.eta_minutes ? `about ${formatMinutes(r.eta_minutes)}` : null, r.vehicle.driver_name, r.cargo_match ? null : 'different cargo type'].filter(Boolean).join(' · ')}
              </span>
            </span>
            <span className={clsx('shrink-0 text-right text-sm tabular', r.fits ? 'text-text' : 'text-warning')}>
              {formatKg(r.free_kg)} free
              {!r.fits && <span className="block text-xs">Not enough space</span>}
            </span>
          </label>
        ))}
      </div>
      {error && <p id="relief-error" className="mt-1.5 text-xs text-danger" role="alert">{error}</p>}
    </fieldset>
  )
}
