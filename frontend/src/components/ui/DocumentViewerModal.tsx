import { useEffect, useState } from 'react'
import { Download, Printer, ZoomIn, ZoomOut } from 'lucide-react'
import { Modal } from './Modal'
import { Button, IconButton } from './Button'

interface DocumentViewerModalProps {
  isOpen: boolean
  onClose: () => void
  fileUrl: string
  fileName: string
}

/** Preview for an uploaded PDF or image, with print and download. */
export default function DocumentViewerModal({ isOpen, onClose, fileUrl, fileName }: DocumentViewerModalProps) {
  const [scale, setScale] = useState(1)
  useEffect(() => { if (isOpen) setScale(1) }, [isOpen, fileUrl])

  const isPdf = /\.pdf($|[?#])/i.test(fileUrl) || fileUrl.toLowerCase().includes('application/pdf')

  const print = () => {
    const win = window.open(fileUrl, '_blank', 'noopener')
    if (win) win.onload = () => win.print()
  }

  const download = () => {
    const a = document.createElement('a')
    a.href = fileUrl
    a.download = fileName || 'document'
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title={fileName || 'Document'}
      size="xl"
      footer={
        <>
          {!isPdf && (
            <div className="flex items-center gap-1 sm:mr-auto">
              <IconButton label="Zoom out" icon={<ZoomOut size={18} />} onClick={() => setScale(s => Math.max(0.5, s - 0.25))} disabled={scale <= 0.5} />
              <span className="w-12 text-center text-sm text-muted tabular">{Math.round(scale * 100)}%</span>
              <IconButton label="Zoom in" icon={<ZoomIn size={18} />} onClick={() => setScale(s => Math.min(3, s + 0.25))} disabled={scale >= 3} />
            </div>
          )}
          <Button variant="secondary" icon={<Printer size={16} />} onClick={print}>Print</Button>
          <Button icon={<Download size={16} />} onClick={download}>Download</Button>
        </>
      }
    >
      <div className="flex h-[65dvh] items-center justify-center overflow-auto rounded-control bg-surface-subtle">
        {isPdf ? (
          <iframe src={`${fileUrl}#toolbar=0`} className="h-full w-full rounded-control border border-border" title={fileName || 'Document'} />
        ) : (
          <img
            src={fileUrl}
            alt={fileName || 'Document'}
            style={{ transform: `scale(${scale})` }}
            className="max-w-full origin-center transition-transform duration-200"
          />
        )}
      </div>
    </Modal>
  )
}
