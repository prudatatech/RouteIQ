import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { AlertCircle, Eye, FileText, UploadCloud } from 'lucide-react'
import { Alert, Button, Card, CardHeader, EmptyState, FileButton, PageHeader, StatusPill, useConfirm } from '@/components/ui'
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
  const [searchParams] = useSearchParams()
  const { partner, documents, reload } = usePortal()
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

  const hasFlaggedDocs = partner.document_issues && Object.keys(partner.document_issues).length > 0

  useEffect(() => {
    if (searchParams.get('highlight') === 'flagged') {
      const el = document.querySelector('[data-flagged="true"]')
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }
  }, [searchParams, partner.document_issues])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Documents"
        description={hasFlaggedDocs
          ? 'Please re-upload the flagged document(s) highlighted below to proceed with compliance review.'
          : 'Your compliance documents on file. Upload missing files or update existing ones.'}
      />

      {missingDocTypes.length > 0 && (
        <Card padded>
          <CardHeader
            title="Upload KYC Documents"
            description="Upload your missing compliance documents (PDF, JPG, PNG up to 2 MB) to complete verification."
          />
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {missingDocTypes.map(docType => {
              const issue = partner.document_issues?.[docType]
              return (
                <div key={docType} className="space-y-1.5" data-flagged={issue ? 'true' : undefined}>
                  <DocUploadField
                    label={docType}
                    hint={issue ? `Fix Requested: ${issue}` : 'Required KYC document'}
                    busy={uploading === docType}
                    onUpload={file => uploadNew(docType, file)}
                    onRemove={() => {}}
                    onView={() => {}}
                  />
                  {issue && (
                    <div className="rounded-control bg-warning/10 border border-warning/30 p-2 text-xs text-warning flex items-start gap-1.5">
                      <AlertCircle size={14} className="shrink-0 mt-0.5" />
                      <span>{issue}</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {documents.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-xs font-semibold uppercase text-muted">Uploaded Documents</h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {documents.map(doc => {
              const issue = partner.document_issues?.[doc.doc_type]
              return (
                <Card
                  key={doc.id}
                  padded
                  data-flagged={issue ? 'true' : undefined}
                  className={clsx(
                    'transition-all duration-200',
                    issue ? 'border-warning/70 bg-warning/5 shadow-xs' : 'border-border bg-surface'
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className={clsx(
                        'flex h-10 w-10 shrink-0 items-center justify-center rounded-control',
                        issue ? 'bg-warning/20 text-warning' : 'bg-brand-soft text-brand'
                      )}>
                        <FileText size={18} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h2 className="truncate text-sm font-semibold text-text">{doc.doc_type}</h2>
                        </div>
                        <p className="mt-0.5 text-xs text-muted">Uploaded {formatDate(doc.uploaded_at)}</p>
                      </div>
                    </div>
                    {issue ? (
                      <StatusPill tone="warning" dot={false}>Fix requested</StatusPill>
                    ) : (
                      <span className="text-[11px] font-semibold text-success flex items-center gap-1 shrink-0">
                        Active
                      </span>
                    )}
                  </div>

                  {issue && (
                    <div className="mt-3 rounded-control bg-warning/10 border border-warning/30 p-2.5 text-xs">
                      <div className="flex items-center gap-1.5 font-semibold text-warning">
                        <AlertCircle size={14} className="shrink-0" />
                        <span>Reviewer feedback:</span>
                      </div>
                      <p className="mt-1 text-text leading-relaxed font-normal">{issue}</p>
                    </div>
                  )}

                  <div className="mt-4 flex items-center gap-2.5 border-t border-border pt-3">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="flex-1"
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
                      variant={issue ? 'primary' : 'secondary'}
                      size="sm"
                      className="flex-1 font-semibold"
                      icon={<UploadCloud size={14} />}
                      loading={uploading === doc.id}
                      accept=".pdf,.png,.jpg,.jpeg"
                      onFile={file => replace(doc, file)}
                    >
                      {issue ? 'Re-upload' : 'Update'}
                    </FileButton>
                  </div>
                </Card>
              )
            })}
          </div>
        </div>
      )}

      {documents.length === 0 && missingDocTypes.length === 0 && (
        <EmptyState title="No documents on file" description="Your application documents appear here once they are uploaded." />
      )}
    </div>
  )
}
