/**
 * Shared CSV export helper (RFC4180): build a CSV string from rows and download it
 * as a file. Used by every page's "Export CSV" button.
 */

export interface CsvColumn {
  key: string
  header: string
}

/** Wraps a field in quotes (doubling internal quotes) when it contains a comma, quote or newline. */
function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

function toField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  return escapeCsvField(String(value))
}

/** Builds an RFC4180 CSV string (CRLF line endings, header row first) from rows and columns. */
export function toCsv(rows: Record<string, string | number | null | undefined>[], columns: CsvColumn[]): string {
  const lines = [columns.map(c => toField(c.header)).join(',')]
  for (const row of rows) {
    lines.push(columns.map(c => toField(row[c.key])).join(','))
  }
  return lines.join('\r\n')
}

/** Triggers a browser download of `csv` as a UTF-8 CSV file named `filename`. */
export function downloadCsv(filename: string, csv: string): void {
  const BOM = '﻿'
  const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
