import { useState } from 'react'
import { useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Eye, FileText, UploadCloud } from 'lucide-react'
import { Alert, Button, Card, CardHeader, EmptyState, FileButton, PageHeader, useConfirm } from '@/components/ui'
import { DocUploadField } from '@/components/kyc/DocUploadField'
import { tplAPI } from '@/services/api'
import { openKycDocument } from '@/services/kycDocuments'
import { uploadTplDocument } from '@/services/tplDocuments'
import { TPL_DOCUMENT_TYPES } from '@/components/tpl/constants'
import { errorMessage, formatDate } from '@/utils/display'
import { usePortal, type PortalDocument } from './portalContext'

/** Documents: what the partner uploaded at application, which they can open, replace, or add missing KYC docs. */
export default function DocumentsPage() {
  const { id } = useParams()
  const { documents, reload } = usePortal()
  const { confirm } = useConfirm()
  const [uploading, setUploading] = useState<string | null>(null)

  const uploadedDocTypes = new Set(documents.map(d => d.doc_type))
  const missingDocTypes = TPL_DOCUMENT_TYPES.filter(t => !uploadedDocTypes.has(t))

  const uploadNew = async (docType: string, file: File | undefined) => {
    if (!file) return
    if (file.size > 2 * 1024 * 1024) {
      toast.error('The file is over the 2 MB limit. Choose a smaller file.')
      return
    }
    try {
      setUploading(docType)
      const fileName = await uploadTplDocument(file, docType, { applicationId: id! })
        .catch((err: Error) => { throw new Error(`Upload failed: ${err.message}`) })
      await tplAPI.updateApplication(id!, {
        documents: [
          ...documents.map(d => ({ type: d.doc_type, url: d.file_url })),
          { type: docType, url: fileName },
        ],
      })
      reload()
      toast.success(`${docType} uploaded successfully`)
    } catch (err) {
      console.error('Document upload error:', err)
      toast.error(errorMessage(err, 'Failed to upload document.'))
    } finally {
      setUploading(null)
    }
  }

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
      <PageHeader title="Documents" description="Your application documents. Upload missing documents or replace one if it changes." />
      <Alert tone="info">Replacing an existing document sends your profile back to MargixIndia for review. Your existing orders stay open.</Alert>

      {missingDocTypes.length > 0 && (
        <Card padded>
          <CardHeader
            title="Upload KYC Documents"
            description="Upload your missing compliance documents (PDF, JPG, PNG up to 2 MB) to complete verification."
          />
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {missingDocTypes.map(docType => (
              <DocUploadField
                key={docType}
                label={docType}
                hint="Required KYC document"
                busy={uploading === docType}
                onUpload={file => uploadNew(docType, file)}
                onRemove={() => {}}
                onView={() => {}}
              />
            ))}
          </div>
        </Card>
      )}

      {documents.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-xs font-semibold uppercase text-muted">Uploaded Documents</h3>
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
        </div>
      )}

      {documents.length === 0 && missingDocTypes.length === 0 && (
        <EmptyState title="No documents on file" description="Your application documents appear here once they are uploaded." />
      )}
    </div>
  )
}
