import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, BadgeIndianRupee, CheckCheck, Plus, SlidersHorizontal, Trash2, WalletCards } from 'lucide-react'
import toast from 'react-hot-toast'
import {
  Alert, BulkActionBar, Button, DataTable, DateRangeControl, IconButton, Input, Modal, Select, SectionHeader, Stat, StatusPill, Textarea,
  presetRange, todayIST, useConfirm, useRowSelection, type Column, type DateRangeValue,
} from '@/components/ui'
import { errorMessage, formatDate, formatRupees } from '@/utils/display'
import {
  KM_SOURCE_LABEL, METHOD_LABEL, PAY_VEHICLE_TYPES, STATUS_LABEL, STATUS_TONE, canApprove, canChange, canPay, payoutSummary, tripRef,
  typeLabel, type PayEntry, type PayRate, type PayoutMethod,
} from './driverPay'
import { driverPayAPI } from './driverPayApi'

const KEY = ['driver-pay'] as const
const STATUS_OPTIONS = [
  { value: '', label: 'All states' },
  { value: 'earned', label: STATUS_LABEL.earned },
  { value: 'approved', label: STATUS_LABEL.approved },
  { value: 'paid', label: STATUS_LABEL.paid },
  { value: 'void', label: STATUS_LABEL.void },
]

/**
 * Driver pay: what each vehicle type pays per trip and per km, what drivers earned on each trip,
 * approval, corrections, and paying a driver (cash, bank or UPI, outside the app).
 * Self-contained: the Money section shows it as a tab, and it also has its own page at /money/driver-pay.
 */
