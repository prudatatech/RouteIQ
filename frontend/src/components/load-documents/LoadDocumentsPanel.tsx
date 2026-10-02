import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Plus } from 'lucide-react'
import { Button, ErrorState, Spinner } from '@/components/ui'
import { loadDocumentsAPI } from '@/services/api'
import { supabase } from '@/services/supabase'
import { errorMessage } from '@/utils/display'
import type { GenerateKind, LoadDocument, Settlement, UploadUrl } from '@/types/loadDocuments'
import { DispatchChecklist } from './DispatchChecklist'
import { DocumentHistory } from './DocumentHistory'
import { DocumentList } from './DocumentList'
import { GenerateButtons } from './GenerateButtons'
import { LoadTimeline } from './LoadTimeline'
import { PodView } from './PodView'
import { SettlementCard } from './SettlementCard'
import { UploadDocumentForm } from './UploadDocumentForm'
import { canUpload, finalPod, uploadFields, type UploadValues } from './model'

function Section({ title, actions, children }: { title: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-text">{title}</h3>
        {actions}
      </div>
      {children}
    </section>
  )
}

/** Put a file on the signed upload the API gave for it, the way every other upload in the app does. */
async function putFile(upload: UploadUrl, file: File) {
  const { error } = await supabase.storage.from(upload.bucket).uploadToSignedUrl(upload.path, upload.token, file, { contentType: file.type })
  if (error) throw new Error('The file could not be uploaded. Try again.')
}

/**
 * Documents for one vendor load: the pre-dispatch checklist, every document, delivery proof,
 * settlement and the timeline. `role` decides what can be done: the vendor adds its own invoice,
 * challan and e-way bill; the logistic company also makes transport documents and closes the trip;
 * platform staff read only.
 */
