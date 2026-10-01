import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCheck, FileText, Fuel, Paperclip, Plus, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { fleetAPI } from '@/services/api'
import {
  Alert, Button, Card, Checkbox, DataTable, FileButton, IconButton, Input, Modal, SectionHeader, Select, Skeleton, Stat, StatusPill, useConfirm,
  type Column,
} from '@/components/ui'
import { ChartCard, SimpleLineChart } from '@/components/analytics/charts'
import { apiErrorMessage } from '@/components/fleet/health'
import { formatDateTime, formatDay, formatRupees, serverFieldError } from '@/utils/display'
import {
  BILL_TYPES, FLAG_HINTS, FLAG_LABELS, MAX_BILL_BYTES, PAYMENT_LABELS, deriveAmounts, flagTone, formatKmpl, fuelAPI, fuelKeys,
  openBill, sendableAmounts, uploadBill,
  type AmountField, type AmountValues, type FuelLog, type PaymentMode,
} from './fuel'

/** A datetime-local value for now, in the browser's own time zone. */
const nowLocal = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16)

const blankAmounts: AmountValues = { litres: '', price: '', total: '' }
const AMOUNT_LABELS: Record<AmountField, string> = { litres: 'Litres', price: 'Price per litre', total: 'Total amount' }

/** Fuel efficiency, this month's spend, the fill-up log and a form to add a fill-up, for one vehicle. */
export default function VehicleFuelTab({ vehicleId }: { vehicleId: string }) {
  const { confirm } = useConfirm()
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)

  const stats = useQuery({ queryKey: fuelKeys.stats(vehicleId), queryFn: () => fuelAPI.stats(vehicleId) })
  const logs = useQuery({ queryKey: fuelKeys.logs(vehicleId), queryFn: () => fuelAPI.logs(vehicleId) })

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: fuelKeys.logs(vehicleId) })
    queryClient.invalidateQueries({ queryKey: fuelKeys.stats(vehicleId) })
    // A fill can change the stored km per litre and litres in the tank
    queryClient.invalidateQueries({ queryKey: ['vehicles'] })
  }

  const review = useMutation({
    mutationFn: (log: FuelLog) => fuelAPI.markReviewed(log.id, !log.reviewed_at),
    onSuccess: (log) => { toast.success(log.reviewed_at ? 'Marked as reviewed' : 'Moved back to review'); refresh() },
    onError: err => toast.error(apiErrorMessage(err, 'We could not update this entry. Try again.')),
  })
  const remove = useMutation({
    mutationFn: (log: FuelLog) => fuelAPI.remove(log.id),
    onSuccess: () => { toast.success('Fuel entry deleted'); refresh() },
    onError: err => toast.error(apiErrorMessage(err, 'We could not delete this entry. Try again.')),
  })

  const onDelete = async (log: FuelLog) => {
    const ok = await confirm({
      title: 'Delete this fuel entry?',
      message: 'Its expense and bill are removed too, and mileage is worked out again without it.',
      confirmLabel: 'Delete entry',
      tone: 'danger',
    })
    if (ok) remove.mutate(log)
  }

  const onOpenBill = (log: FuelLog) => openBill(log.id).catch(err => toast.error(apiErrorMessage(err, 'We could not open the bill. Try again.')))

  const columns: Column<FuelLog>[] = [
    {
      key: 'date', header: 'Date', sortValue: l => Date.parse(l.filled_at),
      cell: l => (
        <div>
          <p className="text-text">{formatDateTime(l.filled_at)}</p>
          {(l.station_name || !l.is_full_tank) && (
            <p className="text-xs text-muted">{[l.station_name, l.is_full_tank ? null : 'Partial fill'].filter(Boolean).join(' · ')}</p>
          )}
        </div>
      ),
    },
    {
      key: 'litres', header: 'Litres', align: 'right', sortValue: l => l.litres,
      cell: l => <span className="tabular">{l.litres.toLocaleString('en-IN')} L</span>,
    },
    {
      key: 'amount', header: 'Amount', align: 'right', sortValue: l => l.total_amount,
      cell: l => (
        <div>
          <p className="tabular text-text">{formatRupees(l.total_amount)}</p>
          <p className="text-xs text-muted">{formatRupees(l.price_per_litre)}/L · {PAYMENT_LABELS[l.payment_mode]}</p>
        </div>
      ),
    },
    {
      key: 'odo', header: 'Odometer', align: 'right', hideBelow: 'md', sortValue: l => l.odometer_km,
      cell: l => (l.odometer_km == null ? '—' : <span className="tabular">{Math.round(l.odometer_km).toLocaleString('en-IN')} km</span>),
    },
    {
      key: 'kmpl', header: 'Mileage', align: 'right', sortValue: l => l.mileage_kmpl,
      cell: l => (
        <div>
          <p className="tabular text-text">{formatKmpl(l.mileage_kmpl)}</p>
          {l.distance_km != null && <p className="text-xs text-muted">{Math.round(l.distance_km).toLocaleString('en-IN')} km</p>}
        </div>
      ),
    },
    {
      key: 'flags', header: 'Bill and checks',
      cell: l => (
        <div className="flex flex-wrap items-center gap-1.5">
          {l.bill_status === 'with_bill'
            ? <StatusPill tone="success" dot={false}>Bill verified</StatusPill>
            : null}
          {l.flags.map(f => (
            <span key={f} title={FLAG_HINTS[f]}>
              <StatusPill tone={l.reviewed_at ? 'neutral' : flagTone(f)} dot={false}>{FLAG_LABELS[f]}</StatusPill>
            </span>
          ))}
          {l.reviewed_at && l.flags.length > 0 && <span className="text-xs text-muted">Reviewed</span>}
        </div>
      ),
    },
    {
      key: 'actions', header: <span className="sr-only">Actions</span>, align: 'right',
      cell: l => (
        <div className="flex items-center justify-end gap-1">
          {l.bill_path && <IconButton label="View bill" onClick={() => onOpenBill(l)} icon={<FileText size={16} />} />}
          {l.flags.length > 0 && (
            <IconButton label={l.reviewed_at ? 'Move back to review' : 'Mark as reviewed'} onClick={() => review.mutate(l)} icon={<CheckCheck size={16} />} />
          )}
          <IconButton label="Delete entry" onClick={() => onDelete(l)} icon={<Trash2 size={16} />} />
        </div>
      ),
    },
  ]

  const s = stats.data
  const toReview = (logs.data ?? []).filter(l => l.flags.length > 0 && !l.reviewed_at).length
  const trend = (s?.trend ?? []).map(t => ({ day: formatDay(t.date), kmpl: t.kmpl }))

  return (
    <section aria-label="Fuel" className="space-y-4">
      <SectionHeader
        title="Fuel log"
        description="Fill-ups, mileage and spend for this vehicle"
        actions={<Button size="sm" icon={<Plus size={16} />} onClick={() => setAdding(true)}>Add fuel</Button>}
      />

      {stats.isError && (
        <Alert tone="danger" title="We could not load fuel figures" action={<Button size="sm" variant="secondary" onClick={() => stats.refetch()}>Try again</Button>}>
          Check your connection and try again.
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Average mileage" value={formatKmpl(s?.rolling_avg_kmpl)} loading={stats.isLoading} hint="Last 5 stretches between full tanks" />
        <Stat label="Last fill mileage" value={formatKmpl(s?.last_kmpl)} loading={stats.isLoading} hint={s?.last_kmpl == null ? 'Needs two full-tank fills with odometer' : undefined} />
        <Stat label="Cost per km" value={s?.cost_per_km == null ? '—' : `${formatRupees(s.cost_per_km)}/km`} loading={stats.isLoading} />
        <Stat
          label="Spent this month"
          value={formatRupees(s?.month_spend ?? 0)}
          loading={stats.isLoading}
          hint={s ? `${s.month_litres.toLocaleString('en-IN')} L in ${s.month_fills} fill${s.month_fills === 1 ? '' : 's'}` : undefined}
        />
      </div>

      {adding && <AddFuelForm vehicleId={vehicleId} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); refresh() }} />}

      <ChartCard
        title="Mileage trend"
        description="Km per litre for each stretch between two full tanks"
        loading={stats.isLoading}
        error={stats.isError}
        onRetry={() => stats.refetch()}
        empty={trend.length === 0}
        emptyTitle="No mileage yet"
        emptyDescription="Log two full-tank fills with the odometer reading and mileage appears here."
        height="h-48"
      >
        <SimpleLineChart data={trend} categoryKey="day" series={{ key: 'kmpl', label: 'km/l' }} formatValue={n => formatKmpl(n)} label="Mileage per stretch between full tanks, oldest to newest" />
      </ChartCard>

      {toReview > 0 && (
        <Alert tone="warning" title={`${toReview} fill${toReview === 1 ? '' : 's'} to review`}>
          These have no bill or look unusual. Check them, then mark them as reviewed.
        </Alert>
      )}

      <Card>
        {logs.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <DataTable
            caption="Fuel fill-ups, newest first"
            columns={columns}
            rows={logs.data ?? []}
            rowKey={l => l.id}
            error={logs.isError ? 'We could not load the fuel log.' : undefined}
            onRetry={() => logs.refetch()}
            pageSize={10}
            initialSort={{ key: 'date', direction: 'desc' }}
            empty={{ icon: <Fuel size={20} />, title: 'No fuel logged yet', description: 'Add a fill-up, with or without a bill.' }}
          />
        )}
      </Card>
    </section>
  )
}

