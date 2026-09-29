import { supabase } from '@/services/supabase'
import { peopleAPI, vendorAPI } from '@/services/api'
import { errorMessage } from '@/utils/display'

const PUBLIC_URL_MARKER = '/storage/v1/object/public/kyc_documents/'

/**
 * Uploads a KYC document (or the company logo) through a signed upload URL
 * from the backend, which picks the path in the vendor's own folder and checks
 * the format (PDF, JPG, PNG) and size. Returns the storage path to save.
 */
export async function uploadKycDocument(key: string, file: File): Promise<string> {
  let upload: { path: string; token: string }
  try {
    upload = await vendorAPI.kycUploadUrl({ key, content_type: file.type, size: file.size })
  } catch (err) {
    throw new Error(errorMessage(err, 'We could not start the upload. Try again.'))
  }
  const { error } = await supabase.storage
    .from('kyc_documents')
    .uploadToSignedUrl(upload.path, upload.token, file, { contentType: file.type })
  if (error) throw new Error('We could not upload the document. Try again.')
  return upload.path
}

/**
 * Normalizes a stored KYC document reference into a storage path.
 *
 * Accepts either a bare storage path (the current format) or a legacy
 * public URL from when the `kyc_documents` bucket was public. Returns
 * null when the value doesn't look like a kyc_documents reference at all.
 */
export function toKycPath(stored: string): string | null {
  if (!stored) return null

  if (stored.includes(PUBLIC_URL_MARKER)) {
    const [, afterMarker] = stored.split(PUBLIC_URL_MARKER)
    if (!afterMarker) return null
    try {
      return decodeURIComponent(afterMarker)
    } catch {
      return afterMarker
    }
  }

  if (/^https?:\/\//i.test(stored)) {
    // Some other URL entirely — not a kyc_documents reference we understand.
    return null
  }

  // Already a bare storage path.
  return stored
}

/**
 * Resolves a stored KYC document reference (path or legacy public URL) to a
 * short-lived signed URL suitable for viewing/downloading.
 */
export async function getKycDocumentUrl(stored: string): Promise<string> {
  const path = toKycPath(stored)
  if (!path) {
    throw new Error('Unable to resolve document location')
  }

  const { data, error } = await supabase.storage
    .from('kyc_documents')
    .createSignedUrl(path, 600)

  if (error || !data?.signedUrl) {
    throw new Error(error?.message || 'Failed to generate document link')
  }

  return data.signedUrl
}

/**
 * Opens a KYC document in a new tab. The tab is opened synchronously, inside
 * the click handler, so popup blockers allow it; it is pointed at the signed
 * URL once resolved, or closed if resolving fails (the error is rethrown).
 */
export async function openKycDocument(stored: string): Promise<void> {
  const tab = window.open('', '_blank')
  try {
    const url = await getKycDocumentUrl(stored)
    if (tab) {
      tab.opener = null
      tab.location.href = url
    } else {
      window.location.assign(url)
    }
  } catch (err) {
    tab?.close()
    throw err
  }
}

/**
 * Uploads a person's document (licence, Aadhaar, ...) through a signed upload URL from the
 * backend (docs/people-plan.md). Returns the storage path to save with the document record.
 */
export async function uploadPersonDocument(personId: string, docType: string, file: File): Promise<string> {
  let upload: { path: string; token: string }
  try {
    upload = await peopleAPI.documentUploadUrl(personId, { doc_type: docType, file_name: file.name, content_type: file.type })
  } catch (err) {
    throw new Error(errorMessage(err, 'We could not start the upload. Use a PDF, JPG or PNG under 10 MB.'))
  }
  const { error } = await supabase.storage
    .from('kyc_documents')
    .uploadToSignedUrl(upload.path, upload.token, file, { contentType: file.type })
  if (error) throw new Error('We could not upload the file. Try again.')
  return upload.path
}
