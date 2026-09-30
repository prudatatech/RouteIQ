/**
 * Split a consignment into lots (POST /cargo/lots/split): rows of pieces, an optional weight and
 * consignee, and where each lot goes (a new drop, another vehicle or a hub). Live totals show
 * what each lot and the rest that stays here get, and the split can't be sent until they balance.
 */
import { useId, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { Plus, Trash2 } from 'lucide-react'
import { Alert, Button, IconButton, Input, Modal, PlaceSearch, Select, Textarea, statusToLabel } from '@/components/ui'
import { depotsAPI } from '@/services/api'
import type { ResolvedPlace } from '@/services/geocoding'
import { errorMessage, formatKg, formatRupees } from '@/utils/display'
import {
  cargoKeys, lotsAPI, type CargoRef, type Holder, type SplitLotInput, type SplitReason, type WhereIsIt,
} from '@/services/cargo'
import { defaultSplitReason, gstinError, heldPieces, hubName, phoneError, splitBalance, splitReasonsFor, type SplitAvailable } from './lots'
import { useOperatingVehicles } from './useOperatingVehicles'

type Destination = 'drop' | 'vehicle' | 'hub' | 'stay'

interface Row {
  id: string
  pieces: string
  weight_kg: string
  consignee_name: string
  consignee_phone: string
  consignee_gstin: string
  destination: Destination
  place: ResolvedPlace | null
  vehicle_id: string
  depot_id: string
  eway_bill_ref: string
}

type RowErrors = Partial<Record<'place' | 'vehicle_id' | 'depot_id' | 'consignee_phone' | 'consignee_gstin' | 'consignee_name', string>>

let rowSeq = 0
const newRow = (pieces = ''): Row => ({
  id: `lot-${(rowSeq += 1)}`, pieces, weight_kg: '', consignee_name: '', consignee_phone: '', consignee_gstin: '',
  destination: 'drop', place: null, vehicle_id: '', depot_id: '', eway_bill_ref: '',
})

/** Where a lot can go from where the goods are: only goods on a vehicle can be sent to a hub. */
const destinationsFor = (holder: Holder): { id: Destination; label: string }[] => [
  { id: 'drop', label: 'New drop' },
  { id: 'vehicle', label: 'Vehicle' },
  ...(holder === 'vehicle' ? [{ id: 'hub' as const, label: 'Hub' }] : []),
  { id: 'stay', label: 'Stays here' },
]

/** What naming a vehicle does, by where the goods are (the backend's split rules). */
const VEHICLE_HINT: Record<Holder, string> = {
  vehicle: 'A transfer to this vehicle is planned for this lot.',
  hub: 'The lot goes on this vehicle’s trip and leaves the hub with a hub-out.',
  consignor: 'This vehicle is assigned to pick the lot up.',
  consignee: '',
}

const n = (x: number) => x.toLocaleString('en-IN')

function rowErrors(r: Row, reason: SplitReason): RowErrors {
  const e: RowErrors = {}
  if (r.destination === 'drop' && !r.place) e.place = 'Choose the drop address from the suggestions.'
  // The rest after a partial delivery goes to another consignee or place; the same consignee's re-attempt needs no split
  if (reason === 'partial_delivery_remainder' && r.destination !== 'drop' && !r.consignee_name.trim()) {
    e.consignee_name = 'Give this lot a new drop or a consignee.'
  }
  if (r.destination === 'vehicle' && !r.vehicle_id) e.vehicle_id = 'Choose the vehicle.'
  if (r.destination === 'hub' && !r.depot_id) e.depot_id = 'Choose the hub.'
  const phone = phoneError(r.consignee_phone)
  if (phone) e.consignee_phone = phone
  const gstin = gstinError(r.consignee_gstin)
  if (gstin) e.consignee_gstin = gstin
  if ((r.consignee_phone.trim() || r.consignee_gstin.trim()) && !r.consignee_name.trim()) e.consignee_name = 'Enter the consignee’s name.'
  return e
}

function toInput(r: Row): SplitLotInput {
  const weight = r.weight_kg.trim() ? Number(r.weight_kg) : undefined
  return {
    pieces: Number(r.pieces),
    ...(weight != null ? { weight_kg: weight } : {}),
    ...(r.consignee_name.trim() ? { consignee_name: r.consignee_name.trim() } : {}),
    ...(r.consignee_phone.trim() ? { consignee_phone: r.consignee_phone.replace(/[\s-]/g, '') } : {}),
    ...(r.consignee_gstin.trim() ? { consignee_gstin: r.consignee_gstin.trim().toUpperCase() } : {}),
    ...(r.destination === 'drop' && r.place ? { drop: { name: r.place.address.split(', ')[0] || r.place.address, address: r.place.address, lat: r.place.lat, lng: r.place.lng } } : {}),
    ...(r.destination === 'vehicle' ? { to_vehicle_id: r.vehicle_id } : {}),
    ...(r.destination === 'hub' ? { to_depot_id: r.depot_id } : {}),
    ...(r.eway_bill_ref.trim() ? { eway_bill_ref: r.eway_bill_ref.trim() } : {}),
  }
}

/** "on HR55AB1234" / "at Patna" / "with the sender": where the rest stays. */
function herePhrase(w: WhereIsIt): string {
  if (w.current_holder === 'vehicle' && w.vehicle) return `on ${w.vehicle.plate_number}`
  if (w.current_holder === 'hub' && w.depot) return `at ${hubName(w.depot.name)}`
  return 'with the sender'
}

export default function SplitLotsModal({ cargoRef, code, where, figures, onClose }: {
  cargoRef: CargoRef
  code: string
  where: WhereIsIt
  /** Weight, declared value and freight of the goods being split (null when not known). */
  figures: Omit<SplitAvailable, 'pieces'>
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const available: SplitAvailable = { pieces: heldPieces(where.pieces), ...figures }
  const reasons = splitReasonsFor(where)
  const destinations = destinationsFor(where.current_holder)
  const [rows, setRows] = useState<Row[]>(() => [newRow()])
  const [reason, setReason] = useState<SplitReason>(() => defaultSplitReason(where))
  const [note, setNote] = useState('')
  const [attempted, setAttempted] = useState(false)
  const [serverError, setServerError] = useState('')
  const vehicles = useOperatingVehicles()
  const depots = useQuery({ queryKey: ['depots'], queryFn: depotsAPI.list })

  const balance = splitBalance(available, rows)
  const errorsByRow = rows.map(r => rowErrors(r, reason))
  const fieldsOk = errorsByRow.every(e => Object.keys(e).length === 0)
  const here = herePhrase(where)

  const update = (id: string, patch: Partial<Row>) => setRows(rs => rs.map(r => (r.id === id ? { ...r, ...patch } : r)))

  const split = useMutation({
    mutationFn: () => lotsAPI.split({ ref: cargoRef, reason, lots: rows.map(toInput), ...(note.trim() ? { note: note.trim() } : {}) }),
    onSuccess: result => {
      queryClient.invalidateQueries({ queryKey: cargoKeys.all })
      queryClient.invalidateQueries({ queryKey: ['shipments'] })
      const codes = result.lots.map(l => l.tracking_id).filter(Boolean)
      toast.success(codes.length > 0 ? `${code} split into ${codes.join(', ')}` : `${code} split into lots`)
      onClose()
    },
    onError: err => setServerError(errorMessage(err, 'We could not split the shipment. Try again.')),
  })

  const submit = () => {
    setAttempted(true)
    if (!balance.balanced || !fieldsOk) return
    setServerError('')
    split.mutate()
  }

  const vehicleOptions = (vehicles.data ?? [])
    .filter(v => v.id !== where.vehicle?.id)
    .map(v => ({ value: v.id, label: `${v.plate_number}${v.available_capacity_kg != null ? ` · ${formatKg(v.available_capacity_kg)} free` : ''}` }))
  const depotOptions = (depots.data ?? []).filter(d => d.id !== where.depot?.id).map(d => ({ value: d.id, label: d.name }))

  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      onSubmit={submit}
      closeOnBackdrop={false}
      title={`Split ${code} into lots`}
      description={`${n(available.pieces)} ${available.pieces === 1 ? 'piece is' : 'pieces are'} ${here}. Each new lot gets its own code, consignee, POD and invoice; what you don't give to a lot stays ${here} as its own lot.`}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={split.isPending} disabled={!balance.balanced}>
            {balance.lots >= 2 ? `Split into ${n(balance.lots)} lots` : 'Split'}
          </Button>
        </>
      )}
    >
      <div className="space-y-5">
        <ol className="space-y-4" aria-label="New lots">
          {rows.map((r, i) => (
            <LotRow
              key={r.id}
              index={i}
              row={r}
              figures={balance.rows[i]}
              errors={attempted ? errorsByRow[i] : {}}
              showPieceError={attempted || r.pieces.trim() !== ''}
              canRemove={rows.length > 1}
              onChange={patch => update(r.id, patch)}
              onRemove={() => setRows(rs => rs.filter(x => x.id !== r.id))}
              vehicleOptions={vehicleOptions}
              vehiclesLoading={vehicles.isLoading}
              depotOptions={depotOptions}
              depotsLoading={depots.isLoading}
              destinations={destinations}
              vehicleHint={VEHICLE_HINT[where.current_holder]}
            />
          ))}
        </ol>
        <Button
          variant="secondary"
          size="sm"
          icon={<Plus size={14} />}
          onClick={() => setRows(rs => [...rs, newRow(balance.remainder.pieces > 0 ? String(balance.remainder.pieces) : '')])}
        >
          Add a lot
        </Button>

        <Totals available={available} balance={balance} here={here} />

        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Reason"
            value={reason}
            onChange={e => setReason(e.target.value as SplitReason)}
            options={reasons.map(r => ({ value: r, label: statusToLabel(r, 'split_reason') }))}
            hint="Recorded on every lot."
          />
          <Textarea label="Note" value={note} onChange={e => setNote(e.target.value)} maxLength={300} rows={2} hint="Optional, for the custody record." />
        </div>
        {serverError && <Alert tone="danger">{serverError}</Alert>}
      </div>
    </Modal>
  )
}

