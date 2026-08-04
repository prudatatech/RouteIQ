import { useState } from 'react'
import { X, Download, Printer, ZoomIn, ZoomOut } from 'lucide-react'

interface DocumentViewerModalProps {
  isOpen: boolean
  onClose: () => void
  fileUrl: string
  fileName: string
}

export default function DocumentViewerModal({ isOpen, onClose, fileUrl, fileName }: DocumentViewerModalProps) {
  const [scale, setScale] = useState(1)

  if (!isOpen) return null

  const isPdf = fileUrl.toLowerCase().includes('.pdf') || fileUrl.includes('pdf')

  const handlePrint = () => {
    const printWindow = window.open(fileUrl, '_blank')
    if (printWindow) {
      printWindow.onload = () => {
        printWindow.print()
      }
    }
  }

  const handleDownload = () => {
    const a = document.createElement('a')
    a.href = fileUrl
    a.download = fileName || 'document'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-background/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-surface border border-border shadow-2xl rounded-2xl w-full max-w-5xl h-[90vh] flex flex-col overflow-hidden animate-scale-up">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-surface2">
          <h3 className="font-heading font-bold text-lg text-text truncate pr-4">{fileName || 'Document Viewer'}</h3>
          <div className="flex items-center gap-2 shrink-0">
            {!isPdf && (
              <>
                <button onClick={() => setScale(s => Math.max(0.5, s - 0.25))} className="p-2 text-muted hover:text-text hover:bg-surface rounded-lg transition-colors" title="Zoom Out">
                  <ZoomOut size={18} />
                </button>
                <button onClick={() => setScale(s => Math.min(3, s + 0.25))} className="p-2 text-muted hover:text-text hover:bg-surface rounded-lg transition-colors" title="Zoom In">
                  <ZoomIn size={18} />
                </button>
              </>
            )}
            <div className="w-px h-6 bg-border mx-2" />
            <button onClick={handlePrint} className="p-2 text-muted hover:text-text hover:bg-surface rounded-lg transition-colors" title="Print">
              <Printer size={18} />
            </button>
            <button onClick={handleDownload} className="p-2 text-primary hover:text-primary-dark hover:bg-primary/10 rounded-lg transition-colors flex items-center gap-2 font-bold text-sm px-4" title="Download">
              <Download size={16} /> Download
            </button>
            <div className="w-px h-6 bg-border mx-2" />
            <button onClick={onClose} className="p-2 text-muted hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors" title="Close">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 bg-background overflow-auto relative flex items-center justify-center p-4">
          {isPdf ? (
            <iframe 
              src={`${fileUrl}#toolbar=0`} 
              className="w-full h-full rounded-xl border border-border shadow-inner"
              title={fileName}
            />
          ) : (
            <img 
              src={fileUrl} 
              alt={fileName} 
              style={{ transform: `scale(${scale})` }}
              className="max-w-full transition-transform duration-200 ease-out shadow-2xl rounded-lg" 
            />
          )}
        </div>

      </div>
    </div>
  )
}
