import { Drawer, EmptyState, Spinner } from '@/components/ui'
import { formatDateTime } from '@/utils/display'
import type { DocumentEvent, LoadDocument } from '@/types/loadDocuments'
import { KIND_LABELS } from './model'

const show = (v: unknown) => (v === null || v === undefined || v === '' ? 'empty' : typeof v === 'object' ? JSON.stringify(v) : String(v))

const ACTIONS: Record<string, string> = {
  created: 'Added', updated: 'Changed', uploaded: 'File uploaded', generated: 'Made', status: 'Status changed',
}

/** Who created or changed a document, and what changed. */
export function DocumentHistory({ doc, events, loading, onClose }: {
  doc: LoadDocument | null
  events: DocumentEvent[]
  loading: boolean
  onClose: () => void
}) {
  return (
    <Drawer open={!!doc} onClose={onClose} title="History" size="md"
      description={doc ? `${KIND_LABELS[doc.kind]}${doc.number ? ` ${doc.number}` : ''}` : undefined}>
      {loading ? <div className="flex justify-center py-10"><Spinner label="Loading history" /></div>
        : events.length === 0 ? <EmptyState compact title="No changes recorded" />
          : (
            <ol className="space-y-4">
              {events.map((e, i) => (
                <li key={`${e.at}-${i}`} className="border-l-2 border-border pl-3">
                  <p className="text-sm font-medium text-text">{ACTIONS[e.action] ?? e.action}</p>
                  <p className="text-xs text-muted">{formatDateTime(e.at)}{e.by_name || e.by ? ` · ${e.by_name ?? e.by}` : ''}{e.by_role ? ` (${e.by_role})` : ''}{e.version ? ` · version ${e.version}` : ''}</p>
                  {e.changes && Object.keys(e.changes).length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-xs text-muted">
                      {Object.entries(e.changes).map(([k, v]) => (
                        <li key={k}><span className="font-medium">{k.replace(/^fields\./, '').replace(/_/g, ' ')}</span>: {show(v?.from)} → {show(v?.to)}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
          )}
    </Drawer>
  )
}