function LotRow({
  index, row, figures, errors, showPieceError, canRemove, onChange, onRemove, vehicleOptions, vehiclesLoading, depotOptions, depotsLoading,
  destinations, vehicleHint,
}: {
  index: number
  row: Row
  figures: ReturnType<typeof splitBalance>['rows'][number]
  errors: RowErrors
  showPieceError: boolean
  canRemove: boolean
  onChange: (patch: Partial<Row>) => void
  onRemove: () => void
  vehicleOptions: { value: string; label: string }[]
  vehiclesLoading: boolean
  depotOptions: { value: string; label: string }[]
  depotsLoading: boolean
  destinations: { id: Destination; label: string }[]
  vehicleHint: string
}) {
  const groupId = useId()
  const title = `New lot ${index + 1}`
  const weightHint = figures.weight_kg != null && !row.weight_kg.trim() ? `${formatKg(figures.weight_kg)} by pieces` : 'Optional'
  return (
    <li className="space-y-4 rounded-control border border-border p-3 sm:p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-text">{title}</h3>
        <div className="flex min-w-0 items-center gap-3">
          {(figures.declared_value != null || figures.freight != null) && figures.pieces != null && (
            <span className="truncate text-xs text-muted tabular">
              {[figures.declared_value != null ? `Value ${formatRupees(figures.declared_value)}` : null, figures.freight != null ? `Freight ${formatRupees(figures.freight)}` : null].filter(Boolean).join(' · ')}
            </span>
          )}
          {canRemove && <IconButton size="sm" label={`Remove ${title.toLowerCase()}`} icon={<Trash2 size={16} />} onClick={onRemove} />}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Input
          label="Pieces"
          type="number"
          inputMode="numeric"
          min={1}
          required
          value={row.pieces}
          onChange={e => onChange({ pieces: e.target.value })}
          error={showPieceError ? figures.errors.pieces : undefined}
        />
        <Input
          label="Weight"
          type="number"
          inputMode="decimal"
          min={0}
          step="0.1"
          trailing="kg"
          value={row.weight_kg}
          onChange={e => onChange({ weight_kg: e.target.value })}
          error={figures.errors.weight_kg}
          hint={weightHint}
        />
      </div>

      <fieldset className="space-y-3">
        <legend className="mb-2 text-sm font-medium text-text">Where it goes</legend>
        <div role="radiogroup" aria-label={`Where ${title.toLowerCase()} goes`} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {destinations.map(d => (
            <label
              key={d.id}
              className={clsx(
                'flex cursor-pointer items-center justify-center gap-2 rounded-control border px-3 py-2 text-sm transition-colors',
                row.destination === d.id ? 'border-brand bg-brand-soft font-medium text-brand' : 'border-border-strong text-text hover:bg-surface-subtle',
              )}
            >
              <input
                type="radio"
                name={`${groupId}-destination`}
                value={d.id}
                checked={row.destination === d.id}
                onChange={() => onChange({ destination: d.id })}
                className="sr-only"
              />
              {d.label}
            </label>
          ))}
        </div>
        {row.destination === 'drop' && (
          <PlaceSearch
            label="Drop address"
            required
            value={row.place}
            onChange={place => onChange({ place })}
            error={errors.place}
            recentPlacesKey="lot-split"
            placeholder="Where this lot is delivered"
          />
        )}
        {row.destination === 'vehicle' && (
          <Select
            label="Vehicle"
            required
            value={row.vehicle_id}
            onChange={e => onChange({ vehicle_id: e.target.value })}
            placeholder={vehiclesLoading ? 'Loading vehicles…' : vehicleOptions.length === 0 ? 'No vehicle is free' : 'Choose a vehicle'}
            disabled={vehiclesLoading || vehicleOptions.length === 0}
            options={vehicleOptions}
            error={errors.vehicle_id}
            hint={vehicleHint}
          />
        )}
        {row.destination === 'hub' && (
          <Select
            label="Hub"
            required
            value={row.depot_id}
            onChange={e => onChange({ depot_id: e.target.value })}
            placeholder={depotsLoading ? 'Loading hubs…' : 'Choose a hub'}
            disabled={depotsLoading}
            options={depotOptions}
            error={errors.depot_id}
            hint="A transfer to the hub is planned for this lot."
          />
        )}
        {row.destination === 'stay' && <p className="text-sm text-muted">The lot stays where the goods are now, for example to give it its own consignee.</p>}
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-text">Consignee <span className="font-normal text-muted">(optional)</span></legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <Input label="Name" value={row.consignee_name} onChange={e => onChange({ consignee_name: e.target.value })} error={errors.consignee_name} maxLength={200} />
          <Input label="Phone" type="tel" inputMode="tel" value={row.consignee_phone} onChange={e => onChange({ consignee_phone: e.target.value })} error={errors.consignee_phone} maxLength={16} />
          <Input label="GSTIN" value={row.consignee_gstin} onChange={e => onChange({ consignee_gstin: e.target.value })} error={errors.consignee_gstin} maxLength={15} inputClassName="font-mono uppercase" />
        </div>
      </fieldset>

      <Input
        label="E-way bill"
        value={row.eway_bill_ref}
        onChange={e => onChange({ eway_bill_ref: e.target.value })}
        maxLength={60}
        hint="Optional. This lot’s own e-way bill; you can add it later."
        inputClassName="font-mono"
        className="sm:max-w-xs"
      />
    </li>
  )
}

