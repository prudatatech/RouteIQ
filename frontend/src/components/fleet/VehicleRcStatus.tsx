import { useState } from 'react'
import { CheckCircle2, AlertTriangle, Info } from 'lucide-react'
import clsx from 'clsx'
import { Button } from '@/components/ui'
import { vehiclesAPI, type RcVerificationResult } from '@/services/api'
import { errorMessage } from '@/utils/display'

/**
 * What is known about a vehicle's RC under the RC number field: the last Cashfree check (if any),
 * and a button to run a fresh one. A brand new vehicle has nothing to check yet - it is verified
 * automatically the moment it is saved, the same way editing the RC number re-checks it then too.
 */
export function VehicleRcStatus({ vehicleId, status, verifiedAt }: {
  vehicleId: string | null
  status?: string | null
  verifiedAt?: string | null
}) {
  const [result, setResult] = useState<RcVerificationResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  if (!vehicleId) {
    return (
      <p className="mt-1.5 flex items-start gap-1.5 text-sm text-muted">
        <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" /> The RC is checked automatically once this vehicle is saved.
      </p>
    )
  }

  const check = async () => {
    setBusy(true)
    setFailure(null)
    try {
      setResult(await vehiclesAPI.verifyRc(vehicleId))
    } catch (err) {
      setFailure(errorMessage(err, 'We could not run the RC check. Try again.'))
    } finally {
      setBusy(false)
    }
  }

  const shown = result?.status ?? status
  const tone = shown === 'valid' ? 'text-success' : shown === 'invalid' ? 'text-danger' : 'text-muted'
  const blacklisted = result?.blacklist_status && !/^(na|none)$/i.test(result.blacklist_status)

  return (
    <div className="mt-1.5 space-y-1.5 text-sm">
      {shown && shown !== 'not_configured' && (
        <p className={clsx('flex items-start gap-1.5', tone)} role="status">
          {shown === 'valid' ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" aria-hidden="true" /> : <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />}
          {shown === 'valid' ? 'RC verified' : shown === 'invalid' ? 'RC not found or invalid at the RTO' : 'RC check could not be completed'}
          {verifiedAt && !result && ` · last checked ${new Date(verifiedAt).toLocaleDateString('en-IN')}`}
        </p>
      )}
      {result && (
        <ul className="space-y-0.5 text-muted">
          {result.owner_name && <li>Registered owner: <span className="text-text">{result.owner_name}</span></li>}
          {result.rc_status && <li>RTO status: <span className="text-text">{result.rc_status}</span></li>}
          {result.insurance_upto && <li>Insurance valid until <span className="text-text">{result.insurance_upto}</span></li>}
          {result.pucc_upto && <li>Pollution certificate valid until <span className="text-text">{result.pucc_upto}</span></li>}
          {result.permit_valid_upto && <li>Permit valid until <span className="text-text">{result.permit_valid_upto}</span></li>}
        </ul>
      )}
      {blacklisted && (
        <p role="alert" className="flex items-start gap-1.5 text-danger">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" /> Blacklisted: {result!.blacklist_status}
        </p>
      )}
      <Button type="button" size="sm" variant="secondary" loading={busy} onClick={check}>
        {shown === 'valid' || shown === 'invalid' ? 'Re-check RC' : 'Check RC'}
      </Button>
      {failure && <p role="alert" className="text-danger">{failure}</p>}
    </div>
  )
}
