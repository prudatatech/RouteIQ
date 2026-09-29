import { financeAPI } from '@/services/api'
import { supabase } from '@/services/supabase'
import { errorMessage } from '@/utils/display'

export const RECEIPT_TYPES = ['application/pdf', 'image/jpeg', 'image/png']

/** Uploads a receipt through a signed URL from the backend and returns its storage path. */
export async function uploadReceipt(file: File): Promise<string> {
  let upload
  try {
    upload = await financeAPI.receiptUpload({ content_type: file.type, size: file.size })
  } catch (err) {
    throw new Error(errorMessage(err, 'We could not start the upload. Try again.'))
  }
  const { error } = await supabase.storage
    .from(upload.bucket)
    .uploadToSignedUrl(upload.path, upload.token, file, { contentType: file.type })
  if (error) throw new Error('We could not upload the receipt. Try again.')
  return upload.path
}

/**
 * Opens an expense's receipt in a new tab. The tab opens inside the click so
 * popup blockers allow it, then points at the short-lived signed link.
 */
export async function openReceipt(expenseId: string): Promise<void> {
  const tab = window.open('', '_blank')
  try {
    const { url } = await financeAPI.receiptUrl(expenseId)
    if (tab) {
      tab.opener = null
      tab.location.href = url
    } else {
      window.location.assign(url)
    }
  } catch (err) {
    tab?.close()
    throw new Error(errorMessage(err, 'We could not open the receipt. Try again.'))
  }
}
