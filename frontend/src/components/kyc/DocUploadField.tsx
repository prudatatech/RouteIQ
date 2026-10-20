import { useState, type DragEvent } from 'react'
import { Upload, CheckCircle2, FileText, Trash2, Eye, AlertCircle } from 'lucide-react'
import { Button, FileButton, StatusPill } from '@/components/ui'
import toast from 'react-hot-toast'
import clsx from 'clsx'

/** One document slot: upload, view or remove, with drag-and-drop and a reviewer's flag (if any) shown inline. */
export function DocUploadField({ label, hint, path, issue, busy, onUpload, onRemove, onView }: {
  label: string
  hint?: string
  path?: string
  /** Set when a reviewer flagged this specific document; re-uploading clears it. */
  issue?: string
  busy?: boolean
  onUpload: (file: File) => void
  onRemove: () => void
  onView: () => void
}) {
  const [isDragging, setIsDragging] = useState(false)

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    if (busy || path) return
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    if (!/\.(pdf|jpg|jpeg|png)$/i.test(file.name)) {
      toast.error('Only PDF, JPG, and PNG files are accepted.')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('File size must be under 2 MB.')
      return
    }
    onUpload(file)
  }

  const handleFileSelect = (file: File) => {
    if (file.size > 2 * 1024 * 1024) {
      toast.error('File size must be under 2 MB.')
      return
    }
    onUpload(file)
  }

  const fileName = path ? path.split('/').pop() : null

  return (
    <div
      onDragOver={e => { e.preventDefault(); if (!path && !busy) setIsDragging(true) }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      className={clsx(
        'group relative flex flex-col justify-between rounded-card border p-4 transition-all duration-200',
        path
          ? 'border-brand/40 bg-surface hover:border-brand/70'
          : isDragging
            ? 'border-dashed border-brand bg-brand-fill/40 ring-2 ring-brand/30'
            : issue
              ? 'border-warning bg-warning/5'
              : 'border-dashed border-border-strong bg-surface-subtle hover:border-brand/50 hover:bg-surface'
      )}
    >
      <div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {path ? (
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control bg-brand-soft text-brand">
                <FileText size={15} />
              </div>
            ) : (
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control bg-surface text-muted border border-border">
                <Upload size={14} />
              </div>
            )}
            <p className="truncate text-sm font-semibold text-text">{label}</p>
          </div>
          {issue ? (
            <StatusPill tone="warning" dot={false}>Fix requested</StatusPill>
          ) : path ? (
            <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-success bg-success/10 px-2 py-0.5 rounded-full">
              <CheckCircle2 size={12} /> Uploaded
            </span>
          ) : null}
        </div>

        {hint && <p className="mt-1.5 text-xs text-muted">{hint}</p>}
        {issue && <p className="mt-1 text-xs text-warning flex items-center gap-1"><AlertCircle size={12} /> {issue}</p>}
        {path && fileName && (
          <p className="mt-2 truncate font-mono text-xs text-muted">
            {fileName}
          </p>
        )}
      </div>

      <div className="mt-4 flex items-center gap-2 border-t border-border/60 pt-3">
        {path ? (
          <>
            <Button type="button" variant="secondary" size="sm" icon={<Eye size={13} />} onClick={onView}>
              View
            </Button>
            <Button type="button" variant="ghost" size="sm" icon={<Trash2 size={13} />} onClick={onRemove}>
              Remove
            </Button>
          </>
        ) : (
          <div className="flex items-center gap-2">
            <FileButton
              variant="secondary"
              size="sm"
              icon={<Upload size={13} />}
              accept=".pdf,.jpg,.jpeg,.png"
              disabled={busy}
              loading={busy}
              onFile={handleFileSelect}
            >
              {busy ? 'Uploading…' : 'Upload'}
            </FileButton>
            <span className="text-xs text-muted">or drop here (max 2MB)</span>
          </div>
        )}
      </div>
    </div>
  )
}
