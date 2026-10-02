import { useEffect, useState } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Check } from 'lucide-react'
import { companyLoadsAPI, publicAPI } from '@/services/api'
import { Alert, Button, Input, Select, StatusPill, Textarea, useConfirm } from '@/components/ui'
import { useCountdown } from '@/components/vendor/quoteTime'
import { errorMessage, formatRupees } from '@/utils/display'
import { amountInRange, canAcceptDirect, freightRange } from './quoteRules'
import PriorityBadge from './PriorityBadge'
import type { MarketLoad, MarketTab } from '@/types/routing'

const TABS: MarketTab[] = ['new', 'quoted', 'won']

/** The date a quote stays valid, as the end of that day in India. */
const endOfDay = (date: string) => new Date(`${date}T23:59:59+05:30`).toISOString()
const dateOf = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '')

/** The quote form and the direct accept for a load a company can see. Mounted in the load drawer. */
export default function QuotePanel({ loadId, status }: { loadId: string; status: string }) {
  const queryClient = useQueryClient()
  const { confirm } = useConfirm()
  // The market lists hold this company's own quote and the vendor's budget; they share the cache with the New loads table
  const lists = useQueries({
    queries: TABS.map(tab => ({ queryKey: ['company', 'market', tab], queryFn: () => companyLoadsAPI.market(tab), staleTime: 30_000 })),
  })
  const found = lists.map((q, i) => ({ tab: TABS[i], row: q.data?.find(r => r.id === loadId) })).find(x => x.row)
  const row: MarketLoad | undefined = found?.row
  const won = found?.tab === 'won'
  const mine = row?.my_quote && row.my_quote.status === 'submitted' ? row.my_quote : null
  const loading = !row && lists.some(q => q.isLoading)

  const classes = useQuery({ queryKey: ['public', 'vehicle-classes'], queryFn: () => publicAPI.vehicleClasses(), staleTime: 300_000 })
  const left = useCountdown(row?.quote_requested ? row.quote_deadline : null)

  const range = row ? freightRange(row) : null
  const [bookAmount, setBookAmount] = useState('')
  const [bookError, setBookError] = useState<string | null>(null)
  const [amount, setAmount] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [vehicleClass, setVehicleClass] = useState('')
  const [eta, setEta] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setAmount(mine ? String(mine.amount_inr) : '')
    setValidUntil(dateOf(mine?.valid_until))
    setVehicleClass(mine?.vehicle_class ?? '')
    setEta(dateOf(mine?.pickup_eta))
    setNotes(mine?.notes ?? '')
    setError(null)
    setBookAmount(range ? String(range.min) : '')
    setBookError(null)
  }, [loadId, range?.min, mine?.id, mine?.amount_inr]) // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['company', 'market'] }),
    queryClient.invalidateQueries({ queryKey: ['vendor-requests'] }),
  ])

  const submit = useMutation({
    mutationFn: () => companyLoadsAPI.submitQuote(loadId, {
      amount_inr: Number(amount),
      ...(validUntil ? { valid_until: endOfDay(validUntil) } : {}),
      ...(vehicleClass ? { vehicle_class: vehicleClass } : {}),
      ...(eta ? { pickup_eta: eta } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    }),
    onSuccess: async () => { toast.success(mine ? 'Quote updated' : 'Quote sent. The vendor has been told.'); await refresh() },
    onError: err => setError(errorMessage(err, 'We could not send your quote. Try again.')),
  })
  const withdraw = useMutation({
    mutationFn: () => companyLoadsAPI.withdrawQuote(loadId),
    onSuccess: async () => { toast.success('Quote withdrawn'); await refresh() },
    onError: err => toast.error(errorMessage(err, 'We could not withdraw your quote. Try again.')),
  })
  const accept = useMutation({
    mutationFn: (amountInr?: number) => companyLoadsAPI.accept(loadId, amountInr !== undefined ? { amount_inr: amountInr } : {}),
    onSuccess: async () => { toast.success('Accepted. The vendor has been told.'); await refresh() },
    onError: err => toast.error(errorMessage(err, 'We could not accept this load. Try again.')),
  })

  if (won) {
    return (
      <Alert tone="success" title="Won">
        The vendor chose your quote{row?.my_quote ? ` at ${formatRupees(row.my_quote.amount_inr)}` : ''}. Assign a vehicle next.
      </Alert>
    )
  }
  if (status !== 'pending') return null
  if (loading) return null

  const budget = row?.budget_inr ?? null
  const direct = canAcceptDirect({ status, quote_requested: row?.quote_requested, budget_inr: budget, price_min_inr: row?.price_min_inr, price_max_inr: row?.price_max_inr }, won)
  const quoting = row?.quote_requested === true

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!(Number(amount) > 0)) { setError('Enter your price in rupees.'); return }
    setError(null)
    submit.mutate()
  }
  const askAccept = async () => {
    if (range) {
      const value = Number(bookAmount)
      if (!amountInRange(value, range)) {
        setBookError(`Enter an amount between ${formatRupees(range.min)} and ${formatRupees(range.max)}.`)
        return
      }
      setBookError(null)
      const ok = await confirm({
        title: `Book at ${formatRupees(value)}?`,
        message: 'The load is yours at this price. The vendor is told, and other companies lose it.',
        confirmLabel: `Book at ${formatRupees(value)}`,
      })
      if (ok) accept.mutate(value)
      return
    }
    const ok = await confirm({
      title: `Accept at ${formatRupees(budget)}?`,
      message: 'The load is yours at the vendor’s budget. The vendor is told, and other companies lose it.',
      confirmLabel: `Accept at ${formatRupees(budget)}`,
    })
    if (ok) accept.mutate(undefined)
  }

  return (
    <section aria-label={quoting ? 'Your quote' : 'Book this load'} className="space-y-4 rounded-control border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-text">{quoting ? 'Your quote' : 'Book this load'}</h3>
        <div className="flex flex-wrap items-center gap-2">
          <PriorityBadge priority={row?.priority} />
          {quoting && <StatusPill tone={left === 'Time is up' ? 'warning' : 'info'}>{left ? `Quote wanted, ${left}` : 'Quote wanted'}</StatusPill>}
        </div>
      </div>
      {range && (
        <p className="text-sm text-muted" data-testid="range-line">
          Recommended freight: <span className="font-medium text-text tabular">{formatRupees(range.min)} – {formatRupees(range.max)}</span>. You can book at any price in this range.
        </p>
      )}
      {!range && budget ? <p className="text-sm text-muted">Vendor’s budget: <span className="font-medium text-text tabular">{formatRupees(budget)}</span></p> : null}

      {direct && range && (
        <div className="space-y-2">
          <Input
            label="Your amount (₹)" required inputMode="decimal" value={bookAmount}
            onChange={e => setBookAmount(e.target.value.replace(/[^\d.]/g, ''))} error={bookError ?? undefined}
            hint={`Between ${formatRupees(range.min)} and ${formatRupees(range.max)}.`}
          />
          <Button icon={<Check size={16} />} loading={accept.isPending} disabled={submit.isPending} onClick={askAccept}>Book this load</Button>
        </div>
      )}
      {direct && !range && (
        <Button icon={<Check size={16} />} loading={accept.isPending} disabled={submit.isPending} onClick={askAccept}>
          Accept at {formatRupees(budget)}
        </Button>
      )}

      {quoting && (
        <form onSubmit={onSubmit} className="space-y-3" noValidate>
          <Input label="Your price (₹)" required inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value.replace(/[^\d.]/g, ''))} error={error ?? undefined} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Valid until" type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)} />
            <Input label="Pickup ETA" type="date" value={eta} onChange={e => setEta(e.target.value)} />
          </div>
          <Select
            label="Vehicle class" value={vehicleClass} onChange={e => setVehicleClass(e.target.value)}
            options={[{ value: '', label: 'Not set' }, ...(classes.data ?? []).map(c => ({ value: c.key, label: c.name }))]}
          />
          <Textarea label="Notes" rows={2} value={notes} onChange={e => setNotes(e.target.value)} hint="Optional. For example loading time or return load." />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={submit.isPending} disabled={withdraw.isPending}>{mine ? 'Update quote' : 'Submit quote'}</Button>
            {mine && <Button type="button" variant="secondary" loading={withdraw.isPending} disabled={submit.isPending} onClick={() => withdraw.mutate()}>Withdraw quote</Button>}
          </div>
        </form>
      )}
    </section>
  )
}
