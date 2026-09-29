import { useEffect, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { bankAPI, type IfscDetails } from '@/services/api'
import { Input } from './Field'

const IFSC_FORMAT = /^[A-Z]{4}0[A-Z0-9]{6}$/
const DEBOUNCE_MS = 400

type Lookup =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'found'; details: IfscDetails }
  | { state: 'missing' }
  | { state: 'unavailable' }

const IFSC_NOT_FOUND = 'No bank branch has this IFSC'

// Only the lookup's own "no such branch" answer counts as missing; any other 404
// (an older backend without the endpoint, a proxy) means the code wasn't checked.
const isUnknownIfsc = (err: unknown): boolean => {
  const res = (err as { response?: { status?: number; data?: { detail?: unknown } } })?.response
  return res?.status === 404 && res.data?.detail === IFSC_NOT_FOUND
}

/**
 * IFSC input that looks the branch up once 11 valid characters are typed and shows
 * the bank, branch and which transfer modes it supports. `onResolved` gets the
 * branch, or null when the code is incomplete, unknown or could not be checked, so
 * a form can fill in and lock the bank name and branch.
 */
export function IfscField({ value, onChange, onResolved, label = 'IFSC code', required, error, hint, placeholder = 'HDFC0001234', className }: {
  value: string
  onChange: (code: string) => void
  onResolved?: (details: IfscDetails | null) => void
  label?: ReactNode
  required?: boolean
  error?: ReactNode
  hint?: ReactNode
  placeholder?: string
  className?: string
}) {
  const [lookup, setLookup] = useState<Lookup>({ state: 'idle' })
  const resolved = useRef(onResolved)
  resolved.current = onResolved
  const code = value.trim().toUpperCase()

  useEffect(() => {
    if (!IFSC_FORMAT.test(code)) {
      setLookup({ state: 'idle' })
      resolved.current?.(null)
      return
    }
    let stale = false
    setLookup({ state: 'loading' })
    const timer = setTimeout(() => {
      bankAPI.ifsc(code).then(
        details => { if (!stale) { setLookup({ state: 'found', details }); resolved.current?.(details) } },
        err => {
          if (stale) return
          setLookup({ state: isUnknownIfsc(err) ? 'missing' : 'unavailable' })
          resolved.current?.(null)
        },
      )
    }, DEBOUNCE_MS)
    return () => { stale = true; clearTimeout(timer) }
  }, [code])

  const shownError = error || (lookup.state === 'missing' ? IFSC_NOT_FOUND : undefined)
  return (
    <div className={clsx('space-y-2', className)}>
      <Input
        label={label} required={required} value={value} placeholder={placeholder} maxLength={11} autoComplete="off"
        onChange={e => onChange(e.target.value.toUpperCase())} error={shownError} hint={hint}
        inputClassName="font-mono uppercase"
        trailing={lookup.state === 'loading'
          ? <Loader2 className="h-4 w-4 animate-spin" aria-label="Checking" />
          : lookup.state === 'found' ? <CheckCircle2 className="h-4 w-4 text-success" aria-label="Found" /> : undefined}
      />
      {lookup.state === 'found' && <IfscSummary details={lookup.details} />}
      {lookup.state === 'unavailable' && (
        <p className="text-xs text-muted">Couldn't check right now. Make sure the IFSC is right; it is checked again when you save.</p>
      )}
    </div>
  )
}

const MODES: Array<[keyof Pick<IfscDetails, 'neft' | 'rtgs' | 'imps' | 'upi'>, string]> = [['neft', 'NEFT'], ['rtgs', 'RTGS'], ['imps', 'IMPS'], ['upi', 'UPI']]

/** Bank, branch, place and transfer-mode badges for a looked-up IFSC. */
export function IfscSummary({ details }: { details: IfscDetails }) {
  const place = [details.city, details.state].filter(Boolean).join(', ')
  return (
    <div className="rounded-control border border-border bg-surface-subtle px-3 py-2 text-sm" aria-live="polite">
      <p className="font-medium text-text">{details.bank ?? 'Bank'}{details.branch ? ` · ${details.branch}` : ''}</p>
      {place && <p className="text-xs text-muted">{place}</p>}
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {MODES.map(([key, name]) => (
          <span
            key={key}
            className={clsx('rounded-full px-2 py-0.5 text-xs font-medium', details[key] ? 'bg-success-soft text-success' : 'bg-surface text-muted line-through')}
            title={details[key] ? `${name} supported` : `${name} not supported`}
          >{name}</span>
        ))}
      </div>
    </div>
  )
}

/**
 * Bank name and branch inputs to pair with an {@link IfscField}. Once the IFSC resolves
 * they show the looked-up values and stay locked until "Edit" is pressed.
 */
export function BankBranchFields({ details, bankName, branch, onBankName, onBranch, bankError, branchError, required }: {
  details: IfscDetails | null
  bankName: string
  branch: string
  onBankName: (v: string) => void
  onBranch: (v: string) => void
  bankError?: ReactNode
  branchError?: ReactNode
  required?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const locked = !!details && !editing
  const fill = useRef({ onBankName, onBranch })
  fill.current = { onBankName, onBranch }
  useEffect(() => {
    setEditing(false)
    if (!details) return
    fill.current.onBankName(details.bank ?? '')
    fill.current.onBranch(details.branch ?? '')
  }, [details])
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Input label="Bank name" required={required} value={bankName} onChange={e => onBankName(e.target.value)} disabled={locked} error={bankError} />
      <Input
        label="Branch" required={required} value={branch} onChange={e => onBranch(e.target.value)} disabled={locked} error={branchError}
        hint={locked ? (
          <>Filled from bank records. <button type="button" className="font-medium text-brand hover:underline" onClick={() => setEditing(true)}>Edit</button></>
        ) : undefined}
      />
    </div>
  )
}

/** "Verified with bank records" or "Not verified", for pages that show saved bank details. */
export function IfscVerifiedHint({ verifiedAt }: { verifiedAt?: string | null }) {
  return verifiedAt
    ? <span className="text-xs text-success">Verified with bank records</span>
    : <span className="text-xs text-muted">Not verified</span>
}