function AddFuelForm({ vehicleId, onClose, onSaved }: { vehicleId: string; onClose: () => void; onSaved: () => void }) {
  const [amounts, setAmounts] = useState<AmountValues>(blankAmounts)
  const [edited, setEdited] = useState<AmountField[]>([])
  const [filledAt, setFilledAt] = useState(nowLocal)
  const [odometer, setOdometer] = useState<string | null>(null)
  const [fullTank, setFullTank] = useState(true)
  const [station, setStation] = useState('')
  const [payment, setPayment] = useState<PaymentMode>('cash')
  const [hasBill, setHasBill] = useState(false)
  const [bill, setBill] = useState<File | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState('')
  const odometerRef = useRef<HTMLInputElement>(null)

  // The vehicle's own odometer prefills the reading; it shares its cache with the health panel
  const health = useQuery({ queryKey: ['fleet-vehicle-health', vehicleId], queryFn: () => fleetAPI.vehicleHealth(vehicleId) as Promise<{ odometer_km: number | null }> })
  const vehicleOdo = health.data?.odometer_km != null ? String(Math.round(Number(health.data.odometer_km))) : ''
  const odometerValue = odometer ?? vehicleOdo

  const setAmount = (field: AmountField, value: string) => {
    const nextEdited = [...edited.filter(f => f !== field), field].slice(-2)
    setEdited(nextEdited)
    setAmounts(deriveAmounts({ ...amounts, [field]: value }, nextEdited))
  }

  const save = useMutation({
    mutationFn: async () => {
      const figures = sendableAmounts(amounts, edited)
      if (!figures) throw new Error('Enter any two of litres, price and total')
      const billPath = hasBill && bill ? await uploadBill(vehicleId, bill) : null
      return fuelAPI.create(vehicleId, {
        ...figures,
        filled_at: new Date(filledAt).toISOString(),
        odometer_km: odometerValue.trim() === '' ? null : Number(odometerValue),
        is_full_tank: fullTank,
        station_name: station.trim() || null,
        payment_mode: payment,
        bill_path: billPath,
      })
    },
    onSuccess: log => {
      toast.success(log.bill_status === 'with_bill' ? 'Fuel logged with bill' : 'Fuel logged without a bill. It will be shown for review.')
      onSaved()
    },
    onError: err => {
      // A problem with the reading belongs on the Odometer field, which takes the focus
      const field = serverFieldError(err)
      if (field?.field === 'odometer_km') {
        setErrors(e => ({ ...e, odometer: field.message }))
        odometerRef.current?.focus()
        return
      }
      setFormError(apiErrorMessage(err, err instanceof Error && !('response' in err) ? err.message : 'We could not save this fill-up. Try again.'))
    },
  })

  const submit = () => {
    const next: Record<string, string> = {}
    if (!sendableAmounts(amounts, edited)) next.amounts = 'Enter any two of litres, price per litre and total amount'
    if (!filledAt) next.filledAt = 'Choose the date and time of the fill'
    else if (new Date(filledAt).getTime() > Date.now() + 5 * 60_000) next.filledAt = 'The fill cannot be in the future'
    if (odometerValue.trim() !== '' && !(Number(odometerValue) >= 0)) next.odometer = 'Enter the odometer reading in km'
    if (hasBill && !bill) next.bill = 'Attach the bill, or switch off "I have the bill"'
    if (bill && !BILL_TYPES.includes(bill.type)) next.bill = 'Upload a PDF, JPG or PNG file'
    else if (bill && bill.size > MAX_BILL_BYTES) next.bill = 'The bill must be 5 MB or smaller'
    setErrors(next)
    setFormError('')
    if (Object.keys(next).length === 0) save.mutate()
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title="Add fuel"
      description="Enter any two of litres, price per litre and total. The third is worked out."
      onSubmit={submit}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button type="submit" loading={save.isPending}>Save fill-up</Button>
        </>
      )}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {(['litres', 'price', 'total'] as const).map(f => (
          <Input
            key={f}
            label={AMOUNT_LABELS[f]}
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            leading={f === 'litres' ? undefined : '₹'}
            trailing={f === 'litres' ? 'L' : undefined}
            value={amounts[f]}
            onChange={e => setAmount(f, e.target.value)}
            error={f === 'litres' ? errors.amounts : undefined}
            className={f === 'total' ? 'sm:col-span-2' : undefined}
          />
        ))}
        <Input label="Date and time" required type="datetime-local" max={nowLocal()} value={filledAt} onChange={e => setFilledAt(e.target.value)} error={errors.filledAt} />
        <Input
          label="Odometer"
          type="number"
          inputMode="numeric"
          min="0"
          trailing="km"
          hint={odometer == null && vehicleOdo ? 'Filled in from the vehicle. Change it to the dashboard reading.' : undefined}
          ref={odometerRef}
          value={odometerValue}
          onChange={e => { setOdometer(e.target.value); setErrors(er => ({ ...er, odometer: '' })) }}
          error={errors.odometer}
        />
        <Input label="Station or place" maxLength={120} value={station} onChange={e => setStation(e.target.value)} hint="Optional" />
        <Select
          label="Paid by"
          value={payment}
          onChange={e => setPayment(e.target.value as PaymentMode)}
          options={(Object.keys(PAYMENT_LABELS) as PaymentMode[]).map(m => ({ value: m, label: PAYMENT_LABELS[m] }))}
        />
        <Checkbox
          className="sm:col-span-2"
          label="Tank filled to the top"
          description="Mileage is worked out from one full tank to the next. Leave this off for a part fill."
          checked={fullTank}
          onChange={e => setFullTank(e.target.checked)}
        />
        <div className="space-y-2 sm:col-span-2">
          <Checkbox
            label="I have the bill"
            description={hasBill ? undefined : 'Without a bill the fill is saved but flagged "No bill" and shown for review.'}
            checked={hasBill}
            onChange={e => { setHasBill(e.target.checked); if (!e.target.checked) setBill(null) }}
          />
          {hasBill && (
            <div className="space-y-1 pl-7">
              <div className="flex flex-wrap items-center gap-3">
                <FileButton accept={BILL_TYPES.join(',')} icon={<Paperclip size={16} />} onFile={setBill} size="sm">
                  {bill ? 'Replace bill' : 'Attach bill'}
                </FileButton>
                {bill && <span className="min-w-0 truncate text-sm text-muted">{bill.name}</span>}
              </div>
              {errors.bill
                ? <p role="alert" className="text-xs text-danger">{errors.bill}</p>
                : <p className="text-xs text-muted">Photo or PDF, up to 5 MB.</p>}
            </div>
          )}
        </div>
        {formError && <p className="text-sm text-danger sm:col-span-2" role="alert">{formError}</p>}
      </div>
    </Modal>
  )
}
