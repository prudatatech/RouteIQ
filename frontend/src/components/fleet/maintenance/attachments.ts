import { fleetAPI } from '@/services/api'
import { supabase } from '@/services/supabase'
import { errorMessage } from '@/utils/display'
import type { AttachmentInput, AttachmentKind } from './types'

/** Same file types and storage pattern as expense receipts. */
export const ATTACHMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png']
export const ATTACHMENT_ACCEPT = ATTACHMENT_TYPES.join(',')
export const MAX_ATTACHMENT_MB = 10

/** A PDF is most often an invoice, a picture most often a photo. Staff can change it. */
export const guessKind = (file: { type: string }): AttachmentKind => (file.type === 'application/pdf' ? 'invoice' : 'photo')

/** Uploads one file straight to storage through a signed URL and returns what to send with the record. */
export async function uploadServiceFile(vehicleId: string, file: File): Promise<AttachmentInput> {
  if (!ATTACHMENT_TYPES.includes(file.type)) throw new Error('Upload a PDF, JPG or PNG file.')
  if (file.size > MAX_ATTACHMENT_MB * 1024 * 1024) throw new Error(`A file must be at most ${MAX_ATTACHMENT_MB} MB.`)
  let upload
  try {
    upload = await fleetAPI.attachmentUpload(vehicleId, { content_type: file.type, size: file.size })
  } catch (err) {
    throw new Error(errorMessage(err, 'We could not start the upload. Try again.'))
  }
  const { error } = await supabase.storage.from(upload.bucket).uploadToSignedUrl(upload.path, upload.token, file, { contentType: file.type })
  if (error) throw new Error('We could not upload the file. Try again.')
  return { path: upload.path, kind: guessKind(file), file_name: file.name, content_type: file.type, size_bytes: file.size }
}

/**
 * Opens an attachment in a new tab, or saves it with `download`. The tab opens inside the click so
 * popup blockers allow it, then points at the short-lived signed link.
 */
export async function openAttachment(attachmentId: string, download = false): Promise<void> {
  const tab = download ? null : window.open('', '_blank')
  try {
    const { url } = await fleetAPI.attachmentUrl(attachmentId, download)
    if (tab) {
      tab.opener = null
      tab.location.href = url
    } else {
      window.location.assign(url)
    }
  } catch (err) {
    tab?.close()
    throw new Error(errorMessage(err, 'We could not open the file. Try again.'))
  }
}
