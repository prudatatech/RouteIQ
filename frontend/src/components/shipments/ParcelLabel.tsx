import { useRef } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Printer } from 'lucide-react'
import toast from 'react-hot-toast'
import { Button } from '@/components/ui'

/** Escapes text for the label print window. */
const escapeHtml = (v: string) => v.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)

/**
 * Printable QR label for a shipment or vendor load. The code is the tracking ID,
 * which the driver app scans at pickup and at delivery (and accepts typed in by hand).
 */
export default function ParcelLabel({ trackingId, size = 132, showPrint = true }: {
  trackingId: string
  size?: number
  /** Hide the print button when the page already has its own Print action. */
  showPrint?: boolean
}) {
  const box = useRef<HTMLDivElement>(null)

  const printLabel = () => {
    const svg = box.current?.querySelector('svg')
    const popup = window.open('', '_blank', 'width=420,height=520')
    if (!svg || !popup) {
      toast.error('Allow pop-ups for this site to print the label')
      return
    }
    popup.document.write(
      `<!doctype html><html><head><title>Label ${escapeHtml(trackingId)}</title>` +
      '<style>body{font-family:system-ui,sans-serif;margin:0;display:flex;justify-content:center;padding:24px}' +
      '.label{border:2px solid #000;padding:16px;text-align:center;width:260px}' +
      '.label svg{width:220px;height:220px}.id{font:600 20px ui-monospace,monospace;margin-top:8px;letter-spacing:1px}' +
      '.brand{font-size:12px;margin-top:6px;color:#444}</style></head><body>' +
      `<div class="label">${svg.outerHTML}<div class="id">${escapeHtml(trackingId)}</div><div class="brand">MargixIndia</div></div>` +
      '<script>window.onload=function(){window.print();window.close()}</script></body></html>',
    )
    popup.document.close()
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div ref={box} className="rounded-control border border-border bg-white p-2">
        <QRCodeSVG value={trackingId} size={size} level="M" marginSize={1} title={`QR code for ${trackingId}`} />
      </div>
      <div className="space-y-2">
        <p className="font-mono text-sm font-semibold text-text">{trackingId}</p>
        <p className="max-w-xs text-xs text-muted">
          Stick this on the parcel. The driver scans it at pickup and again at delivery to confirm it is the right one.
        </p>
        {showPrint && (
          <Button variant="secondary" size="sm" icon={<Printer size={16} />} onClick={printLabel}>Print label</Button>
        )}
      </div>
    </div>
  )
}