/** The live totals: what the new lots take against what is here, and what stays. */
function Totals({ available, balance, here }: { available: SplitAvailable; balance: ReturnType<typeof splitBalance>; here: string }) {
  const over = balance.allocated > available.pieces
  const rest = balance.remainder
  const line = (label: string, given: string, of: string | null) => (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right tabular text-text">{given}{of && <span className="text-muted"> of {of}</span>}</dd>
    </div>
  )
  const sum = (key: 'declared_value' | 'freight') => balance.rows.reduce((a, r) => a + (r[key] ?? 0), 0)
  return (
    <section aria-label="Totals" aria-live="polite" className="space-y-3 rounded-control border border-border bg-surface-subtle p-3 text-sm sm:p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted">New lots</p>
          <dl className="space-y-1">
            {line('Pieces', n(balance.allocated), n(available.pieces))}
            {available.weight_kg != null && line('Weight', formatKg(balance.weightAllocated ?? 0), formatKg(available.weight_kg))}
            {available.declared_value != null && line('Value', formatRupees(sum('declared_value')), formatRupees(available.declared_value))}
            {available.freight != null && line('Freight', formatRupees(sum('freight')), formatRupees(available.freight))}
          </dl>
        </div>
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted">Stays here <span className="font-normal">({here})</span></p>
          <dl className="space-y-1">
            {line('Pieces', over ? '0' : n(rest.pieces), null)}
            {available.weight_kg != null && line('Weight', formatKg(rest.weight_kg ?? 0), null)}
            {available.declared_value != null && line('Value', formatRupees(rest.declared_value ?? 0), null)}
            {available.freight != null && line('Freight', formatRupees(rest.freight ?? 0), null)}
          </dl>
        </div>
      </div>
      {balance.problems.length > 0
        ? <ul className="space-y-1 text-danger">{balance.problems.map(p => <li key={p}>{p}</li>)}</ul>
        : <p className="text-success">Balanced: {n(balance.lots)} lots, {n(available.pieces)} pieces accounted for.</p>}
      {(available.weight_kg == null || available.declared_value == null) && (
        <p className="text-xs text-muted">{available.weight_kg == null ? 'The weight is not on record, so the server shares it by pieces. ' : ''}{available.declared_value == null ? 'No declared value is on record.' : ''}</p>
      )}
    </section>
  )
}