export function LoadDocumentsPanel({ loadId, role }: { loadId: string; role: 'vendor' | 'carrier' | 'platform' }) {
  const qc = useQueryClient()
  const [uploadOpen, setUploadOpen] = useState(false)
  const [editing, setEditing] = useState<LoadDocument | null>(null)
  const [historyDoc, setHistoryDoc] = useState<LoadDocument | null>(null)
  const [viewingId, setViewingId] = useState<string | null>(null)
  const [generating, setGenerating] = useState<GenerateKind | null>(null)

  const key = (part: string) => ['load-documents', loadId, part]
  const refreshAll = () => qc.invalidateQueries({ queryKey: ['load-documents', loadId] })

  const docs = useQuery({ queryKey: key('docs'), queryFn: () => loadDocumentsAPI.list(loadId) })
  const check = useQuery({ queryKey: key('check'), queryFn: () => loadDocumentsAPI.dispatchCheck(loadId) })
  const timeline = useQuery({ queryKey: key('timeline'), queryFn: () => loadDocumentsAPI.timeline(loadId) })
  const history = useQuery({
    queryKey: key(`history-${historyDoc?.id}`),
    queryFn: () => loadDocumentsAPI.history(loadId, historyDoc!.id),
    enabled: !!historyDoc,
  })
  // A load with no settlement yet answers 404, which the API client turns into null.
  const settlement = useQuery<Settlement | null>({
    queryKey: key('settlement'),
    queryFn: () => loadDocumentsAPI.settlement(loadId),
  })

  const fail = (fallback: string) => (err: unknown) => toast.error(errorMessage(err, fallback))
  const items = docs.data?.documents ?? []

  const save = useMutation({
    mutationFn: async ({ values, file }: { values: UploadValues; file: File | null }) => {
      let file_path: string | undefined
      if (file) {
        const upload = await loadDocumentsAPI.uploadUrl(loadId, { kind: values.kind, content_type: file.type, size: file.size })
        await putFile(upload, file)
        file_path = upload.path
      }
      const body = {
        number: values.number.trim(),
        doc_date: values.doc_date,
        fields: uploadFields(values),
        ...(values.kind === 'eway_bill' ? { valid_until: values.valid_until } : {}),
        ...(file_path ? { file_path } : {}),
      }
      return editing
        ? loadDocumentsAPI.update(loadId, editing.id, body)
        : loadDocumentsAPI.create(loadId, { kind: values.kind, ...body })
    },
    onSuccess: () => { toast.success('Saved.'); setUploadOpen(false); setEditing(null); refreshAll() },
    onError: fail('We could not save this document. Try again.'),
  })

  const generate = useMutation({
    mutationFn: (kind: GenerateKind) => { setGenerating(kind); return loadDocumentsAPI.generate(loadId, kind) },
    onSuccess: () => { toast.success('Document made.'); refreshAll() },
    onError: fail('We could not make this document. Try again.'),
    onSettled: () => setGenerating(null),
  })

  const view = async (d: LoadDocument) => {
    setViewingId(d.id)
    try {
      const res = await loadDocumentsAPI.pdf(loadId, d.id)
      if ('blob' in res) {
        const url = URL.createObjectURL(res.blob)
        window.open(url, '_blank', 'noopener')
        setTimeout(() => URL.revokeObjectURL(url), 60_000)
      } else {
        window.open(res.url, '_blank', 'noopener')
      }
    } catch (err) {
      toast.error(errorMessage(err, 'We could not open this document. Try again.'))
    } finally {
      setViewingId(null)
    }
  }

  const settle = useMutation({
    mutationFn: (run: () => Promise<Settlement>) => run(),
    onSuccess: s => { qc.setQueryData(key('settlement'), s); refreshAll() },
    onError: fail('That did not go through. Try again.'),
  })
  const openSettlement = () => settle.mutate(() => loadDocumentsAPI.openSettlement(loadId))
  const closeTrip = () => settle.mutate(async () => {
    const s = await loadDocumentsAPI.closeSettlement(loadId)
    toast.success('Trip closed.')
    return s
  })

  if (docs.isLoading) return <div className="flex justify-center py-10"><Spinner label="Loading documents" /></div>
  if (docs.isError) return <ErrorState compact title="Documents did not load" onRetry={() => docs.refetch()} />

  return (
    <div className="space-y-8">
      {check.data && <DispatchChecklist check={check.data} />}

      <Section
        title="Documents"
        actions={canUpload(role) && (
          <Button size="sm" icon={<Plus size={14} />} onClick={() => { setEditing(null); setUploadOpen(true) }}>Add document</Button>
        )}
      >
        <GenerateButtons role={role} busyKind={generating} onGenerate={k => generate.mutate(k)} />
        <DocumentList docs={items} role={role} busyId={viewingId} onView={view} onHistory={setHistoryDoc}
          onEdit={canUpload(role) ? d => { setEditing(d); setUploadOpen(true) } : undefined} />
      </Section>

      <Section title="Proof of delivery">
        <PodView pod={finalPod(items) ?? items.find(d => d.kind === 'pod')} />
      </Section>

      <Section title="Freight settlement">
        <SettlementCard
          role={role}
          settlement={settlement.data ?? null}
          docs={items}
          busy={settle.isPending}
          onOpen={openSettlement}
          onAddExtra={(label, amount) => settle.mutateAsync(() => loadDocumentsAPI.addExtraCharge(loadId, { label, amount }))}
          onApprove={idx => settle.mutate(() => loadDocumentsAPI.approveExtraCharge(loadId, idx))}
          onAddDeduction={(label, amount, reason) => settle.mutateAsync(() => loadDocumentsAPI.addDeduction(loadId, { label, amount, reason }))}
          onClose={closeTrip}
        />
      </Section>

      <Section title="Timeline">
        <LoadTimeline items={timeline.data?.entries ?? []} />
      </Section>

      <UploadDocumentForm
        open={uploadOpen}
        existing={editing}
        busy={save.isPending}
        onClose={() => { setUploadOpen(false); setEditing(null) }}
        onSubmit={(values, file) => save.mutateAsync({ values, file }).catch(() => undefined)}
      />
      <DocumentHistory doc={historyDoc} events={history.data?.events ?? []} loading={history.isLoading} onClose={() => setHistoryDoc(null)} />
    </div>
  )
}
