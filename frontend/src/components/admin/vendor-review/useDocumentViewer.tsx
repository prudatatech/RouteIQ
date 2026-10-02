import { useState } from 'react'
import toast from 'react-hot-toast'
import DocumentViewerModal from '@/components/ui/DocumentViewerModal'
import { getKycDocumentUrl } from '@/services/kycDocuments'

/** The documents list with a viewer; also used to open documents a vendor attached to an answer. */
export function useDocumentViewer() {
  const [viewer, setViewer] = useState<{ url: string; name: string } | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const open = async (label: string, path: string, key: string) => {
    setOpening(key)
    try {
      setViewer({ url: await getKycDocumentUrl(path), name: label })
    } catch {
      toast.error('We could not open this document. Try again.')
    } finally {
      setOpening(null)
    }
  }
  const modal = <DocumentViewerModal isOpen={!!viewer} onClose={() => setViewer(null)} fileUrl={viewer?.url ?? ''} fileName={viewer?.name ?? ''} />
  return { open, opening, modal }
}
