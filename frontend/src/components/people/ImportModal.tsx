import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { FileUp } from 'lucide-react'
import { peopleAPI } from '@/services/api'
import { Alert, Button, FileButton, Modal, StatusPill } from '@/components/ui'
import { errorMessage } from '@/utils/display'
import type { ImportReport, ImportRow } from './types'

const ROW_TONE = { ok: 'success', error: 'danger', duplicate: 'warning' } as const
const ROW_LABEL = { ok: 'Ready', error: 'Error', duplicate: 'Already on file' } as const

/** Bulk add from a CSV: a dry run shows every row's result first, and nothing is created until you commit. */
export function ImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [report, setReport] = useState<ImportReport | null>(null)
  const [error, setError] = useState('')

  const close = () => { setFile(null); setReport(null); setError(''); onClose() }

  const check = useMutation({
    mutationFn: (f: File) => peopleAPI.importCsv(f, false),
    onSuccess: r => { setReport(r); setError('') },
    onError: err => { setReport(null); setError(errorMessage(err, 'We could not read this file. Use a CSV with the columns listed above.')) },
  })
  const commit = useMutation({
    mutationFn: () => peopleAPI.importCsv(file!, true),
    onSuccess: r => {
      toast.success(`${(r.created ?? report?.rows.filter(x => x.status === 'ok').length ?? 0).toLocaleString('en-IN')} people added`)
      queryClient.invalidateQueries({ queryKey: ['people'] })
      close()
    },
    onError: err => setError(errorMessage(err, 'We could not add these people. Nothing was saved. Try again.')),
  })

  const choose = (f: File) => {
    if (f.size > 2 * 1024 * 1024) { setError('The file is over 2 MB. Split it into smaller files.'); return }
    setFile(f); setReport(null); setError('')
    check.mutate(f)
  }

  const rows = report?.rows ?? []
  const ok = rows.filter(r => r.status === 'ok').length
  const bad = rows.length - ok

  const detail = (r: ImportRow) => r.status === 'duplicate' && r.duplicate_of
    ? <>Same as <Link to={`/admin/users/${r.duplicate_of.id}`} onClick={close} className="text-brand hover:underline">{r.duplicate_of.full_name ?? 'an existing person'}</Link></>
    : (r.errors ?? []).join(' ')

  return (
    <Modal
      open={open}
      onClose={close}
      size="lg"
      title="Import people"
      description="Add many people at once from a CSV file. You see the result for every row before anything is saved."
      closeOnBackdrop={!commit.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={commit.isPending}>Cancel</Button>
          <Button loading={commit.isPending} disabled={!report || ok === 0} onClick={() => commit.mutate()}>
            {ok > 0 ? `Add ${ok.toLocaleString('en-IN')} ${ok === 1 ? 'person' : 'people'}` : 'Add people'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Columns: <span className="font-mono text-xs">name, role, phone, email, employee code, designation, department, joining date</span>.
          Drivers need a phone; staff need an email. Joining date is YYYY-MM-DD.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <FileButton accept=".csv,text/csv" icon={<FileUp size={16} />} loading={check.isPending} onFile={choose}>{file ? 'Choose a different file' : 'Choose CSV file'}</FileButton>
          {file && <span className="text-sm text-text">{file.name}</span>}
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
        {report && (
          <>
            <Alert tone={bad === 0 ? 'success' : 'warning'} title={`${ok.toLocaleString('en-IN')} of ${rows.length.toLocaleString('en-IN')} rows are ready`}>
              {bad === 0 ? 'Nothing is saved yet. Check the rows, then add them.' : `${bad.toLocaleString('en-IN')} ${bad === 1 ? 'row' : 'rows'} will be skipped. Fix them in the file and choose it again, or add the ready ones now.`}
            </Alert>
            <div className="max-h-72 overflow-auto rounded-control border border-border">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Import results by row</caption>
                <thead className="sticky top-0 bg-surface-subtle text-xs text-muted">
                  <tr><th scope="col" className="px-3 py-2 font-medium">Row</th><th scope="col" className="px-3 py-2 font-medium">Name</th><th scope="col" className="px-3 py-2 font-medium">Result</th><th scope="col" className="px-3 py-2 font-medium">Details</th></tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map(r => (
                    <tr key={r.row}>
                      <td className="px-3 py-2 tabular text-muted">{r.row}</td>
                      <td className="px-3 py-2 text-text">{r.name || '—'}</td>
                      <td className="px-3 py-2"><StatusPill tone={ROW_TONE[r.status]} dot={false}>{ROW_LABEL[r.status]}</StatusPill></td>
                      <td className="px-3 py-2 text-muted">{detail(r)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