export default function DriverPayTab() {
  const queryClient = useQueryClient()
  const [range, setRange] = useState<DateRangeValue>({ preset: '30d', ...presetRange('30d') })
  const [status, setStatus] = useState('')
  const [driverId, setDriverId] = useState('')
  const [rateFor, setRateFor] = useState<string | null>(null)
  const [adjusting, setAdjusting] = useState<PayEntry | null>(null)
  const [voiding, setVoiding] = useState<PayEntry | null>(null)
  const [paying, setPaying] = useState(false)

  const rates = useQuery({ queryKey: [...KEY, 'rates'], queryFn: () => driverPayAPI.rates(true) })
  const list = useQuery({
    queryKey: [...KEY, 'entries', range.from, range.to, status],
    queryFn: () => driverPayAPI.entries({ from: range.from, to: range.to, status: status || undefined }),
  })

  const drivers = useMemo(() => {
    const seen = new Map<string, string>()
    for (const e of list.data?.entries ?? []) seen.set(e.driver_id, e.driver_name ?? 'Unnamed driver')
    return [...seen].sort((a, b) => a[1].localeCompare(b[1]))
  }, [list.data])
  const rows = useMemo(() => (list.data?.entries ?? []).filter(e => !driverId || e.driver_id === driverId), [list.data, driverId])
  const selection = useRowSelection(rows, (e: PayEntry) => e.id)
  const toApprove = selection.selectedRows.filter(canApprove)
  const toPay = selection.selectedRows.filter(canPay)
  const payTotals = payoutSummary(toPay)

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: KEY })
    selection.clear()
  }

  const approve = useMutation({
    mutationFn: (ids: string[]) => driverPayAPI.approve(ids),
    onSuccess: r => {
      if (r.approved.length) toast.success(`${r.approved.length} ${r.approved.length === 1 ? 'trip' : 'trips'} approved`)
      if (r.skipped.length) toast.error(`${r.skipped.length} skipped: ${r.skipped[0].reason}`)
      refresh()
    },
    onError: err => toast.error(errorMessage(err, 'We could not approve these trips. Try again.')),
  })

  const missing = list.data?.rate_missing_types ?? []
  const totals = list.data?.totals
  const filtered = !!(status || driverId)

  const columns: Column<PayEntry>[] = [
    { key: 'date', header: 'Trip date', sortValue: e => e.trip_date, cell: e => formatDate(e.trip_date) },
    {
      key: 'driver', header: 'Driver', sortValue: e => e.driver_name ?? '',
      cell: e => (
        <Link to={`/admin/users/${e.driver_id}`} className="font-medium text-brand hover:underline" onClick={ev => ev.stopPropagation()}>
          {e.driver_name ?? 'Unnamed driver'}
        </Link>
      ),
    },
    {
      key: 'trip', header: 'Trip', hideBelow: 'md',
      cell: e => {
        const id = e.route_id ?? e.manifest_id
        return (
          <div>
            {id ? <Link to={`/routes/${id}`} className="font-mono text-sm text-brand hover:underline" onClick={ev => ev.stopPropagation()}>{tripRef(e)}</Link> : <span className="text-muted">{tripRef(e)}</span>}
            <p className="text-xs text-muted">{[typeLabel(e.vehicle_type), e.plate_number].filter(Boolean).join(' · ')}</p>
          </div>
        )
      },
    },
    {
      key: 'km', header: 'Distance', align: 'right', hideBelow: 'lg', sortValue: e => e.km,
      cell: e => (
        <div>
          <span className="tabular">{e.km.toLocaleString('en-IN', { maximumFractionDigits: 1 })} km</span>
          <p className="text-xs text-muted">{KM_SOURCE_LABEL[e.km_source]}</p>
        </div>
      ),
    },
    {
      key: 'amount', header: 'Pay', align: 'right', sortValue: e => e.amount,
      cell: e => (
        <div>
          <span className="tabular font-medium">{formatRupees(e.amount)}</span>
          {e.rate_missing
            ? <p className="text-xs text-warning">No rate set for {e.vehicle_type ?? 'this type'}</p>
            : <p className="text-xs text-muted">
              {formatRupees(e.per_trip_amount)} + {formatRupees(e.per_km_amount)}/km
              {e.adjustments.length > 0 && ` · ${e.adjustments.length} ${e.adjustments.length === 1 ? 'adjustment' : 'adjustments'}`}
            </p>}
        </div>
      ),
    },
    {
      key: 'status', header: 'State', sortValue: e => e.status,
      cell: e => (
        <div>
          <StatusPill tone={STATUS_TONE[e.status]}>{STATUS_LABEL[e.status]}</StatusPill>
          {e.status === 'paid' && e.paid_at && <p className="mt-0.5 text-xs text-muted">on {formatDate(e.paid_at)}</p>}
          {e.status === 'void' && e.void_reason && <p className="mt-0.5 text-xs text-muted line-clamp-1">{e.void_reason}</p>}
        </div>
      ),
    },
    {
      key: 'actions', header: <span className="sr-only">Actions</span>, align: 'right', width: 'w-24',
      cell: e => canChange(e) && (
        <div className="flex justify-end gap-1">
          <IconButton label="Adjust pay" size="sm" icon={<SlidersHorizontal size={16} />} onClick={ev => { ev.stopPropagation(); setAdjusting(e) }} />
          <IconButton label="Void this trip's pay" size="sm" icon={<Trash2 size={16} />} onClick={ev => { ev.stopPropagation(); setVoiding(e) }} />
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-8">
      {missing.length > 0 && (
        <Alert
          tone="warning"
          title={`Set a pay rate for ${missing.map(typeLabel).join(', ').toLowerCase()}`}
          action={<Button variant="secondary" size="sm" onClick={() => setRateFor(missing[0])}>Set rate</Button>}
        >
          Trips on {missing.length === 1 ? 'this vehicle type' : 'these vehicle types'} finished with no rate, so they are at ₹0 for now. Set the rate and they are priced automatically.
        </Alert>
      )}

      <RatesSection rates={rates.data} loading={rates.isLoading} error={!!rates.error} onRetry={() => rates.refetch()} onSet={setRateFor} />

      <section className="space-y-4">
        <SectionHeader title="Trips" description="Each finished trip earns the driver a fixed amount plus the km rate. Approve trips, then pay the driver." />
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <DateRangeControl value={range} onChange={setRange} />
          <Select label="Driver" hideLabel className="sm:w-56" value={driverId} onChange={e => setDriverId(e.target.value)}
            options={[{ value: '', label: 'All drivers' }, ...drivers.map(([id, name]) => ({ value: id, label: name }))]} />
          <Select label="State" hideLabel className="sm:w-48" value={status} onChange={e => setStatus(e.target.value)} options={STATUS_OPTIONS} />
          {filtered && <Button variant="ghost" onClick={() => { setStatus(''); setDriverId('') }}>Clear filters</Button>}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat label="Awaiting approval" tone="warning" loading={list.isLoading} value={formatRupees(totals?.earned ?? 0)} />
          <Stat label="Approved, to pay" loading={list.isLoading} value={formatRupees(totals?.approved ?? 0)} />
          <Stat label="Paid" tone="success" loading={list.isLoading} value={formatRupees(totals?.paid ?? 0)} />
        </div>
        {list.data?.truncated && <Alert tone="info">Showing the latest 500 trips. Narrow the dates to see the rest.</Alert>}

        <DataTable
          caption="Driver pay per trip"
          columns={columns}
          rows={rows}
          rowKey={e => e.id}
          loading={list.isLoading}
          error={list.error ? 'We could not load driver pay. Check your connection and try again.' : undefined}
          onRetry={() => list.refetch()}
          initialSort={{ key: 'date', direction: 'desc' }}
          selection={{
            selectedKeys: selection.selectedKeys,
            onToggleRow: key => selection.toggleRow(key),
            onToggleAll: (pageRows, checked) => selection.toggleAll(pageRows, checked),
            isRowSelectable: e => canApprove(e) || canPay(e),
          }}
          empty={filtered
            ? { title: 'No trips match these filters', action: <Button variant="secondary" onClick={() => { setStatus(''); setDriverId('') }}>Clear filters</Button> }
            : { title: 'No trips in these dates', description: 'A trip appears here when a driver finishes it.' }}
        />
      </section>

      <BulkActionBar count={selection.count} onClear={selection.clear}>
        {toApprove.length > 0 && (
          <Button size="sm" variant="secondary" icon={<CheckCheck size={16} />} loading={approve.isPending} onClick={() => approve.mutate(toApprove.map(e => e.id))}>
            Approve {toApprove.length}
          </Button>
        )}
        {toPay.length > 0 && (
          <Button size="sm" icon={<WalletCards size={16} />} disabled={!payTotals.single} onClick={() => setPaying(true)}
            title={payTotals.single ? undefined : 'Pay one driver at a time'}>
            {payTotals.single ? `Pay driver ${formatRupees(payTotals.total)}` : 'Pay one driver at a time'}
          </Button>
        )}
      </BulkActionBar>

      <RateModal
        open={rateFor !== null}
        type={rateFor ?? 'truck'}
        current={rates.data}
        onClose={() => setRateFor(null)}
        onSaved={() => { setRateFor(null); refresh() }}
      />
      {adjusting && <AdjustModal entry={adjusting} onClose={() => setAdjusting(null)} onDone={() => { setAdjusting(null); refresh() }} />}
      {voiding && <VoidModal entry={voiding} onClose={() => setVoiding(null)} onDone={() => { setVoiding(null); refresh() }} />}
      {paying && toPay.length > 0 && payTotals.single && (
        <PayoutModal entries={toPay} onClose={() => setPaying(false)} onDone={() => { setPaying(false); refresh() }} />
      )}
    </div>
  )
}

// ── Rates ───────────────────────────────────────────────────

function RatesSection({ rates, loading, error, onRetry, onSet }: {
  rates: PayRate[] | undefined; loading: boolean; error: boolean; onRetry: () => void; onSet: (type: string) => void
}) {
  const queryClient = useQueryClient()
  const { confirm } = useConfirm()
  const [history, setHistory] = useState(false)
  const withdraw = useMutation({
    mutationFn: (id: string) => driverPayAPI.withdrawRate(id),
    onSuccess: () => { toast.success('Rate withdrawn'); queryClient.invalidateQueries({ queryKey: KEY }) },
    onError: err => toast.error(errorMessage(err, 'We could not withdraw this rate. Try again.')),
  })
  const today = todayIST()
  const live = (rates ?? []).filter(r => r.active)
  const columns: Column<PayRate>[] = [
    { key: 'type', header: 'Vehicle type', cell: r => <span className="font-medium">{typeLabel(r.vehicle_type)}</span> },
    { key: 'trip', header: 'Per trip', align: 'right', cell: r => <span className="tabular">{formatRupees(r.per_trip_amount)}</span> },
    { key: 'km', header: 'Per km', align: 'right', cell: r => <span className="tabular">{formatRupees(r.per_km_amount)}</span> },
    { key: 'from', header: 'From', cell: r => formatDate(r.effective_from) },
    {
      key: 'until', header: 'Until', hideBelow: 'md',
      cell: r => (r.superseded_on ? formatDate(r.superseded_on) : <span className="text-muted">Now</span>),
    },
    {
      key: 'state', header: 'State',
      cell: r => (
        <StatusPill tone={r.state === 'current' ? 'success' : r.state === 'upcoming' ? 'info' : 'neutral'}>
          {r.state === 'current' ? 'In force' : r.state === 'upcoming' ? 'Starts later' : r.state === 'superseded' ? 'Replaced' : 'Withdrawn'}
        </StatusPill>
      ),
    },
    {
      key: 'actions', header: <span className="sr-only">Actions</span>, align: 'right', width: 'w-16',
      cell: r => r.active && (
        <IconButton label="Withdraw this rate" size="sm" icon={<Trash2 size={16} />} onClick={async () => {
          const ok = await confirm({
            title: 'Withdraw this rate?',
            message: `${typeLabel(r.vehicle_type)} ${formatRupees(r.per_trip_amount)} per trip + ${formatRupees(r.per_km_amount)} per km from ${formatDate(r.effective_from)} will no longer be used for new trips. Trips already priced keep their amounts.`,
            confirmLabel: 'Withdraw rate', tone: 'danger',
          })
          if (ok) withdraw.mutate(r.id)
        }} />
      ),
    },
  ]
  return (
    <section className="space-y-4">
      <SectionHeader
        title="Pay rates"
        description="A fixed amount per trip plus a rate per km, for each vehicle type. A new rate takes over from its start date; earlier trips keep the old one."
        actions={<Button icon={<Plus size={16} />} onClick={() => onSet('truck')}>Set a rate</Button>}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {PAY_VEHICLE_TYPES.map(type => {
          const current = live.filter(r => r.vehicle_type === type && r.effective_from <= today).sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0]
          const upcoming = live.filter(r => r.vehicle_type === type && r.effective_from > today).sort((a, b) => a.effective_from.localeCompare(b.effective_from))[0]
          return (
            <div key={type} className="rounded-card border border-border bg-surface p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-text">{typeLabel(type)}</p>
                <Button variant="ghost" size="sm" onClick={() => onSet(type)}>{current ? 'Change' : 'Set rate'}</Button>
              </div>
              {loading ? <p className="mt-2 text-sm text-muted">Loading…</p> : current ? (
                <>
                  <p className="mt-1 text-lg font-semibold tabular text-text">{formatRupees(current.per_trip_amount)} <span className="text-sm font-normal text-muted">per trip</span></p>
                  <p className="text-sm text-text tabular">+ {formatRupees(current.per_km_amount)} <span className="text-muted">per km</span></p>
                  <p className="mt-1 text-xs text-muted">From {formatDate(current.effective_from)}</p>
                </>
              ) : (
                <p className="mt-2 flex items-center gap-1.5 text-sm text-warning"><AlertTriangle size={16} aria-hidden="true" /> No rate set</p>
              )}
              {upcoming && <p className="mt-2 text-xs text-info">Next: {formatRupees(upcoming.per_trip_amount)} + {formatRupees(upcoming.per_km_amount)}/km from {formatDate(upcoming.effective_from)}</p>}
            </div>
          )
        })}
      </div>
      <div>
        <Button variant="ghost" size="sm" onClick={() => setHistory(h => !h)} aria-expanded={history}>{history ? 'Hide rate history' : 'Show rate history'}</Button>
        {history && (
          <div className="mt-3">
            <DataTable
              caption="Pay rate history"
              columns={columns}
              rows={rates ?? []}
              rowKey={r => r.id}
              loading={loading}
              error={error ? 'We could not load the rates. Check your connection and try again.' : undefined}
              onRetry={onRetry}
              pageSize={10}
              empty={{ title: 'No rates yet', description: 'Set a rate for each vehicle type so trips are priced.' }}
            />
          </div>
        )}
      </div>
    </section>
  )
}

