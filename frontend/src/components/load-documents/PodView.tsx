import { Alert, DetailList, StatusPill } from '@/components/ui'
import { formatDateTime } from '@/utils/display'
import type { LoadDocument } from '@/types/loadDocuments'
import { DOC_STATUS } from './model'

const text = (v: unknown) => (v === undefined || v === null || v === '' ? null : String(v))

/** Proof of delivery: what the receiver confirmed, and any shortage or damage. */
export function PodView({ pod }: { pod: LoadDocument | undefined }) {
  if (!pod) {
    return <Alert tone="info" title="No proof of delivery yet">It appears here once the driver or the receiver confirms delivery.</Alert>
  }
  const f = pod.fields
  const photos = pod.evidence?.photo_urls ?? []
  const signature = pod.evidence?.signature_url ?? null
  const st = DOC_STATUS[pod.status]
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={st.tone}>{st.label}</StatusPill>
        {pod.status !== 'final' && <span className="text-xs text-muted">Closing the trip needs a final proof of delivery.</span>}
      </div>
      <DetailList items={[
        { label: 'Delivered', value: formatDateTime(text(f.delivered_at) ?? pod.doc_date) },
        { label: 'Receiver', value: [text(f.receiver_name), text(f.receiver_contact)].filter(Boolean).join(' · ') || 'Not given' },
        { label: 'Quantity delivered', value: text(f.delivered_quantity) ?? 'Not given' },
        { label: 'Shortage', value: text(f.shortage_quantity) ?? 'None reported' },
        { label: 'Damage', value: [text(f.damaged_quantity), text(f.damage_details)].filter(Boolean).join(' · ') || 'None reported' },
        { label: 'Remarks', value: text(f.remarks) ?? 'None' },
      ]} />
      {(photos.length > 0 || signature) && (
        <div className="flex flex-wrap gap-2" aria-label="Delivery evidence">
          {photos.map((url, i) => (
            <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="text-xs text-brand underline">Delivery photo {i + 1}</a>
          ))}
          {signature && <a href={signature} target="_blank" rel="noopener noreferrer" className="text-xs text-brand underline">Receiver signature</a>}
        </div>
      )}
    </div>
  )
}
