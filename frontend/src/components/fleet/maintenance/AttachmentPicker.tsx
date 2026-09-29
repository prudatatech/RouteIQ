import { useState } from 'react'
import { Paperclip, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { FileButton, IconButton } from '@/components/ui'
import { ATTACHMENT_ACCEPT, MAX_ATTACHMENT_MB, uploadServiceFile } from './attachments'
import { ATTACHMENT_KIND_LABELS, type AttachmentInput, type AttachmentKind } from './types'

/**
 * Attach invoices, job cards and photos. Each file uploads as soon as it is chosen; what comes back
 * goes in with the record when it is saved.
 */
export function AttachmentPicker({ vehicleId, value, onChange, label = 'Attach invoice, job card or photos' }: {
  vehicleId: string
  value: AttachmentInput[]
  onChange: (next: AttachmentInput[]) => void
  label?: string
}) {
  const [uploading, setUploading] = useState(false)

  const add = async (file: File) => {
    setUploading(true)
    try {
      const uploaded = await uploadServiceFile(vehicleId, file)
      onChange([...value, uploaded])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'We could not upload the file.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <FileButton variant="secondary" size="sm" icon={<Paperclip size={14} />} accept={ATTACHMENT_ACCEPT} loading={uploading} onFile={add}>
          {label}
        </FileButton>
        <span className="text-xs text-muted">PDF, JPG or PNG, up to {MAX_ATTACHMENT_MB} MB each</span>
      </div>
      {value.length > 0 && (
        <ul className="divide-y divide-border rounded-control border border-border">
          {value.map((a, i) => (
            <li key={a.path} className="flex items-center gap-2 px-3 py-1.5 text-sm">
              <span className="min-w-0 flex-1 truncate text-text">{a.file_name}</span>
              <select
                aria-label={`Type of ${a.file_name}`}
                value={a.kind}
                onChange={e => onChange(value.map((x, j) => (j === i ? { ...x, kind: e.target.value as AttachmentKind } : x)))}
                className="h-8 rounded-control border border-border-strong bg-surface px-2 text-sm text-text"
              >
                {(Object.keys(ATTACHMENT_KIND_LABELS) as AttachmentKind[]).map(k => <option key={k} value={k}>{ATTACHMENT_KIND_LABELS[k]}</option>)}
              </select>
              <IconButton label={`Remove ${a.file_name}`} size="sm" icon={<X size={14} />} onClick={() => onChange(value.filter((_, j) => j !== i))} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
