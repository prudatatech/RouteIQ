import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { FileText, Upload } from 'lucide-react'
import { FileButton } from '@/components/ui'
import { supabase } from '@/services/supabase'
import { claimsAPI, type CargoClaim } from '@/services/cargo'
import { errorMessage } from '@/utils/display'

const MAX_BYTES = 10 * 1024 * 1024
const TYPES = ['application/pdf', 'image/jpeg', 'image/png']

const fileName = (path: string) => path.split('/').pop() || path

/** Claim documents (invoice, photos, FIR copy): the list and a signed upload. */
export default function ClaimDocuments({ claim, readOnly, onSaved }: { claim: CargoClaim; readOnly: boolean; onSaved: () => void }) {
  const [busy, setBusy] = useState(false)
  const docs = claim.documents?.length
    ? claim.documents
    : claim.document_paths.map(path => ({ path, url: null as string | null }))

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const signed = await claimsAPI.documentUploadUrl(claim.id, { file_name: file.name, content_type: file.type, size: file.size })
      const { error } = await supabase.storage.from(signed.bucket).uploadToSignedUrl(signed.path, signed.token, file, { contentType: file.type })
      if (error) throw error
      return claimsAPI.update(claim.id, { document_paths: [...claim.document_paths, signed.path] })
    },
    onSuccess: () => { toast.success('Document added.'); onSaved() },
    onError: err => toast.error(errorMessage(err, 'We could not upload the document.')),
    onSettled: () => setBusy(false),
  })

  const pick = (file: File) => {
    if (!TYPES.includes(file.type)) { toast.error('Upload a PDF, JPG or PNG file.'); return }
    if (file.size > MAX_BYTES) { toast.error('That file is over 10 MB. Choose a smaller one.'); return }
    setBusy(true)
    upload.mutate(file)
  }

  return (
    <div className="space-y-3">
      {docs.length === 0
        ? <p className="text-sm text-muted">No documents yet. Add the invoice, photos of the damage or the FIR copy.</p>
        : (
          <ul className="divide-y divide-border rounded-control border border-border">
            {docs.map(d => (
              <li key={d.path} className="flex items-center gap-2 px-3 py-2 text-sm">
                <FileText size={16} aria-hidden="true" className="shrink-0 text-muted" />
                {d.url
                  ? <a href={d.url} target="_blank" rel="noopener noreferrer" className="min-w-0 break-all text-brand hover:underline">{fileName(d.path)}</a>
                  : <span className="min-w-0 break-all">{fileName(d.path)}</span>}
              </li>
            ))}
          </ul>
        )}
      {!readOnly && (
        <FileButton accept="application/pdf,image/jpeg,image/png" loading={busy} onFile={pick} icon={<Upload size={16} />}>
          Add document
        </FileButton>
      )}
    </div>
  )
}
