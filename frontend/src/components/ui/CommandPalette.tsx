import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Clock, Search } from 'lucide-react'
import { searchAPI, type SearchResultItem, type SearchResults } from '@/services/api'
import { Modal } from './Modal'
import { Spinner } from './Spinner'

const RECENT_KEY = 'recent_searches'
const MAX_RECENT = 5
const MIN_QUERY_LENGTH = 2
const DEBOUNCE_MS = 200

const GROUPS: { key: keyof SearchResults; label: string }[] = [
  { key: 'shipments', label: 'Shipments' },
  { key: 'cargo_manifests', label: 'Cargo manifests' },
  { key: 'vehicles', label: 'Vehicles' },
  { key: 'vendors', label: 'Vendors' },
  { key: 'partners', label: '3PL partners' },
  { key: 'users', label: 'Users' },
]

function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

function pushRecent(term: string): void {
  try {
    const trimmed = term.trim()
    if (!trimmed) return
    const next = [trimmed, ...readRecent().filter(t => t.toLowerCase() !== trimmed.toLowerCase())].slice(0, MAX_RECENT)
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    // Storage unavailable (private browsing, quota); recent searches just won't persist.
  }
}

export interface CommandPaletteProps {
  open: boolean
  onClose: () => void
}

/** Ctrl/Cmd+K global search: tracking IDs, plates, drivers, vendors and 3PL partners. */
export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [recent, setRecent] = useState<string[]>([])

  useEffect(() => {
    if (open) {
      setQuery('')
      setDebounced('')
      setActiveIndex(0)
      setRecent(readRecent())
    }
  }, [open])

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [query])

  const trimmed = debounced.trim()
  const { data, isFetching } = useQuery({
    queryKey: ['global-search', trimmed],
    queryFn: () => searchAPI.search(trimmed),
    enabled: open && trimmed.length >= MIN_QUERY_LENGTH,
  })

  const flat = useMemo<SearchResultItem[]>(() => {
    if (!data) return []
    return GROUPS.flatMap(g => data[g.key])
  }, [data])

  useEffect(() => { setActiveIndex(0) }, [flat.length, trimmed])

  const runRecent = (term: string) => {
    setQuery(term)
    setDebounced(term)
    inputRef.current?.focus()
  }

  const selectResult = (item: SearchResultItem) => {
    pushRecent(trimmed)
    onClose()
    navigate(item.path)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (flat.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex(i => Math.min(i + 1, flat.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = flat[activeIndex]
      if (item) selectResult(item)
    }
  }

  const showRecent = trimmed.length < MIN_QUERY_LENGTH
  const showEmpty = !showRecent && !isFetching && flat.length === 0
  let runningIndex = -1

  return (
    <Modal open={open} onClose={onClose} title="Search" size="lg" initialFocus={inputRef} className="max-h-[70vh]">
      <div className="relative">
        <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input
          ref={inputRef}
          data-autofocus
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search by tracking ID, plate, driver, vendor or partner"
          aria-label="Search"
          aria-activedescendant={flat[activeIndex] ? `search-result-${flat[activeIndex].id}` : undefined}
          className="h-control w-full rounded-control border border-border-strong bg-surface pl-9 pr-3 text-sm text-text placeholder:text-muted focus:border-brand focus:outline-none"
        />
      </div>

      <div className="mt-3 -mx-2 max-h-[50vh] overflow-y-auto" role="listbox" aria-label="Search results">
        {showRecent && (
          recent.length > 0 ? (
            <div>
              <p className="px-2 pb-1 text-xs font-medium text-muted">Recent searches</p>
              <ul>
                {recent.map(term => (
                  <li key={term}>
                    <button
                      type="button"
                      onClick={() => runRecent(term)}
                      className="flex w-full items-center gap-2 rounded-control px-2 py-2 text-left text-sm text-text hover:bg-surface-subtle"
                    >
                      <Clock size={14} aria-hidden="true" className="shrink-0 text-muted" />
                      <span className="truncate">{term}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="px-2 py-6 text-center text-sm text-muted">Type at least 2 characters to search shipments, vehicles, vendors and partners.</p>
          )
        )}

        {!showRecent && isFetching && flat.length === 0 && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted">
            <Spinner size={18} label="Searching" />
            <span aria-hidden="true">Searching…</span>
          </div>
        )}

        {showEmpty && (
          <p className="px-2 py-6 text-center text-sm text-muted">
            No matches for &ldquo;{trimmed}&rdquo;. Try a tracking ID, plate number, driver, company name or partner ID.
          </p>
        )}

        {!showRecent && GROUPS.map(g => {
          const items = data?.[g.key] ?? []
          if (items.length === 0) return null
          return (
            <div key={g.key}>
              <p className="px-2 pb-1 pt-2 text-xs font-medium text-muted">{g.label}</p>
              <ul>
                {items.map(item => {
                  runningIndex += 1
                  const index = runningIndex
                  const active = index === activeIndex
                  return (
                    <li key={`${g.key}-${item.id}`}>
                      <button
                        id={`search-result-${item.id}`}
                        type="button"
                        role="option"
                        aria-selected={active}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => selectResult(item)}
                        className={clsx(
                          'flex w-full flex-col items-start gap-0.5 rounded-control px-2 py-2 text-left text-sm',
                          active ? 'bg-brand-soft text-text' : 'text-text hover:bg-surface-subtle',
                        )}
                      >
                        <span className="truncate font-medium">{item.label}</span>
                        {item.sublabel && <span className="truncate text-xs text-muted">{item.sublabel}</span>}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </div>
    </Modal>
  )
}