function RateModal({ open, type, current, onClose, onSaved }: {
  open: boolean; type: string; current: PayRate[] | undefined; onClose: () => void; onSaved: () => void
}) {
  // Keyed by type so the fields start from the rate now in force each time the dialog opens
  return open ? <RateForm key={type} type={type} current={current} onClose={onClose} onSaved={onSaved} /> : null
}

function RateForm({ type, current, onClose, onSaved }: { type: string; current: PayRate[] | undefined; onClose: () => void; onSaved: () => void }) {
  const inForce = (current ?? []).filter(r => r.active && r.vehicle_type === type && r.effective_from <= todayIST()).sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0]
  const [vehicleType, setVehicleType] = useState(type)
  const [perTrip, setPerTrip] = useState(inForce ? String(inForce.per_trip_amount) : '')
  const [perKm, setPerKm] = useState(inForce ? String(inForce.per_km_amount) : '')
  const [from, setFrom] = useState(todayIST())
  const [errors, setErrors] = useState<Record<string, string>>({})
  const queryClient = useQueryClient()

  const save = useMutation({
    mutationFn: () => driverPayAPI.saveRate({ vehicle_type: vehicleType, per_trip_amount: Number(perTrip), per_km_amount: Number(perKm), effective_from: from }),
    onSuccess: r => {
      toast.success(r.repriced_entries ? `Rate saved. ${r.repriced_entries} waiting ${r.repriced_entries === 1 ? 'trip is' : 'trips are'} now priced.` : 'Rate saved')
      queryClient.invalidateQueries({ queryKey: KEY })
      onSaved()
    },
    onError: err => toast.error(errorMessage(err, 'We could not save this rate. Try again.')),
  })
  const submit = () => {
    const next: Record<string, string> = {}
    for (const [key, v] of [['perTrip', perTrip], ['perKm', perKm]] as const) {
      if (v.trim() === '' || !Number.isFinite(Number(v)) || Number(v) < 0) next[key] = 'Enter an amount of 0 or more'
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) next.from = 'Choose the date it starts'
    setErrors(next)
    if (Object.keys(next).length === 0) save.mutate()
  }
  return (
    <Modal open title={`Set the ${typeLabel(vehicleType).toLowerCase()} pay rate`} onClose={onClose} onSubmit={submit}
      description="It applies to trips finished from the start date. Trips before it keep the earlier rate."
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" loading={save.isPending}>Save rate</Button>
      </>}>
      <div className="space-y-4">
        <Select label="Vehicle type" value={vehicleType} onChange={e => setVehicleType(e.target.value)} options={PAY_VEHICLE_TYPES.map(t => ({ value: t, label: typeLabel(t) }))} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Per trip (₹)" inputMode="decimal" value={perTrip} onChange={e => setPerTrip(e.target.value)} error={errors.perTrip} required />
          <Input label="Per km (₹)" inputMode="decimal" value={perKm} onChange={e => setPerKm(e.target.value)} error={errors.perKm} required />
        </div>
        <Input label="Starts on" type="date" value={from} onChange={e => setFrom(e.target.value)} error={errors.from} required />
      </div>
    </Modal>
  )
}

