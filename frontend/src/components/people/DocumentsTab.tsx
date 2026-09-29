import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Archive, Check, Eye, FileUp, Plus, TriangleAlert, X } from 'lucide-react'
import { peopleAPI } from '@/services/api'
import { Alert, Button, Card, CardHeader, StatusPill, useConfirm } from '@/components/ui'
import DocumentViewerModal from '@/components/ui/DocumentViewerModal'
import { errorMessage, formatDate } from '@/utils/display'
import { DOC_STATE_LABEL, maskedNumber, DOC_STATE_TONE, daysUntil, docState, groupStatuses, liveDocuments, type GroupStatus } from './docs'
import { UploadDocModal } from './UploadDocModal'
import { docLabel, requiredDocTypes, type PersonDetail, type PersonDocument } from './types'
import { namesDiffer } from './validators'

function expiryText(doc: PersonDocument) {
  const parts: string[] = []
  if (doc.expires_on) {
    const days = daysUntil(doc.expires_on)
    const when = formatDate(doc.expires_on)
    if (days === null) parts.push(`Expires ${when}`)
    else if (days < 0) parts.push(`Expired ${when}`)
    else if (days <= 30) parts.push(`Expires ${when} (${days === 0 ? 'today' : `in ${days} ${days === 1 ? 'day' : 'days'}`})`)
    else parts.push(`Expires ${when}`)
  }
  if (doc.review_by) parts.push(`Review by ${formatDate(doc.review_by)}`)
  return parts.join(' · ')
}

