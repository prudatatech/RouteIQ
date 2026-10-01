import clsx from 'clsx'
import { placeLines } from '@/utils/address'

/**
 * A place as two lines: its name, then the rest of the address. A name that opens the full address
 * is not printed twice. Every list, drawer and page shows a place through this one component.
 */
export default function PlaceText({ name, address, truncate, className }: {
  name?: string | null
  address?: string | null
  /** One line each, cut with an ellipsis, for table cells. */
  truncate?: boolean
  className?: string
}) {
  const lines = placeLines(name, address)
  if (!lines) return <span className="text-muted">—</span>
  return (
    <span className={clsx('block min-w-0', className)}>
      <span className={clsx('block', truncate && 'truncate')}>{lines.primary}</span>
      {lines.secondary && <span className={clsx('block text-xs text-muted', truncate && 'truncate')}>{lines.secondary}</span>}
    </span>
  )
}