// ── Adjust, void, pay ───────────────────────────────────────

function AdjustModal({ entry, onClose, onDone }: { entry: PayEntry; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const save = useMutation({
    mutationFn: () => driverPayAPI.adjust(entry.id, { amount: Number(amount), reason: reason.trim() }),
    onSuccess: () => { toast.success('Pay adjusted'); onDone() },
    onError: err => toast.error(errorMessage(err, 'We could not adjust this pay. Try again.')),
  })
  const submit = () => {
    const next: Record<string, string> = {}
    if (!Number.isFinite(Number(amount)) || Number(amount) === 0 || amount.trim() === '') next.amount = 'Enter an amount: positive to add, negative to deduct'
    if (reason.trim().length < 3) next.reason = 'Give a reason of at least 3 characters'
    setErrors(next)
    if (Object.keys(next).length === 0) save.mutate()
  }
  const after = Math.round((entry.amount + (Number(amount) || 0)) * 100) / 100
  return (
    <Modal open title="Adjust this trip's pay" onClose={onClose} onSubmit={submit}
      description={`${entry.driver_name ?? 'Driver'} · ${tripRef(entry)} · ${formatDate(entry.trip_date)} · now ${formatRupees(entry.amount)}`}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" loading={save.isPending}>Save adjustment</Button>
      </>}>
      <div className="space-y-4">
        <Input label="Amount (₹)" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} error={errors.amount}
          hint={amount && Number(amount) ? `The trip will be ${formatRupees(after)}` : 'A bonus or a toll to add, or a deduction with a minus sign'} required />
        <Textarea label="Reason" value={reason} onChange={e => setReason(e.target.value)} error={errors.reason} rows={3} required />
        {entry.adjustments.length > 0 && (
          <ul className="space-y-1 text-sm text-muted">
            {entry.adjustments.map((a, i) => <li key={i}>{formatRupees(a.amount)}: {a.reason}</li>)}
          </ul>
        )}
      </div>
    </Modal>
  )
}

