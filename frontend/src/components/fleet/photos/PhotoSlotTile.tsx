import { Camera, Trash2 } from 'lucide-react'
import { FileButton, IconButton, Spinner } from '@/components/ui'

/** One photo slot: the picture (or an empty box), with add, replace and remove. */
export default function PhotoSlotTile({ label, hint, src, busy, onFile, onRemove, onOpen }: {
  label: string
  hint: string
  src: string | null
  busy?: boolean
  onFile: (file: File) => void
  onRemove?: () => void
  onOpen?: () => void
}) {
  return (
    <div className="min-w-0 space-y-2">
      <div className="relative aspect-[4/3] overflow-hidden rounded-control border border-border bg-surface-subtle">
        {src ? (
          <button type="button" onClick={onOpen} className="block h-full w-full" aria-label={`View the ${label.toLowerCase()} photo`}>
            <img src={src} alt={`${label} of the vehicle`} className="h-full w-full object-cover" />
          </button>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1 px-2 text-center text-xs text-muted">
            <Camera size={20} aria-hidden="true" />
            <span>{hint}</span>
          </div>
        )}
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface/70" role="status" aria-label="Uploading">
            <Spinner size={20} />
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-medium text-text">{label}</span>
        <div className="flex shrink-0 items-center gap-1">
          <FileButton variant="link" accept="image/*" disabled={busy} onFile={onFile}>
            {src ? 'Replace' : 'Add photo'}
          </FileButton>
          {src && onRemove && (
            <IconButton label={`Remove the ${label.toLowerCase()} photo`} icon={<Trash2 size={14} />} size="sm" disabled={busy} onClick={onRemove} />
          )}
        </div>
      </div>
    </div>
  )
}
