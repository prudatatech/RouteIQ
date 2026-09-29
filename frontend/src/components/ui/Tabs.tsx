import { useRef, type ReactNode } from 'react'
import clsx from 'clsx'

export interface TabItem<T extends string = string> {
  id: T
  label: ReactNode
  /** Optional count shown next to the label. */
  count?: number
}

/**
 * Horizontal tabs. Arrow keys move between tabs. Pair with `useTabParam` so the
 * selected tab survives reloads and can be linked to.
 */
export function Tabs<T extends string>({ tabs, value, onChange, label, className }: {
  tabs: TabItem<T>[]
  value: T
  onChange: (id: T) => void
  /** Accessible name for the tab list. */
  label: string
  className?: string
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    let next = -1
    if (e.key === 'ArrowRight') next = (index + 1) % tabs.length
    else if (e.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = tabs.length - 1
    if (next < 0) return
    e.preventDefault()
    refs.current[next]?.focus()
    onChange(tabs[next].id)
  }

  return (
    <div className={clsx('-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0', className)}>
      <div role="tablist" aria-label={label} className="flex min-w-max gap-1 border-b border-border">
        {tabs.map((tab, i) => {
          const selected = tab.id === value
          return (
            <button
              key={tab.id}
              ref={el => { refs.current[i] = el }}
              type="button"
              role="tab"
              id={`tab-${tab.id}`}
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(tab.id)}
              onKeyDown={e => onKeyDown(e, i)}
              className={clsx(
                '-mb-px inline-flex h-10 items-center gap-2 border-b-2 px-3 text-sm font-medium transition-colors',
                selected ? 'border-brand text-text' : 'border-transparent text-muted hover:text-text',
              )}
            >
              {tab.label}
              {tab.count !== undefined && (
                <span className={clsx(
                  'rounded-full px-2 py-0.5 text-xs tabular',
                  selected ? 'bg-brand-soft text-brand' : 'bg-neutral-soft text-neutral',
                )}>
                  {tab.count}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Tab panel linked to its tab for screen readers. */
export function TabPanel({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  return (
    <div role="tabpanel" aria-labelledby={`tab-${id}`} className={className}>
      {children}
    </div>
  )
}
