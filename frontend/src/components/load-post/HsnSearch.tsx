import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { publicAPI } from '@/services/api'
import { Button, Input, Select } from '@/components/ui'
import type { HsnHit, ProductRow } from '@/types/load'
import { applyHsnHit, rateChoices } from './helpers'
import HsnList, { FIRST_HITS } from './HsnList'
import WhyHsn from './WhyHsn'
import { claimHsnList, releaseHsnList } from './hsnOpen'
import { scrollElementIntoView, stickyBarHeight, stickyHeaderHeight, visibleHeight } from './useScrollIntoView'

export interface HsnFieldErrors { name?: string; hsn?: string; rate?: string }


const RESET: Partial<ProductRow> = { hsn_code: '', rate_options: [], rate_note: null, gst_rate: null, category: null }

/**
 * "Describe your goods": searches the HSN master as you type (3 characters or more, up to 8
 * suggestions). Picking one fills the HSN code and the GST rate, and both stay editable: the code can be changed (it is
 * looked up again when the box is left) and any GST rate can be chosen, the code's own rates first. A code with several
 * rates asks which one applies. Goods that are not in the list can be entered by HSN code.
 */
export default function HsnSearch({ row, index, onChange, onPicked, errors = {}, label = 'Describe your goods', placeholder = 'For example cement, rice, soap' }: {
  row: ProductRow
  index: number
  onChange: (patch: Partial<ProductRow>) => void
  /** Called after a suggestion is picked (the row moves on to the quantity). */
  onPicked?: () => void
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
  const [active, setActive] = useState(-1)
  const [showAll, setShowAll] = useState(false)
  const [maxHeight, setMaxHeight] = useState(288)
  const box = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLDivElement>(null)
  const scrolled = useRef(false)

  const query = row.product_name.trim()
  const searchable = !manual && !row.hsn_code
  // The code the rate options belong to: a lookup only runs when the code changed, so a rate the person chose is kept.
  const knownCode = useRef(row.hsn_code.trim())

  useEffect(() => {
    if (!searchable || query.length < 3) { setHits([]); setFailed(false); return }
    const ctrl = new AbortController()
    const timer = setTimeout(() => {
      setSearching(true)
      publicAPI.hsnSearch(query, ctrl.signal)
        .then(items => { setHits(items.slice(0, 8)); setFailed(false); setActive(-1); setShowAll(false) })
        .catch(err => { if (!ctrl.signal.aborted) { setHits([]); setFailed(true); console.warn('HSN search failed', err) } })
        .finally(() => { if (!ctrl.signal.aborted) setSearching(false) })
    }, 250)
    return () => { clearTimeout(timer); ctrl.abort() }
  }, [query, searchable])

  const close = useCallback(() => { setOpen(false); setActive(-1); scrolled.current = false }, [])
  useEffect(() => () => releaseHsnList(close), [close])

  useEffect(() => {
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) close() }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [close])


  /** Open the list: close any other row's list, bring this box under the header so the list has room, cap its height to what is visible. */
  const openList = () => {
    claimHsnList(close)
    setOpen(true)
    const wrapper = field.current
    if (!wrapper) return
    if (!scrolled.current) { scrolled.current = true; scrollElementIntoView(wrapper) }
    const room = visibleHeight() - stickyHeaderHeight() - 12 - wrapper.offsetHeight - 52 - stickyBarHeight()
    setMaxHeight(Math.round(Math.min(420, Math.max(192, room))))
  }

  const pick = (hit: HsnHit) => { knownCode.current = hit.hsn_code; onChange(applyHsnHit(row, hit)); close(); setHits([]); onPicked?.() }

  const listShown = open && searchable && query.length >= 3
  const status = searching && hits.length === 0 ? 'searching' : failed ? 'failed' : hits.length === 0 ? 'empty' : 'ready'
  const visible = showAll ? hits.length : Math.min(hits.length, FIRST_HITS)

  useEffect(() => {
    if (active < 0) return
    document.getElementById(`${listId}-opt-${active}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [active, listId])

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Tab') { close(); return }
    if (e.key === 'Escape') { if (listShown) { e.preventDefault(); close() } return }
    if (!searchable) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (query.length < 3) return
      e.preventDefault()
      if (!listShown) { openList(); return }
      if (visible === 0) return
      const down = e.key === 'ArrowDown'
      setActive(a => (down ? (a + 1) % visible : a <= 0 ? visible - 1 : a - 1))
    } else if (e.key === 'Enter' && listShown && active >= 0 && hits[active]) {
      e.preventDefault()
      pick(hits[active])
    }
  }

  // A code typed or changed by hand: look it up, so a known code still gets its real rates.
  const lookupManual = async () => {
    const code = row.hsn_code.trim()
    setLookupNote(null)
    if (code.length < 4 || code === knownCode.current) return
    knownCode.current = code
    try {
      const hit = await publicAPI.hsn(code)
      if (hit) {
        const patch = applyHsnHit(row, hit)
        // Keep the rate the person had chosen when the new code allows it.
        onChange(row.gst_rate !== null && hit.gst_rates.includes(row.gst_rate) ? { ...patch, gst_rate: row.gst_rate } : patch)
        setManual(false)
      } else setLookupNote('We do not have this code listed. Choose the GST rate yourself.')
    } catch { setLookupNote('We could not check this code. Choose the GST rate yourself.') }
  }

  const showCode = !!row.hsn_code || manual
  const rateOptions = rateChoices(row.rate_options, row.gst_rate)
  const nameId = `${listId}-name`

  return (
    <div className="space-y-3" ref={box}>
      <div className="relative scroll-mt-24" ref={field}>
        <Input
          id={nameId}
          label={label}
          required
          value={row.product_name}
          onChange={e => { onChange({ product_name: e.target.value }); openList() }}
          onFocus={openList}
          onBlur={() => { scrolled.current = false }}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          error={errors.name}
          role="combobox"
          aria-expanded={listShown}
          aria-controls={listShown ? listId : undefined}
          aria-activedescendant={listShown && active >= 0 ? `${listId}-opt-${active}` : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          name={`product_name_${index}`}
        />
        {listShown && (
          <HsnList
            id={listId} hits={hits} active={active} status={status} maxHeight={maxHeight} showAll={showAll}
            onShowAll={() => setShowAll(true)} onPick={pick} onHover={setActive}
          />
        )}
      </div>

      {showCode && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="HSN code"
            required
            inputMode="numeric"
            value={row.hsn_code}
            onChange={e => {
              const code = e.target.value.replace(/\D/g, '').slice(0, 8)
              // The old code's rates no longer apply to a changed code; the lookup brings the new ones.
              onChange(code === knownCode.current ? { hsn_code: code } : { hsn_code: code, rate_options: [], rate_note: null })
            }}
            onBlur={lookupManual}
            error={errors.hsn}
            hint={lookupNote ?? '4 to 8 digits, as on your invoice. You can change it.'}
          />
          <Select
            label="GST rate"
            required
            value={row.gst_rate === null ? '' : String(row.gst_rate)}
            onChange={e => onChange({ gst_rate: e.target.value === '' ? null : Number(e.target.value) })}
            placeholder="Select rate"
            options={rateOptions.map(r => ({ value: String(r), label: `${r}%` }))}
            error={errors.rate}
            hint={row.rate_note ?? undefined}
          />
        </div>
      )}
      {!showCode && errors.hsn && <p className="text-xs text-danger" role="alert">{errors.hsn}</p>}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {row.hsn_code ? (
          <Button variant="ghost" size="sm" onClick={() => { knownCode.current = ''; onChange(RESET); setManual(false); setLookupNote(null) }}>Search for other goods</Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setManual(true)}>Can't find your goods? Enter HSN manually</Button>
        )}
        <WhyHsn />
      </div>
    </div>
  )
}
