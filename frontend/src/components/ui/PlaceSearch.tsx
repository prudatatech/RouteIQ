import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { Clock, MapPin } from 'lucide-react'
import { suggestPlaces, resolvePlace, type PlaceSuggestion, type ResolvedPlace } from '@/services/geocoding'
import { addRecentPlace, getRecentPlaces } from '@/utils/recentPlaces'
import { Field, controlClasses } from './Field'
import { Spinner } from './Spinner'

export interface PlaceSearchProps {
  label?: ReactNode
  hint?: ReactNode
  error?: ReactNode
  required?: boolean
  placeholder?: string
  /** The chosen place; null until the user picks a suggestion. */
  value: ResolvedPlace | null
  onChange: (place: ResolvedPlace | null) => void
  className?: string
  disabled?: boolean
  /**
   * Opts in to remembering picked places and showing them as "Recent addresses" suggestions
   * when the field is focused and empty. A distinct namespace per picker (e.g. `'wizard-route'`)
   * keeps unrelated pickers' histories separate. Off by default.
   */
  recentPlacesKey?: string
}

/**
 * Address box with suggestions (India). The value is only set once the user picks a
 * suggestion, so a place always has coordinates.
 */
export function PlaceSearch({
  label, hint, error, required, placeholder = 'Search for an address', value, onChange, className, disabled, recentPlacesKey,
}: PlaceSearchProps) {
  const [text, setText] = useState(value?.address ?? '')
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([])
  const [active, setActive] = useState(-1)
  const [open, setOpen] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [recentPlaces, setRecentPlaces] = useState<ResolvedPlace[]>(() => recentPlacesKey ? getRecentPlaces(recentPlacesKey) : [])
  const listId = useId()
  const wrapper = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setText(value?.address ?? '')
  }, [value?.address])

  useEffect(() => {
    if (recentPlacesKey) setRecentPlaces(getRecentPlaces(recentPlacesKey))
  }, [recentPlacesKey])

  // With no query yet, recent addresses fill the suggestion list instead (when there are any).
  const showRecent = !!recentPlacesKey && text.trim() === '' && recentPlaces.length > 0

  useEffect(() => {
    if (value && text === value.address) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      suggestPlaces(text, controller.signal)
        .then(list => { setSuggestions(list); setActive(-1); setOpen(list.length > 0 || showRecent) })
        .catch(() => setSuggestions([]))
    }, 300)
    return () => { clearTimeout(timer); controller.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, value])

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (wrapper.current && !wrapper.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const remember = (place: ResolvedPlace) => {
    if (!recentPlacesKey) return
    addRecentPlace(recentPlacesKey, place)
    setRecentPlaces(getRecentPlaces(recentPlacesKey))
  }

  const choose = async (s: PlaceSuggestion) => {
    setText(s.place_name)
    setOpen(false)
    setSuggestions([])
    setResolving(true)
    setLookupError(null)
    const place = await resolvePlace(s).catch(() => null)
    setResolving(false)
    if (!place) {
      setLookupError('We could not locate that address. Try a more specific one.')
      onChange(null)
      return
    }
    onChange(place)
    remember(place)
  }

  const chooseRecent = (place: ResolvedPlace) => {
    setText(place.address)
    setOpen(false)
    setLookupError(null)
    onChange(place)
    remember(place)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || suggestions.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => (i + 1) % suggestions.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => (i <= 0 ? suggestions.length - 1 : i - 1)) }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(suggestions[active]) }
    else if (e.key === 'Escape') setOpen(false)
  }

  return (
    <Field label={label} hint={hint} error={lookupError ?? error} required={required} className={className}>
      {control => (
        <div ref={wrapper} className="relative">
          <MapPin size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            {...control}
            type="text"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
            autoComplete="off"
            disabled={disabled}
            placeholder={placeholder}
            value={text}
            onChange={e => { setText(e.target.value); setLookupError(null); if (value) onChange(null) }}
            onFocus={() => setOpen(suggestions.length > 0 || showRecent)}
            onKeyDown={onKeyDown}
            className={clsx(controlClasses, (lookupError ?? error) ? 'border-danger' : 'border-border-strong', 'h-control pl-9 pr-9')}
          />
          {resolving && <Spinner size={16} className="absolute right-3 top-1/2 -translate-y-1/2" />}
          {open && suggestions.length === 0 && showRecent && (
            <ul
              id={listId}
              role="listbox"
              aria-label="Recent addresses"
              className="absolute z-30 mt-1 w-full overflow-hidden rounded-control border border-border bg-surface shadow-raised"
            >
              {recentPlaces.map((p, i) => (
                <li
                  key={p.address}
                  id={`${listId}-recent-${i}`}
                  role="option"
                  aria-selected={false}
                  onMouseDown={e => { e.preventDefault(); chooseRecent(p) }}
                  className="flex cursor-pointer items-start gap-2 px-3 py-2 hover:bg-surface-subtle"
                >
                  <Clock size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-muted" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-text">{p.address.split(', ')[0]}</div>
                    <div className="truncate text-xs text-muted">{p.address}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {open && suggestions.length > 0 && (
            <ul
              id={listId}
              role="listbox"
              className="absolute z-30 mt-1 w-full overflow-hidden rounded-control border border-border bg-surface shadow-raised"
            >
              {suggestions.map((s, i) => (
                <li
                  key={s.id}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={e => { e.preventDefault(); choose(s) }}
                  onMouseEnter={() => setActive(i)}
                  className={clsx('cursor-pointer px-3 py-2', i === active && 'bg-surface-subtle')}
                >
                  <div className="text-sm font-medium text-text">{s.text}</div>
                  <div className="truncate text-xs text-muted">{s.place_name}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Field>
  )
}
