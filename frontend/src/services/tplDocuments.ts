import { isAxiosError } from 'axios'
import { supabase } from '@/services/supabase'
import { tplAPI } from '@/services/api'
import { compressDocumentFile } from '@/utils/imageCompressor'

const KYC_BUCKET = 'kyc_documents'

/** Which application a 3PL document belongs to. */
export type TplUploadTarget =
  /** A new application, filed under the 3PL ID the applicant chose. */
  | { customId: string }
  /** An existing application: as its partner (signed in), or as the applicant with its PAN. */
  | { applicationId: string; verifyPan?: string | null }

/**
 * Uploads one 3PL document through a backend-issued signed upload URL and
 * returns its storage path (store this as the document's `url`/`file_url`).
 * Automatically compresses large image files on the client before upload,
 * speeding up upload times by up to 20x.
 */
export async function uploadTplDocument(file: File, docType: string, target: TplUploadTarget): Promise<string> {
  const { file: uploadFile } = await compressDocumentFile(file)

  let upload: { path: string; token: string }
  try {
    upload = await tplAPI.documentUploadUrl({
      doc_type: docType,
      content_type: uploadFile.type,
      size: uploadFile.size,
      ...('customId' in target
        ? { custom_id: target.customId }
        : { application_id: target.applicationId, verify_pan: target.verifyPan ?? undefined }),
    })
  } catch (err) {
    const body = isAxiosError(err) ? err.response?.data : undefined
    throw new Error(body?.error ?? body?.detail ?? (err instanceof Error ? err.message : 'Upload failed'))
  }

  const { error } = await supabase.storage
    .from(KYC_BUCKET)
    .uploadToSignedUrl(upload.path, upload.token, uploadFile, { contentType: uploadFile.type })
  if (error) throw new Error(error.message)
  return upload.path
}

