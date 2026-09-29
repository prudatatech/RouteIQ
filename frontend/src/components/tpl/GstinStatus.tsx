import { useEffect, useState } from 'react'
import { CheckCircle2, AlertTriangle, Info } from 'lucide-react'
import clsx from 'clsx'
import { Button } from '@/components/ui'
import { gstinAPI, type GstinVerification } from '@/services/api'
import { gstinError, normalizeGstin } from '@/utils/gstin'
import { errorMessage } from '@/utils/display'

const GSTIN_LENGTH = 15

/**
 * Shows what is known about a GSTIN under its input: whether the checksum holds, and,
 * on request, what the GST portal says. The online answer needs the server to have GSP
 * credentials; without them it says the online check is not configured.
 * Nothing is shown until the value is 15 characters long.
 */
export function GstinStatus({ gstin, pan, className }: { gstin: string; pan?: string; className?: string }) {
  const clean = normalizeGstin(gstin)
  const [result, setResult] = useState<GstinVerification | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => { setResult(null); setFailure(null) }, [clean, pan])

  if (clean.length < GSTIN_LENGTH) return null
  const problem = gstinError(clean, pan)
  if (problem) {
    return (
      <p role="alert" className={clsx('mt-1.5 flex items-start gap-1.5 text-sm text-danger', className)}>
        <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" /> {problem}
      </p>
    )
  }

  const check = async () => {
    setBusy(true)
    setFailure(null)
    try {
      setResult(await gstinAPI.verify(clean, pan))
    } catch (err) {
      setFailure(errorMessage(err, 'We could not run the online check. Try again.'))
    } finally {
      setBusy(false)
    }
  }

  const online = result?.online.status
  const tone = online === 'active' ? 'text-success' : online === 'inactive' || online === 'not_found' ? 'text-warning' : 'text-muted'
  return (
    <div className={clsx('mt-1.5 space-y-1.5 text-sm', className)}>
      <p className="flex items-start gap-1.5 text-success">
        <CheckCircle2 size={14} className="mt-0.5 shrink-0" aria-hidden="true" /> Checksum valid
      </p>
      {result ? (
        <p className={clsx('flex items-start gap-1.5', tone)} role="status">
          <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" /> {result.summary}
        </p>
      ) : (
        <Button type="button" size="sm" variant="secondary" loading={busy} onClick={check}>Check with GST portal</Button>
      )}
      {failure && <p role="alert" className="text-danger">{failure}</p>}
    </div>
  )
}
