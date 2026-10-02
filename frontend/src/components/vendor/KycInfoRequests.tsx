import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { FileText, Upload } from 'lucide-react'
import { vendorAPI } from '@/services/api'
import { uploadKycDocument } from '@/services/kycDocuments'
import { Alert, Button, Card, FileButton, Textarea } from '@/components/ui'
import { errorMessage } from '@/utils/display'
import type { InfoAnswer, VendorKycRequest } from '@/components/admin/vendor-review/types'

export const kycRequestsKey = ['vendor', 'kyc-requests'] as const

/** The vendor's open asks from the review team. Empty while loading or when there are none. */
export function useKycRequests(enabled: boolean) {
  return useQuery({ queryKey: kycRequestsKey, queryFn: () => vendorAPI.kycRequests(), enabled, retry: false })
}

/** Answers that can be sent: every item has text or an uploaded document. Exported for the tests. */
export function collectAnswers(request: VendorKycRequest, text: Record<string, string>, docs: Record<string, string>): InfoAnswer[] | null {
  const answers: InfoAnswer[] = []
  for (const item of request.items) {
    if (item.kind === 'document') {
      if (!docs[item.key]) return null
      answers.push({ key: item.key, document_path: docs[item.key] })
    } else {
      const t = (text[item.key] ?? '').trim()
      if (!t) return null
      answers.push({ key: item.key, text: t })
    }
  }
  return answers
}

function RequestForm({ request }: { request: VendorKycRequest }) {
  const queryClient = useQueryClient()
  const [text, setText] = useState<Record<string, string>>({})
  const [docs, setDocs] = useState<Record<string, string>>({})
  const [docNames, setDocNames] = useState<Record<string, string>>({})
  const [uploading, setUploading] = useState<string | null>(null)
  const [attempted, setAttempted] = useState(false)

  const send = useMutation({
    mutationFn: (answers: InfoAnswer[]) => vendorAPI.respondKyc({ request_id: request.id, answers }),
    onSuccess: () => {
      toast.success('Thank you. We sent your answers to the review team.')
      queryClient.invalidateQueries({ queryKey: kycRequestsKey })
      queryClient.invalidateQueries({ queryKey: ['vendor-profile'] })
    },
    onError: err => toast.error(errorMessage(err, 'We could not send your answers. Try again.')),
  })

  const upload = async (key: string, file: File) => {
    setUploading(key)
    try {
      const path = await uploadKycDocument('other', file)
      setDocs(d => ({ ...d, [key]: path }))
      setDocNames(d => ({ ...d, [key]: file.name }))
    } catch (err) {
      toast.error(errorMessage(err, 'We could not upload the document. Try again.'))
    } finally {
      setUploading(null)
    }
  }

  const submit = () => {
    const answers = collectAnswers(request, text, docs)
    if (!answers) { setAttempted(true); return }
    send.mutate(answers)
  }

  return (
    <form noValidate onSubmit={e => { e.preventDefault(); submit() }} className="space-y-4">
      {request.message && <p className="text-sm text-text whitespace-pre-wrap">{request.message}</p>}
      {request.items.map(item => (
        <div key={item.key} className="space-y-1.5">
          {item.kind === 'text' ? (
            <Textarea
              label={item.label}
              hint={item.hint ?? undefined}
              rows={2}
              value={text[item.key] ?? ''}
              onChange={e => setText(t => ({ ...t, [item.key]: e.target.value }))}
              error={attempted && !(text[item.key] ?? '').trim() ? 'Please answer this' : undefined}
            />
          ) : (
            <div>
              <p className="text-sm font-medium text-text">{item.label}</p>
              {item.hint && <p className="text-xs text-muted">{item.hint}</p>}
              <div className="mt-1.5 flex flex-wrap items-center gap-3">
                <FileButton size="sm" accept=".pdf,.jpg,.jpeg,.png" icon={<Upload size={14} />} loading={uploading === item.key} onFile={f => upload(item.key, f)}>
                  {docs[item.key] ? 'Replace document' : 'Upload document'}
                </FileButton>
                {docs[item.key] && <span className="flex items-center gap-1.5 text-sm text-text"><FileText size={14} aria-hidden="true" />{docNames[item.key]}</span>}
              </div>
              {attempted && !docs[item.key] && <p role="alert" className="mt-1 text-sm text-danger">Please upload this document</p>}
            </div>
          )}
        </div>
      ))}
      <Button type="submit" loading={send.isPending} disabled={uploading !== null}>Send to the review team</Button>
    </form>
  )
}

/** Banner on the Company page while the review team waits for more details. */
export function KycInfoRequests({ requests }: { requests: VendorKycRequest[] }) {
  if (requests.length === 0) return null
  return (
    <div className="space-y-4">
      {requests.map(r => (
        <Card key={r.id} padded className="space-y-4 border-warning">
          <Alert tone="warning" title="The review team needs more details">
            Answer the items below and send them. Your KYC goes back to review as soon as you do.
          </Alert>
          <RequestForm request={r} />
        </Card>
      ))}
    </div>
  )
}
