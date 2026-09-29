import { useEffect, useMemo, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from 'lucide-react'
import { EmptyState, ErrorState, Skeleton } from './States'
import { IconButton } from './Button'

export interface Column<T> {
  key: string
  header: ReactNode
  cell: (row: T) => ReactNode
  /** Makes the column sortable by this value. */
  sortValue?: (row: T) => string | number | null | undefined
  align?: 'left' | 'right' | 'center'
  /** Tailwind width class, e.g. "w-32". */
  width?: string
  /** Leave out of the stacked phone layout (still shown on wider screens). */
  hideOnMobile?: boolean
  /** Hide below the given breakpoint in the table layout. */
  hideBelow?: 'md' | 'lg' | 'xl' | '2xl'
  className?: string
}

export interface DataTableSelection<T> {
  selectedKeys: ReadonlySet<string>
  onToggleRow: (key: string, row: T) => void
  /** Called with the rows currently on screen (the visible page) and the new checked state. */
  onToggleAll: (pageRows: T[], checked: boolean) => void
  /** Rows that fail this check don't get a checkbox and are ignored by "select all". */
  isRowSelectable?: (row: T) => boolean
}

export interface DataTableProps<T> {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  loading?: boolean
  error?: ReactNode
  onRetry?: () => void
  /** Shown when there are no rows; pass an EmptyState-like object or any node. */
  empty?: { title: ReactNode; description?: ReactNode; action?: ReactNode; icon?: ReactNode } | ReactNode
  onRowClick?: (row: T) => void
  /** Accessible description of what the table lists. */
  caption: string
  /** Rows per page; paging controls appear when there are more rows. */
  pageSize?: number
  initialSort?: { key: string; direction: 'asc' | 'desc' }
  /** Controlled sort; pass together with `onSortChange` to lift sort state to the page (e.g. for the URL). */
  sort?: { key: string; direction: 'asc' | 'desc' } | null
  onSortChange?: (sort: { key: string; direction: 'asc' | 'desc' } | null) => void
  selectedKey?: string | null
  /** Adds a checkbox column with select-all-on-page. Omit for tables without bulk actions. */
  selection?: DataTableSelection<T>
  className?: string
}

const alignClass = { left: 'text-left', right: 'text-right', center: 'text-center' }
const hideClass = { md: 'hidden md:table-cell', lg: 'hidden lg:table-cell', xl: 'hidden xl:table-cell', '2xl': 'hidden 2xl:table-cell' }

function isEmptyConfig(value: unknown): value is { title: ReactNode; description?: ReactNode; action?: ReactNode; icon?: ReactNode } {
  return typeof value === 'object' && value !== null && 'title' in value
}

/**
 * The one table for lists of records: sorting, paging, loading/empty/error rows,
 * sticky header and a stacked card layout on phones.
 */
export function DataTable<T>({
  columns, rows, rowKey, loading, error, onRetry, empty, onRowClick, caption, pageSize = 20, initialSort,
  sort: controlledSort, onSortChange, selectedKey, selection, className,
}: DataTableProps<T>) {
  const isControlled = controlledSort !== undefined && onSortChange !== undefined
  const [internalSort, setInternalSort] = useState(initialSort ?? null)
  const sort = isControlled ? controlledSort : internalSort
  const setSort = isControlled
    ? (updater: typeof internalSort | ((prev: typeof internalSort) => typeof internalSort)) => {
      const next = typeof updater === 'function' ? (updater as (prev: typeof internalSort) => typeof internalSort)(controlledSort ?? null) : updater
      onSortChange!(next)
    }
    : setInternalSort
  const [page, setPage] = useState(0)

  const sorted = useMemo(() => {
    if (!sort) return rows
    const column = columns.find(c => c.key === sort.key)
    if (!column?.sortValue) return rows
    const factor = sort.direction === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const av = column.sortValue!(a)
      const bv = column.sortValue!(b)
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * factor
      return String(av).localeCompare(String(bv), undefined, { numeric: true }) * factor
    })
  }, [rows, sort, columns])

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize))
  useEffect(() => { if (page > pageCount - 1) setPage(0) }, [page, pageCount])
  const visible = sorted.slice(page * pageSize, page * pageSize + pageSize)

  const selectableVisible = selection ? visible.filter(row => selection.isRowSelectable?.(row) ?? true) : []
  const allVisibleSelected = selection != null && selectableVisible.length > 0
    && selectableVisible.every(row => selection.selectedKeys.has(rowKey(row)))
  const someVisibleSelected = selection != null && !allVisibleSelected
    && selectableVisible.some(row => selection.selectedKeys.has(rowKey(row)))

  const toggleSort = (key: string) => {
    setSort(prev => (prev?.key === key ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'asc' }))
    setPage(0)
  }

  const rowProps = (row: T) => onRowClick ? {
    onClick: () => onRowClick(row),
    // Only when the row itself has focus, so Enter and Space still work on buttons and checkboxes inside it.
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.target !== e.currentTarget) return
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRowClick(row) }
    },
    tabIndex: 0,
  } : {}

  let body: ReactNode = null
  if (error) {
    body = <ErrorState compact description={error} onRetry={onRetry} />
  } else if (!loading && rows.length === 0) {
    body = isEmptyConfig(empty)
      ? <EmptyState compact {...empty} />
      : empty ?? <EmptyState compact title="Nothing here yet" />
  }

  return (
    <div className={clsx('overflow-hidden rounded-card border border-border bg-surface', className)}>
      {/* Table layout (tablet and up) */}
      <div className="hidden max-h-[70dvh] overflow-auto md:block">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 z-10 bg-surface-subtle">
            <tr>
              {selection && (
                <th scope="col" className="w-10 border-b border-border px-4 py-2.5">
                  <input
                    type="checkbox"
                    aria-label="Select all rows on this page"
                    className="h-4 w-4 rounded border-border-strong accent-brand cursor-pointer disabled:cursor-not-allowed"
                    checked={allVisibleSelected}
                    ref={el => { if (el) el.indeterminate = someVisibleSelected }}
                    disabled={selectableVisible.length === 0}
                    onChange={e => selection.onToggleAll(selectableVisible, e.target.checked)}
                  />
                </th>
              )}
              {columns.map(col => {
                const active = sort?.key === col.key
                return (
                  <th
                    key={col.key}
                    scope="col"
                    aria-sort={active ? (sort!.direction === 'asc' ? 'ascending' : 'descending') : undefined}
                    className={clsx(
                      'border-b border-border px-4 py-2.5 text-xs font-medium text-muted',
                      alignClass[col.align ?? 'left'], col.width, col.hideBelow && hideClass[col.hideBelow],
                    )}
                  >
                    {col.sortValue ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(col.key)}
                        className={clsx('inline-flex items-center gap-1 hover:text-text', active && 'text-text')}
                      >
                        {col.header}
                        {active && (sort!.direction === 'asc' ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" />)}
                      </button>
                    ) : col.header}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 && Array.from({ length: 5 }).map((_, i) => (
              <tr key={`skeleton-${i}`}>
                {selection && (
                  <td className="border-b border-border px-4 py-3"><Skeleton className="h-4 w-4" /></td>
                )}
                {columns.map(col => (
                  <td key={col.key} className={clsx('border-b border-border px-4 py-3', col.hideBelow && hideClass[col.hideBelow])}>
                    <Skeleton className="h-4 w-full max-w-[160px]" />
                  </td>
                ))}
              </tr>
            ))}
            {!error && visible.map(row => {
              const key = rowKey(row)
              const selectable = selection?.isRowSelectable?.(row) ?? true
              return (
                <tr
                  key={key}
                  {...rowProps(row)}
                  className={clsx(
                    'border-b border-border last:border-b-0',
                    onRowClick && 'cursor-pointer hover:bg-surface-subtle focus:outline-none focus-visible:bg-surface-subtle focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand',
                    selectedKey === key && 'bg-brand-soft hover:bg-brand-soft',
                  )}
                >
                  {selection && (
                    <td className="px-4 py-3 align-middle" onClick={e => e.stopPropagation()}>
                      {selectable && (
                        <input
                          type="checkbox"
                          aria-label="Select row"
                          className="h-4 w-4 rounded border-border-strong accent-brand cursor-pointer"
                          checked={selection.selectedKeys.has(key)}
                          onChange={() => selection.onToggleRow(key, row)}
                        />
                      )}
                    </td>
                  )}
                  {columns.map(col => (
                    <td
                      key={col.key}
                      className={clsx(
                        'break-words px-4 py-3 align-middle text-text',
                        alignClass[col.align ?? 'left'], col.hideBelow && hideClass[col.hideBelow], col.className,
                      )}
                    >
                      {col.cell(row)}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
        {body}
      </div>

      {/* Stacked layout (phones) */}
      <div className="md:hidden">
        <p className="sr-only">{caption}</p>
        {loading && rows.length === 0 && (
          <div className="space-y-3 p-4">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
        )}
        {!error && (
          <ul className="divide-y divide-border">
            {visible.map(row => {
              const key = rowKey(row)
              const selectable = selection?.isRowSelectable?.(row) ?? true
              return (
                <li
                  key={key}
                  {...rowProps(row)}
                  className={clsx('space-y-1.5 px-4 py-3', onRowClick && 'cursor-pointer active:bg-surface-subtle focus-visible:bg-surface-subtle', selectedKey === key && 'bg-brand-soft')}
                >
                  {selection && selectable && (
                    <div className="flex justify-end" onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label="Select row"
                        className="h-4 w-4 rounded border-border-strong accent-brand cursor-pointer"
                        checked={selection.selectedKeys.has(key)}
                        onChange={() => selection.onToggleRow(key, row)}
                      />
                    </div>
                  )}
                  {columns.filter(c => !c.hideOnMobile).map((col, i) => (
                    <div key={col.key} className={clsx('flex items-start justify-between gap-4 text-sm', i === 0 && 'font-medium')}>
                      {i > 0 && <span className="shrink-0 text-xs text-muted">{col.header}</span>}
                      <span className={clsx('min-w-0 break-words text-text', i > 0 && 'text-right')}>{col.cell(row)}</span>
                    </div>
                  ))}
                </li>
              )
            })}
          </ul>
        )}
        {body}
      </div>

      {!error && sorted.length > pageSize && (
        <div className="flex items-center justify-between gap-4 border-t border-border px-4 py-2 text-sm text-muted">
          <span className="tabular">
            {page * pageSize + 1}–{Math.min(sorted.length, (page + 1) * pageSize)} of {sorted.length}
          </span>
          <div className="flex items-center gap-1">
            <IconButton size="sm" label="Previous page" icon={<ChevronLeft size={16} />} disabled={page === 0} onClick={() => setPage(p => p - 1)} />
            <span className="px-2 tabular">{page + 1} / {pageCount}</span>
            <IconButton size="sm" label="Next page" icon={<ChevronRight size={16} />} disabled={page >= pageCount - 1} onClick={() => setPage(p => p + 1)} />
          </div>
        </div>
      )}
    </div>
  )
}
