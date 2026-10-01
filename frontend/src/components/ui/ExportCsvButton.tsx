import { Download } from 'lucide-react'
import { downloadCsv, toCsv, type CsvColumn } from '@/utils/csv'
import { Button } from './Button'

/** The "Export CSV" button every list uses: same label, icon and file naming (`name-2026-10-01.csv`). */
export function ExportCsvButton({ name, rows, columns, size = 'md' }: {
  /** File name without the date or extension, e.g. `bids`. */
  name: string
  rows: Record<string, string | number | null | undefined>[]
  columns: CsvColumn[]
  size?: 'sm' | 'md'
}) {
  return (
    <Button
      variant="secondary"
      size={size}
      icon={<Download size={16} />}
      disabled={rows.length === 0}
      onClick={() => downloadCsv(`${name}-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows, columns))}
    >
      Export CSV
    </Button>
  )
}
