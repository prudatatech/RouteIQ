import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Check, Copy } from 'lucide-react'
import { Alert, Button, buttonClasses, Card } from '@/components/ui'
import { formatDate } from '@/utils/display'
import { copyText } from '@/components/fleet/location/clipboard'


/** Shown after the load is posted (PRD 10.2): the load ID, the route, what happens next. */
export default function LoadConfirmation({ loadId, loadNumber, pickupCity, deliveryCity, pickupDate, vehicleName, statusNote, onPostAnother, chosenCount = 0, quoteRequested = false }: {
  loadId: string
  loadNumber: string
  pickupCity: string
  deliveryCity: string
  pickupDate: string | null
  vehicleName: string
  /** The server's note when the load waits, for example for business verification. */
  statusNote?: string | null
  onPostAnother: () => void
  /** How many companies the vendor chose; 0 means the load is open to every company on the lane. */
  chosenCount?: number
  quoteRequested?: boolean
}) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    if (await copyText(loadNumber)) {
      setCopied(true)
      toast.success('Load ID copied')
      setTimeout(() => setCopied(false), 2000)
    } else {
      toast.error('Could not copy. Select the ID and copy it.')
    }
  }

  return (
    <Card padded className="mx-auto max-w-xl space-y-6 !p-6 text-center" role="status" aria-label="Load posted">
      <div className="space-y-2">
        <p className="text-sm font-medium text-success">Load posted</p>
        <p className="font-mono text-3xl font-semibold tracking-wide text-text" data-testid="load-number">{loadNumber}</p>
        <Button variant="secondary" size="sm" onClick={copy} icon={copied ? <Check size={14} /> : <Copy size={14} />}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>

      <dl className="mx-auto grid max-w-sm gap-2 text-left text-sm">
        <div className="flex justify-between gap-4"><dt className="text-muted">From and to</dt><dd className="font-medium text-text">{pickupCity} → {deliveryCity}</dd></div>
        <div className="flex justify-between gap-4"><dt className="text-muted">Pickup date</dt><dd className="font-medium text-text">{pickupDate ? formatDate(pickupDate) : '—'}</dd></div>
        <div className="flex justify-between gap-4"><dt className="text-muted">Vehicle</dt><dd className="font-medium text-text">{vehicleName}</dd></div>
      </dl>

      {statusNote
        ? <Alert tone="warning" title="Your load is saved">{statusNote}</Alert>
        : <p className="text-sm text-text">Our team is matching a verified carrier. You'll get a WhatsApp update within 2 hours.</p>}

      <div data-testid="routing-note" className="space-y-1 text-sm">
        <p className="font-medium text-text">
          {chosenCount > 0
            ? `Sent to ${chosenCount} ${chosenCount === 1 ? 'company' : 'companies'}`
            : `Open to companies serving ${pickupCity} → ${deliveryCity}`}
        </p>
        {quoteRequested && <p className="text-muted">Quotes usually arrive within 2 hours</p>}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
        <Link to={`/vendor/loads/${encodeURIComponent(loadId)}`} className={buttonClasses({ variant: 'primary', size: 'lg' })}>Track this load</Link>
        <Button variant="secondary" size="lg" onClick={onPostAnother}>Post another load</Button>
      </div>
    </Card>
  )
}
