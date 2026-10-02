import { useEffect, useId, useRef, useState } from 'react'
import { HelpCircle, Lock } from 'lucide-react'
import { publicAPI } from '@/services/api'
import { Button, Input, Select } from '@/components/ui'
import type { HsnHit, ProductHandling, ProductRow } from '@/types/load'
import { MANUAL_RATES, rateText } from './logic'

export interface HsnFieldErrors { name?: string; hsn?: string; rate?: string }

/** What picking a search result does to a row: fill and lock the code and rate, and flag hazardous or perishable goods. */
export function applyHsnHit(row: ProductRow, hit: HsnHit): Partial<ProductRow> {
  const handling = new Set<ProductHandling>(row.handling)
  if (hit.is_hazmat) handling.add('hazmat')
  if (hit.is_perishable) handling.add('temperature_controlled')
  const typed = row.product_name.trim()
  return {
    product_name: typed.length >= 3 ? typed : hit.description,
    hsn_code: hit.hsn_code,
    hsn_locked: true,
    rate_options: hit.gst_rates,
    rate_note: hit.rate_note,
    gst_rate: hit.gst_rates.length === 1 ? hit.gst_rates[0] : null,
    category: hit.category,
    handling: Array.from(handling),
  }
}

const UNLOCK: Partial<ProductRow> = { hsn_code: '', hsn_locked: false, rate_options: [], rate_note: null, gst_rate: null, category: null }

function WhyHsn() {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        onBlur={() => setOpen(false)}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
      >
        <HelpCircle size={14} aria-hidden="true" /> Why is HSN needed?
      </button>
      {open && (
        <span id={id} role="tooltip" className="absolute left-0 top-full z-20 mt-1 w-64 rounded-control border border-border bg-surface p-2 text-xs text-text shadow-raised">
          Required for e-Way Bill and GST invoice generation
        </span>
      )}
    </span>
  )
}

/**
 * "Describe your goods": searches the HSN master as you type (3 characters or more, up to 8
 * suggestions). Picking one fills and locks the code and the GST rate; a code with several rates
 * asks which one applies. Goods that are not in the list can be entered by HSN code.
 */
export default function HsnSearch({ row, index, onChange, errors = {}, label = 'Describe your goods', placeholder = 'For example cement, rice, soap' }: {
  row: ProductRow
  index: number
  onChange: (patch: Partial<ProductRow>) => void
  errors?: HsnFieldErrors
  label?: string
  placeholder?: string
}) {
  const listId = useId()
  const [hits, setHits] = useState<HsnHit[]>([])
  const [open, setOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const [failed, setFailed] = useState(false)
  const [manual, setManual] = useState(false)
  const [lookupNote, setLookupNote] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)

  const query = row.product_name.trim()
  const searchable = !row.hsn_locked && !manual && !row.hsn_code

  useEffect(() => {
    if (!searchable || query.length < 3) { setHits([]); setFailed(false); return }
    const ctrl = new AbortController()
    const timer = setTimeout(() => {
      setSearching(true)
      publicAPI.hsnSearch(query, ctrl.signal)
        .then(items => { setHits(items.slice(0, 8)); setFailed(false) })
        .catch(err => { if (!ctrl.signal.aborted) { setHits([]); setFailed(true); console.warn('HSN search failed', err) } })
        .finally(() => { if (!ctrl.signal.aborted) setSearching(false) })
    }, 250)
    return () => { clearTimeout(timer); ctrl.abort() }
  }, [query, searchable])

  useEffect(() => {
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [])

  const pick = (hit: HsnHit) => { onChange(applyHsnHit(row, hit)); setOpen(false); setHits([]) }

  // A code typed by hand: look it up, so a known code still gets its real rate.
  const lookupManual = async () => {
    const code = row.hsn_code.trim()
    setLookupNote(null)
    if (code.length < 4) return
    try {
      const hit = await publicAPI.hsn(code)
      if (hit) { onChange(applyHsnHit(row, hit)); setManual(false) } else setLookupNote('We do not have this code listed. Choose the GST rate yourself.')
    } catch { setLookupNote('We could not check this code. Choose the GST rate yourself.') }
  }

  const rateOptions = row.rate_options.length > 1 ? row.rate_options : MANUAL_RATES
  const showRateSelect = row.hsn_locked ? row.rate_options.length > 1 : !!row.hsn_code || manual
  const nameId = `${listId}-name`

  return (
    <div className="space-y-3" ref={box}>
      <div className="relative">
        <Input
          id={nameId}
          label={label}
          required
          value={row.product_name}
          onChange={e => { onChange({ product_name: e.target.value }); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          error={errors.name}
          role="combobox"
          aria-expanded={open && hits.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          name={`product_name_${index}`}
        />
        {open && searchable && query.length >= 3 && (
          <ul id={listId} role="listbox" aria-label="HSN suggestions" className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-control border border-border bg-surface shadow-raised">
            {searching && hits.length === 0 && <li className="px-3 py-2 text-sm text-muted">Searching…</li>}
            {failed && <li className="px-3 py-2 text-sm text-danger">We could not search just now. Enter the HSN code instead.</li>}
            {!searching && !failed && hits.length === 0 && <li className="px-3 py-2 text-sm text-muted">No match found.</li>}
            {hits.map(hit => (
              <li key={hit.hsn_code} role="option" aria-selected={false}>
                <button
                  type="button"
                  onClick={() => pick(hit)}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-subtle focus-visible:bg-surface-subtle"
                >
                  <span className="shrink-0 font-mono text-sm font-medium text-text">{hit.hsn_code}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-muted">{hit.description}</span>
                  <span className="shrink-0 rounded-full bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand">{rateText(hit.gst_rates)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {row.hsn_locked ? (
        <div className="grid grid-cols-2 gap-3">
          <Input label="HSN code" value={row.hsn_code} readOnly leading={<Lock size={14} aria-hidden="true" />} error={errors.hsn} />
          {row.rate_options.length <= 1 && (
            <Input label="GST rate" value={row.gst_rate === null ? '' : `${row.gst_rate}%`} readOnly leading={<Lock size={14} aria-hidden="true" />} />
          )}
        </div>
      ) : (manual || row.hsn_code) ? (
        <Input
          label="HSN code"
          required
          inputMode="numeric"
          value={row.hsn_code}
          onChange={e => onChange({ hsn_code: e.target.value.replace(/\D/g, '').slice(0, 8) })}
          onBlur={lookupManual}
          error={errors.hsn}
          hint={lookupNote ?? '4 to 8 digits, as on your invoice.'}
        />
      ) : null}

      {showRateSelect && (
        <Select
          label="Select applicable GST rate"
          required
          value={row.gst_rate === null ? '' : String(row.gst_rate)}
          onChange={e => onChange({ gst_rate: e.target.value === '' ? null : Number(e.target.value) })}
          placeholder="Select rate"
          options={rateOptions.map(r => ({ value: String(r), label: `${r}%` }))}
          error={errors.rate}
          hint={row.rate_note ?? undefined}
        />
      )}
      {!row.hsn_locked && !showRateSelect && errors.hsn && <p className="text-xs text-danger" role="alert">{errors.hsn}</p>}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {row.hsn_locked || row.hsn_code ? (
          <Button variant="ghost" size="sm" onClick={() => { onChange(UNLOCK); setManual(false); setLookupNote(null) }}>Change goods or code</Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setManual(true)}>Can't find your goods? Enter HSN manually</Button>
        )}
        <WhyHsn />
      </div>
    </div>
  )
}
