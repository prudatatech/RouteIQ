import { Eye, History, Pencil } from 'lucide-react'
import { Button, EmptyState, StatusPill } from '@/components/ui'
import { formatDate } from '@/utils/display'
import type { LoadDocument } from '@/types/loadDocuments'
import { DOC_STATUS, KIND_LABELS, UPLOAD_KINDS, groupByKind, type PanelRole } from './model'

/** Every document on the load, grouped by kind. */
export function DocumentList({ docs, role, onView, onHistory, onEdit, busyId }: {
  docs: LoadDocument[]
  role: PanelRole
  onView: (d: LoadDocument) => void
  onHistory: (d: LoadDocument) => void
  /** Correct an uploaded invoice, challan or e-way bill (for example a new vehicle number). */
  onEdit?: (d: LoadDocument) => void
  busyId?: string | null
}) {
  const groups = groupByKind(docs)
  if (groups.length === 0) {
    return <EmptyState compact title="No documents yet" description="Invoices, challans, e-way bills and transport documents for this load appear here." />
  }
  return (
    <div className="space-y-4">
      {groups.map(group => (
        <section key={group.kind} aria-label={KIND_LABELS[group.kind]}>
          <h4 className="mb-1.5 text-sm font-semibold text-text">{KIND_LABELS[group.kind]}</h4>
          <ul className="divide-y divide-border rounded-card border border-border bg-surface">
            {group.docs.map(d => {
              const st = DOC_STATUS[d.status] ?? { label: d.status, tone: 'neutral' as const }
              const editable = !!onEdit && role !== 'platform' && (UPLOAD_KINDS as string[]).includes(d.kind)
                && d.status !== 'superseded' && d.status !== 'cancelled'
              return (
                <li key={d.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 space-y-0.5">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-text">
                      <span className="break-all">{d.number || 'No number'}</span>
                      <StatusPill tone={st.tone}>{st.label}</StatusPill>
                    </p>
                    <p className="text-xs text-muted">
                      {d.doc_date ? formatDate(d.doc_date) : 'No date'}
                      {d.valid_until && <> · valid until {formatDate(d.valid_until)}</>}
                      {d.version > 1 && <> · version {d.version}</>}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" icon={<Eye size={14} />} loading={busyId === d.id} onClick={() => onView(d)}>View PDF</Button>
                    {editable && <Button size="sm" variant="secondary" icon={<Pencil size={14} />} onClick={() => onEdit!(d)}>Update</Button>}
                    <Button size="sm" variant="ghost" icon={<History size={14} />} onClick={() => onHistory(d)}>History</Button>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
