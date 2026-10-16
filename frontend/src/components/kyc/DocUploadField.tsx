import { Upload } from 'lucide-react'
import { Button, FileButton, StatusPill } from '@/components/ui'

/** One document slot: upload, view or remove, with a reviewer's flag (if any) shown inline. Shared by vendor and company KYC. */
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
  return (
    <div className={`rounded-card border p-4 ${issue ? 'border-warning bg-warning/5' : 'border-border'}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-text">{label}</p>
        {issue && <StatusPill tone="warning" dot={false}>Fix requested</StatusPill>}
      </div>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      {issue && <p className="mt-1 text-xs text-warning">{issue}</p>}
      <div className="mt-3 flex items-center gap-2">
        {path ? (
          <>
            <Button type="button" variant="secondary" size="sm" onClick={onView}>View</Button>
            <Button type="button" variant="ghost" size="sm" onClick={onRemove}>Remove</Button>
          </>
        ) : (
          <FileButton variant="link" icon={<Upload size={14} />} accept=".pdf,.jpg,.jpeg,.png" disabled={busy} onFile={onUpload}>
            {busy ? 'Uploading…' : 'Upload'}
          </FileButton>
        )}
      </div>
    </div>
  )
}
