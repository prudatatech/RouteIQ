import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Download, Upload } from 'lucide-react'
import { vendorAPI } from '@/services/api'
import { Alert, Button, Card, FileButton } from '@/components/ui'
import { errorMessage } from '@/utils/display'
import type { BulkResult } from '@/types/load'

/** Saves a blob under a name, through a temporary link. */
function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Post many loads from one CSV file: one load per row. Valid rows are posted, the rest are listed with the reason. */
export default function BulkUpload() {
  const qc = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [result, setResult] = useState<BulkResult | null>(null)

  const downloadTemplate = async () => {
    setDownloading(true)
    try {
      saveBlob(await vendorAPI.bulkTemplate(), 'margix-bulk-loads-template.csv')
    } catch (err) {
      toast.error(errorMessage(err, 'We could not download the template. Try again.'))
    } finally {
      setDownloading(false)
    }
  }

  const upload = useMutation({
    mutationFn: async (f: File) => vendorAPI.bulkPost(await f.text(), f.name),
    onSuccess: res => {
      setResult(res)
      setFile(null)
      qc.invalidateQueries({ queryKey: ['vendor', 'posted-loads'] })
    },
    onError: err => toast.error(errorMessage(err, 'We could not read this file. Check it and try again.')),
  })

  return (
    <section aria-labelledby="bulk-upload-title" className="space-y-3">
      <h2 id="bulk-upload-title" className="text-lg font-semibold text-text">Bulk upload</h2>
      <Card padded className="space-y-3 !p-4">
        <p className="text-sm text-muted">Post up to 50 loads at once. Download the template, fill one row per load, then upload it.</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" icon={<Download size={14} />} loading={downloading} onClick={downloadTemplate}>Download template</Button>
          <FileButton size="sm" accept=".csv,text/csv" icon={<Upload size={14} />} onFile={setFile}>{file ? 'Change file' : 'Choose CSV file'}</FileButton>
          {file && <span className="break-all text-xs text-muted">{file.name}</span>}
          <Button size="sm" disabled={!file} loading={upload.isPending} onClick={() => file && upload.mutate(file)}>Upload loads</Button>
        </div>

        {result && (
          <div className="space-y-2" aria-live="polite">
            <Alert
              tone={result.errors.length ? 'warning' : 'success'}
              title={`${result.loads.length} ${result.loads.length === 1 ? 'load' : 'loads'} posted${result.errors.length ? `, ${result.errors.length} with problems` : ''}`}
            >
              {result.errors.length > 0 ? 'Fix the rows below in your file and upload just those rows again.' : 'They are in Posted loads.'}
            </Alert>
            {result.loads.length > 0 && (
              <ul className="divide-y divide-border rounded-card border border-border bg-surface text-sm" aria-label="Posted rows">
                {result.loads.map(l => (
                  <li key={l.id} className="flex justify-between gap-3 px-3 py-2">
                    <span className="text-muted">Row {l.row}</span>
                    <span className="font-mono text-text">{l.load_number}</span>
                  </li>
                ))}
              </ul>
            )}
            {result.errors.length > 0 && (
              <ul className="divide-y divide-border rounded-card border border-border bg-surface text-sm" aria-label="Rows with problems">
                {result.errors.map((e, i) => (
                  <li key={`${e.row}-${i}`} className="flex gap-3 px-3 py-2">
                    <span className="shrink-0 text-muted">Row {e.row}</span>
                    <span className="text-danger">{e.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Card>
    </section>
  )
}
