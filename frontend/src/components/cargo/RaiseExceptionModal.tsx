import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Search } from 'lucide-react'
import { Alert, Button, Input, Modal, Select, Textarea } from '@/components/ui'
import { errorMessage } from '@/utils/display'
import {
  CONDITION_CODES, EXCEPTION_TYPES, SEVERITIES, cargoKeys, custodyAPI, exceptionsAPI,
  type CargoException, type CargoRef, type ConditionCode, type ExceptionType, type Severity, type WhereIsIt,
} from '@/services/cargo'
import { CONDITION_LABELS, EXCEPTION_TYPE_LABELS, SEVERITY_LABELS, SLA_HOURS, onBoardCount, positionOf, refOf } from './logic'

/** A consignment already known to the caller (the shipment drawer), so staff do not type its code. */
export interface KnownConsignment {
  ref: CargoRef
  code: string
  where?: WhereIsIt | null
}

interface Found { ref: CargoRef; code: string; where: WhereIsIt }

/**
 * Raise a case by hand (POST /cargo/exceptions). From the Cargo page staff type the consignment's
 * code; from a shipment it is filled in. On success it opens the new case unless `onRaised` is given.
 */
export default function RaiseExceptionModal({ open, onClose, consignment, defaultType, onRaised }: {
  open: boolean
  onClose: () => void
  consignment?: KnownConsignment
  defaultType?: ExceptionType
  onRaised?: (created: CargoException) => void
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [type, setType] = useState<ExceptionType | ''>(defaultType ?? '')
  const [severity, setSeverity] = useState<Severity>('medium')
  const [description, setDescription] = useState('')
  const [code, setCode] = useState('')
  const [found, setFound] = useState<Found | null>(null)
  const [looking, setLooking] = useState(false)
  const [pieces, setPieces] = useState('')
  const [condition, setCondition] = useState<ConditionCode>('good')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [serverError, setServerError] = useState('')

  const target: Found | null = consignment?.where
    ? { ref: consignment.ref, code: consignment.code, where: consignment.where }
    : found
  const knownRef = consignment?.ref ?? found?.ref ?? null
  const maxPieces = target ? (target.where.pieces.total ?? onBoardCount(target.where.pieces)) || null : null

  const lookUp = async () => {
    const value = code.trim().toUpperCase()
    if (!value) { setErrors(e => ({ ...e, code: 'Enter the tracking ID (RTX-…) or load code (CM-…).' })); return }
    setLooking(true)
    try {
      const where = await custodyAPI.where(value)
      const ref = refOf(where.ref)
      if (!ref) throw new Error('That code did not match a shipment or a vendor load.')
      setFound({ ref, code: value, where })
      setErrors(e => { const next = { ...e }; delete next.code; return next })
      if (!pieces && where.pieces.total) setPieces(String(onBoardCount(where.pieces) || where.pieces.total))
    } catch (err) {
      setFound(null)
      setErrors(e => ({ ...e, code: errorMessage(err, 'We could not find that shipment. Check the code.') }))
    } finally {
      setLooking(false)
    }
  }

  const raise = useMutation({
    mutationFn: exceptionsAPI.raise,
    onSuccess: created => {
      queryClient.invalidateQueries({ queryKey: cargoKeys.all })
      toast.success(created.code ? `Case ${created.code} opened` : 'Case opened')
      onClose()
      if (onRaised) onRaised(created)
      else if (created.id) navigate(`/cargo/exceptions/${created.id}`)
    },
    onError: err => setServerError(errorMessage(err, 'We could not open the case. Try again.')),
  })

  const submit = () => {
    const next: Record<string, string> = {}
    if (!type) next.type = 'Choose what happened.'
    if (!description.trim()) next.description = 'Describe what happened and what was seen.'
    if (!knownRef) next.code = next.code ?? 'Find the shipment first.'
    const n = Number(pieces)
    if (!pieces) next.pieces = 'Enter how many pieces are affected.'
    else if (!Number.isInteger(n) || n < 0) next.pieces = 'Enter a whole number.'
    else if (maxPieces != null && n > maxPieces) next.pieces = `The shipment has ${maxPieces.toLocaleString('en-IN')} pieces.`
    setErrors(next)
    if (Object.keys(next).length > 0 || !knownRef || !type) return
    setServerError('')
    const vehicle = target?.where.vehicle ?? null
    const position = positionOf(vehicle)
    raise.mutate({
      type,
      severity,
      description: description.trim(),
      items: [{ ref: knownRef, pieces_affected: n, condition }],
      ...(vehicle?.id ? { vehicle_id: vehicle.id } : {}),
      ...(position ? { lat: position.lat, lng: position.lng } : {}),
    })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      onSubmit={submit}
      closeOnBackdrop={false}
      title="Raise a problem"
      description={consignment ? `For ${consignment.code}. The case gets an owner and a deadline.` : 'Open a case for a problem with a shipment. It gets an owner and a deadline.'}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={raise.isPending} disabled={looking}>Open case</Button>
        </>
      )}
    >
      <div className="space-y-4">
        {!consignment && (
          <div className="flex items-start gap-2">
            <Input
              className="flex-1"
              label="Shipment"
              placeholder="RTX-… or CM-…"
              value={code}
              onChange={e => { setCode(e.target.value); setFound(null) }}
              onBlur={() => { if (code.trim() && !found) lookUp() }}
              error={errors.code}
              hint={found ? `${found.where.status.replace(/_/g, ' ')}${found.where.vehicle ? ` on ${found.where.vehicle.plate_number}` : ''}` : 'The tracking ID of a shipment or the code of a vendor load'}
              required
              data-autofocus
            />
            <Button variant="secondary" className="mt-7" icon={<Search size={16} />} loading={looking} onClick={lookUp}>Find</Button>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Type"
            value={type}
            onChange={e => setType(e.target.value as ExceptionType)}
            placeholder="Choose"
            options={EXCEPTION_TYPES.map(t => ({ value: t, label: EXCEPTION_TYPE_LABELS[t] }))}
            error={errors.type}
            required
          />
          <Select
            label="Severity"
            value={severity}
            onChange={e => setSeverity(e.target.value as Severity)}
            options={SEVERITIES.map(s => ({ value: s, label: `${SEVERITY_LABELS[s]} (act within ${SLA_HOURS[s]} h)` }))}
            required
          />
          <Input
            label="Pieces affected"
            type="number"
            inputMode="numeric"
            min={0}
            max={maxPieces ?? undefined}
            value={pieces}
            onChange={e => setPieces(e.target.value)}
            error={errors.pieces}
            hint={maxPieces != null ? `Of ${maxPieces.toLocaleString('en-IN')}` : undefined}
            required
          />
          <Select
            label="Condition"
            value={condition}
            onChange={e => setCondition(e.target.value as ConditionCode)}
            options={CONDITION_CODES.map(c => ({ value: c, label: CONDITION_LABELS[c] }))}
            required
          />
        </div>
        <Textarea
          label="Description"
          value={description}
          onChange={e => setDescription(e.target.value)}
          maxLength={1000}
          error={errors.description}
          hint="Where, what was seen, who was told"
          required
        />
        {serverError && <Alert tone="danger">{serverError}</Alert>}
      </div>
    </Modal>
  )
}
