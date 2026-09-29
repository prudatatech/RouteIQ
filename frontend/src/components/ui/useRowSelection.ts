import { useCallback, useMemo, useState } from 'react'

/**
 * Multi-select state for a DataTable. Selection is tracked by row key so it
 * survives sorting and paging; `toggleAll` only ever touches the rows it is
 * given (the caller passes the current page's rows for "select all on page").
 */
export function useRowSelection<T>(rows: T[], rowKey: (row: T) => string) {
  const [selectedKeys, setSelectedKeys] = useState<ReadonlySet<string>>(new Set())

  const toggleRow = useCallback((key: string) => {
    setSelectedKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const toggleAll = useCallback((pageRows: T[], checked: boolean) => {
    setSelectedKeys(prev => {
      const next = new Set(prev)
      for (const row of pageRows) {
        const key = rowKey(row)
        if (checked) next.add(key)
        else next.delete(key)
      }
      return next
    })
  }, [rowKey])

  const clear = useCallback(() => setSelectedKeys(new Set()), [])

  const selectedRows = useMemo(() => rows.filter(row => selectedKeys.has(rowKey(row))), [rows, selectedKeys, rowKey])

  return { selectedKeys, toggleRow, toggleAll, clear, selectedRows, count: selectedKeys.size }
}
