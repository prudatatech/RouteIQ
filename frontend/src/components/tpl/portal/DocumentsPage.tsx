import { useState } from 'react'
import { useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Eye, FileText, UploadCloud } from 'lucide-react'
import { Alert, Button, Card, EmptyState, FileButton, PageHeader, useConfirm } from '@/components/ui'
import { tplAPI } from '@/services/api'
import { openKycDocument } from '@/services/kycDocuments'
import { uploadTplDocument } from '@/services/tplDocuments'
import { errorMessage, formatDate } from '@/utils/display'
import { usePortal, type PortalDocument } from './portalContext'

/** Documents: what the partner uploaded at application, which they can open or replace (replacing goes back to review). */
export default function DocumentsPage() {
  const { id } = useParams()
  const { documents, reload } = usePortal()
  const { confirm } = useConfirm()
  const [uploading, setUploading] = useState<string | null>(null)

  const replace = async (doc: PortalDocument, file: File | undefined) => {
    if (!file) return
    if (file.size > 2 * 1024 * 1024) {
      toast.error('The file is over the 2 MB limit. Choose a smaller file.')
      return
    }
    const ok = await confirm({
      title: 'Replace this document?',
      message: `Uploading a new ${doc.doc_type} will send your profile back for approval and pause any active operations until it's reviewed again.`,
      confirmLabel: 'Replace and resubmit',
      tone: 'danger',
    })
    if (!ok) return

    try {
      setUploading(doc.id)
      const fileName = await uploadTplDocument(file, doc.doc_type, { applicationId: id! })
        .catch((err: Error) => { throw new Error(`Upload failed: ${err.message}`) })
      // The backend checks the file, sends the partner back to review and tells staff.
      await tplAPI.replaceDocument(id!, doc.id, fileName)
      reload()
      toast.success(`${doc.doc_type} updated. Status changed to pending approval.`)
    } catch (err) {
      console.error('Document update error:', err)
      toast.error(errorMessage(err, 'Failed to update document.'))
    } finally {
      setUploading(null)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Documents" description="Your application documents. Replace one if it changes." />
      <Alert tone="info">Replacing a document sends your profile back to MargixIndia for review. Your existing orders stay open.</Alert>
      {documents.length === 0 ? (
        <EmptyState title="No documents on file" description="Your application documents appear here once they are uploaded. Contact MargixIndia dispatch if some are missing." />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {documents.map(doc => (
            <Card key={doc.id} padded>
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-brand-soft text-brand">
                  <FileText size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-sm font-medium text-text">{doc.doc_type}</h2>
                  <p className="mt-0.5 text-xs text-muted">Uploaded {formatDate(doc.uploaded_at)}</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 border-t border-border pt-3">
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Eye size={14} />}
                  onClick={async () => {
                    try { await openKycDocument(doc.file_url) } catch (err) {
                      toast.error(errorMessage(err, 'Could not open document.'))
                    }
                  }}
                >
                  View
                </Button>
                <FileButton
                  variant="secondary"
                  size="sm"
                  icon={<UploadCloud size={14} />}
                  loading={uploading === doc.id}
                  accept=".pdf,.png,.jpg,.jpeg"
                  onFile={file => replace(doc, file)}
                >
                  Update
                </FileButton>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
