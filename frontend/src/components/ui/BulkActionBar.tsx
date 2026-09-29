import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { IconButton } from './Button'

/**
 * Sticky bar that appears once rows are selected in a DataTable, with the
 * bulk actions that apply to the current selection.
 */
export function BulkActionBar({ count, onClear, children }: {
  count: number
  onClear: () => void
  children: ReactNode
}) {
  if (count === 0) return null
  return (
    <div className="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-card border border-border-strong bg-surface px-4 py-3 shadow-dialog">
      <span className="text-sm font-medium text-text">{count} selected</span>
      <div className="flex flex-wrap items-center gap-2">
        {children}
        <IconButton size="sm" label="Clear selection" icon={<X size={16} />} onClick={onClear} />
      </div>
    </div>
  )
}