function VoidModal({ entry, onClose, onDone }: { entry: PayEntry; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const save = useMutation({
    mutationFn: () => driverPayAPI.voidEntry(entry.id, reason.trim()),
    onSuccess: () => { toast.success('Pay voided'); onDone() },
    onError: err => toast.error(errorMessage(err, 'We could not void this pay. Try again.')),
  })
  const submit = () => {
    if (reason.trim().length < 3) return setError('Give a reason of at least 3 characters')
    setError('')
    save.mutate()
  }
  return (
    <Modal open title="Void this trip's pay?" onClose={onClose} onSubmit={submit}
      description={`${entry.driver_name ?? 'Driver'} · ${tripRef(entry)} · ${formatRupees(entry.amount)} will not be paid.`}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Keep it</Button>
        <Button type="submit" variant="danger" loading={save.isPending}>Void pay</Button>
      </>}>
      <Textarea label="Reason" value={reason} onChange={e => setReason(e.target.value)} error={error} rows={3} required />
    </Modal>
  )
}

function PayoutModal({ entries, onClose, onDone }: { entries: PayEntry[]; onClose: () => void; onDone: () => void }) {
  const summary = payoutSummary(entries)
  const [method, setMethod] = useState<PayoutMethod>('bank')
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [paidOn, setPaidOn] = useState(todayIST())
  const [error, setError] = useState('')
  const pay = useMutation({
    mutationFn: () => driverPayAPI.pay({
      driver_id: entries[0].driver_id, entry_ids: entries.map(e => e.id), method,
      reference: reference.trim() || undefined, note: note.trim() || undefined,
      // Noon IST of the chosen day, so it cannot slip to another day; today is "now"
      paid_at: paidOn === todayIST() ? undefined : `${paidOn}T06:30:00Z`,
    }),
    onSuccess: r => { toast.success(`${formatRupees(r.payout.amount)} recorded as paid. The driver has been told.`); onDone() },
    onError: err => toast.error(errorMessage(err, 'We could not record this payment. Try again.')),
  })
  const submit = () => {
    if (method !== 'cash' && reference.trim().length < 3) return setError(method === 'upi' ? 'Enter the UPI transaction reference' : 'Enter the bank transfer reference')
    setError('')
    pay.mutate()
  }
  const driver = entries[0]
  const dates = entries.map(e => e.trip_date).sort()
  return (
    <Modal open title="Pay driver" onClose={onClose} onSubmit={submit}
      description="Send the money yourself (cash, bank transfer or UPI), then record it here. The driver is told and sees it in their wallet."
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" icon={<BadgeIndianRupee size={16} />} loading={pay.isPending}>Record {formatRupees(summary.total)} as paid</Button>
      </>}>
      <div className="space-y-4">
        <div className="rounded-control border border-border bg-surface-subtle p-3 text-sm">
          <Link to={`/admin/users/${driver.driver_id}`} className="font-medium text-brand hover:underline">{driver.driver_name ?? 'Unnamed driver'}</Link>
          <p className="text-muted">{entries.length} {entries.length === 1 ? 'trip' : 'trips'} · {formatDate(dates[0])} to {formatDate(dates[dates.length - 1])}</p>
          <p className="mt-1 text-lg font-semibold tabular text-text">{formatRupees(summary.total)}</p>
        </div>
        <Select label="How you paid" value={method} onChange={e => setMethod(e.target.value as PayoutMethod)}
          options={(Object.keys(METHOD_LABEL) as PayoutMethod[]).map(m => ({ value: m, label: METHOD_LABEL[m] }))} />
        <Input label={method === 'cash' ? 'Reference (optional)' : method === 'upi' ? 'UPI transaction reference' : 'Bank transfer reference'}
          value={reference} onChange={e => setReference(e.target.value)} error={error} required={method !== 'cash'} />
        <Input label="Paid on" type="date" max={todayIST()} value={paidOn} onChange={e => setPaidOn(e.target.value)} />
        <Textarea label="Note (optional)" value={note} onChange={e => setNote(e.target.value)} rows={2} />
      </div>
    </Modal>
  )
}