export function DocumentsTab({ detail, canEdit, canAdmin }: { detail: PersonDetail; canEdit: boolean; canAdmin: boolean }) {
  const { user, documents, profile } = detail
  const queryClient = useQueryClient()
  const { confirm, prompt } = useConfirm()
  const [upload, setUpload] = useState<{ types: string[] | null; replacing?: string } | null>(null)
  const [viewing, setViewing] = useState<{ url: string; name: string } | null>(null)
  const [opening, setOpening] = useState<string | null>(null)

  const live = liveDocuments(documents)
  const groups = groupStatuses(user.role, documents, profile?.no_pan_reason)
  const inGroup = new Set(requiredDocTypes(user.role))
  const others = live.filter(d => !inGroup.has(d.doc_type))
  const missing = groups.filter(g => g.state === 'missing')
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['people'] })

  const review = useMutation({
    mutationFn: ({ doc, data }: { doc: PersonDocument; data: Record<string, unknown> }) => peopleAPI.updateDocument(user.id, doc.id, data),
    onSuccess: (_d, { data }) => { toast.success(data.status === 'verified' ? 'Document verified' : 'Document rejected'); refresh() },
    onError: err => toast.error(errorMessage(err, 'We could not update this document. Try again.')),
  })
  const archive = useMutation({
    mutationFn: (doc: PersonDocument) => peopleAPI.archiveDocument(user.id, doc.id),
    onSuccess: () => { toast.success('Document archived'); refresh() },
    onError: err => toast.error(errorMessage(err, 'We could not archive this document. Try again.')),
  })
  const noPan = useMutation({
    mutationFn: (reason: string | null) => peopleAPI.update(user.id, { profile: { no_pan_reason: reason }, updated_at: profile?.updated_at }),
    onSuccess: (_d, reason) => { toast.success(reason ? 'Marked as no PAN' : 'No PAN removed'); refresh() },
    onError: err => toast.error(errorMessage(err, 'We could not save this. Try again.')),
  })

  const view = async (doc: PersonDocument, index?: number) => {
    const key = `${doc.id}:${index ?? 'main'}`
    setOpening(key)
    try {
      const { url } = await peopleAPI.documentFile(user.id, doc.id, index)
      setViewing({ url, name: `${docLabel(doc.doc_type)}${index === undefined ? '' : ` (page ${index + 2})`}` })
    } catch (err) {
      toast.error(errorMessage(err, 'We could not open this file. Try again.'))
    } finally {
      setOpening(null)
    }
  }

  const verify = async (doc: PersonDocument) => {
    if (namesDiffer(doc.name_on_document, user.full_name)) {
      const note = await prompt({
        title: 'Verify with a different name?',
        message: `The document says "${doc.name_on_document}" but the profile says "${user.full_name}". Say why this is the same person.`,
        inputLabel: 'Note', required: true, confirmLabel: 'Verify with note',
      })
      if (note) review.mutate({ doc, data: { status: 'verified', verification_note: note } })
      return
    }
    review.mutate({ doc, data: { status: 'verified' } })
  }
  const reject = async (doc: PersonDocument) => {
    const reason = await prompt({
      title: `Reject ${docLabel(doc.doc_type).toLowerCase()}?`,
      message: 'The person is told why and can upload a new file.',
      inputLabel: 'Reason', required: true, confirmLabel: 'Reject document', tone: 'danger',
    })
    if (reason) review.mutate({ doc, data: { status: 'rejected', rejection_reason: reason } })
  }
  const archiveDoc = async (doc: PersonDocument) => {
    const ok = await confirm({ title: `Archive ${docLabel(doc.doc_type).toLowerCase()}?`, message: 'It is hidden from the list but kept on record.', confirmLabel: 'Archive document', tone: 'danger' })
    if (ok) archive.mutate(doc)
  }
  const markNoPan = async () => {
    const reason = await prompt({
      title: 'This person has no PAN',
      message: 'This counts as the tax ID for now. Say why, for example a foreign national or no income tax number yet.',
      inputLabel: 'Reason', required: true, confirmLabel: 'Save reason',
    })
    if (reason) noPan.mutate(reason)
  }

  const docRow = (doc: PersonDocument, groupLabel?: string) => {
    const state = docState(doc)
    const number = maskedNumber(doc)
    const title = doc.doc_type === 'other' && typeof doc.metadata?.title === 'string' ? doc.metadata.title : docLabel(doc.doc_type)
    const classes = Array.isArray(doc.metadata?.licence_classes) ? (doc.metadata!.licence_classes as string[]).join(', ') : null
    const mismatch = namesDiffer(doc.name_on_document, user.full_name)
    const busy = review.isPending && review.variables?.doc.id === doc.id
    const extras = doc.extra_file_paths ?? []
    return (
      <li key={doc.id} className="space-y-2 px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-text">
              {groupLabel ? `${groupLabel}: ${title}` : title}
              {inGroup.has(doc.doc_type) && <span className="ml-2 text-xs font-normal text-muted">Required</span>}
            </p>
            <p className="text-xs text-muted">
              {[number && <span key="n" className="font-mono">{number}</span>, classes && `Classes ${classes}`,
                doc.issued_on && `Issued ${formatDate(doc.issued_on)}`, expiryText(doc)]
                .filter(Boolean).map((x, i) => <span key={i}>{i > 0 && ' · '}{x}</span>)}
            </p>
            {doc.status === 'rejected' && doc.rejection_reason && <p className="mt-1 text-xs text-danger">Reason: {doc.rejection_reason}</p>}
            {(doc.resubmission_count ?? 0) > 0 && <p className="mt-1 text-xs text-muted">Sent again {doc.resubmission_count} {doc.resubmission_count === 1 ? 'time' : 'times'} after rejection</p>}
            {mismatch && (
              <p className="mt-1 flex items-start gap-1 text-xs text-warning">
                <TriangleAlert size={14} className="mt-px shrink-0" aria-hidden="true" />
                The name on this document is "{doc.name_on_document}". The profile says "{user.full_name}".
              </p>
            )}
            {doc.verification_note && <p className="mt-1 text-xs text-muted">Verified with note: {doc.verification_note}</p>}
          </div>
          <StatusPill tone={DOC_STATE_TONE[state]}>{DOC_STATE_LABEL[state]}</StatusPill>
        </div>
        <div className="flex flex-wrap gap-2">
          {doc.file_path && <Button variant="secondary" size="sm" icon={<Eye size={16} />} loading={opening === `${doc.id}:main`} onClick={() => view(doc)}>View file</Button>}
          {extras.map((_p, i) => (
            <Button key={i} variant="secondary" size="sm" icon={<Eye size={16} />} loading={opening === `${doc.id}:${i}`} onClick={() => view(doc, i)}>
              {extras.length === 1 ? 'View back page' : `View page ${i + 2}`}
            </Button>
          ))}
          {canEdit && <Button variant="secondary" size="sm" icon={<FileUp size={16} />} onClick={() => setUpload({ types: [doc.doc_type], replacing: doc.doc_type })}>Replace</Button>}
          {canEdit && doc.status === 'pending' && (
            <>
              <Button size="sm" icon={<Check size={16} />} loading={busy && review.variables?.data.status === 'verified'} disabled={busy} onClick={() => verify(doc)}>
                {mismatch ? 'Verify with note' : 'Verify'}
              </Button>
              <Button variant="danger" size="sm" icon={<X size={16} />} disabled={busy} onClick={() => reject(doc)}>Reject</Button>
            </>
          )}
          {canAdmin && <Button variant="ghost" size="sm" icon={<Archive size={16} />} onClick={() => archiveDoc(doc)}>Archive</Button>}
        </div>
      </li>
    )
  }

  const groupRow = (g: GroupStatus) => {
    if (g.doc) return docRow(g.doc, g.group.types.length > 1 ? g.group.label : undefined)
    const help = g.group.types.length > 1 ? g.group.types.map(docLabel).join(', ').replace(/, ([^,]*)$/, ' or $1') : null
    return (
      <li key={g.group.key} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-text">{g.group.label}</p>
          <p className="text-xs text-muted">
            {g.state === 'waived' ? `No PAN: ${profile?.no_pan_reason}` : help ? `Any one of: ${help}` : `Required for ${user.role === 'driver' ? 'drivers' : 'staff'}`}
          </p>
        </div>
        <StatusPill tone={g.state === 'waived' ? 'neutral' : 'warning'} dot={false}>{g.state === 'waived' ? 'Not applicable' : 'Missing'}</StatusPill>
        {canEdit && <Button size="sm" icon={<FileUp size={16} />} onClick={() => setUpload({ types: g.group.types })}>Upload</Button>}
        {canAdmin && g.group.waivable && (g.state === 'waived'
          ? <Button variant="ghost" size="sm" loading={noPan.isPending} onClick={() => noPan.mutate(null)}>Undo no PAN</Button>
          : <Button variant="ghost" size="sm" onClick={markNoPan}>No PAN</Button>)}
      </li>
    )
  }

  return (
    <div className="space-y-4">
      {missing.length > 0 && (
        <Alert tone="warning" title={`${missing.length} required ${missing.length === 1 ? 'document is' : 'documents are'} missing`}>
          {missing.map(g => g.group.label).join(', ')}. Upload {missing.length === 1 ? 'it' : 'them'} below.
        </Alert>
      )}
      <Card>
        <CardHeader
          title="Documents"
          description="Required documents for this role are always listed. Files open through a link that stops working after 10 minutes."
          actions={canEdit && <Button variant="secondary" size="sm" icon={<Plus size={16} />} onClick={() => setUpload({ types: null })}>Add document</Button>}
        />
        <ul className="divide-y divide-border">
          {groups.map(groupRow)}
          {others.map(d => docRow(d))}
          {groups.length === 0 && others.length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-muted">No documents yet. Use Add document to upload the first one.</li>
          )}
        </ul>
      </Card>

      {upload && <UploadDocModal detail={detail} types={upload.types} replacing={upload.replacing} onClose={() => setUpload(null)} onDone={refresh} />}
      {viewing && <DocumentViewerModal isOpen onClose={() => setViewing(null)} fileUrl={viewing.url} fileName={viewing.name} />}
    </div>
  )
}
