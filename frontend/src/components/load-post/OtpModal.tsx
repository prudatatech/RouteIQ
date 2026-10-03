import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { authAPI } from '@/services/api'
import { supabase } from '@/services/supabase'
import { Button, Input, Modal } from '@/components/ui'
import { errorMessage } from '@/utils/display'
import { phoneDigits } from './logic'

/**
 * Asked when a guest presses Submit Load: the mobile number, then the 6-digit code texted to it,
 * then a session. The page does not change, so the filled form stays as it is.
 */
export default function OtpModal({ open, onClose, onVerified, emailSignInHref, onUseEmail }: {
  open: boolean
  onClose: () => void
  /** Called once the session is set. */
  onVerified: () => void
  /** Where the email and password sign-in link goes (it returns to the saved form). */
  emailSignInHref?: string
  /** On the sign-in page itself there is nowhere to go: the link closes the modal instead. */
  onUseEmail?: () => void
}) {
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) { setCode(''); setSent(false); setError(null); setBusy(false) }
  }, [open])

  const digits = phoneDigits(phone)

  const send = async () => {
    if (!digits) { setError('Enter a 10-digit mobile number.'); return }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError('Enter a valid email address.'); return }
    setBusy(true); setError(null)
    try {
      await authAPI.vendorSendOtp(`+91${digits}`, email)
      setSent(true)
    } catch (err) {
      setError(errorMessage(err, 'We could not send the code. Try again in a moment.'))
    } finally {
      setBusy(false)
    }
  }

  const verify = async () => {
    if (!/^\d{6}$/.test(code)) { setError('Enter the 6-digit code.'); return }
    setBusy(true); setError(null)
    try {
      const res = await authAPI.vendorVerifyOtp(`+91${digits}`, code, email)
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: res.session.access_token,
        refresh_token: res.session.refresh_token,
      })
      if (sessionError) throw sessionError
      onVerified()
    } catch (err) {
      setError(errorMessage(err, 'That code did not work. Check it and try again.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={sent ? 'Enter the code' : 'Verify your email address'}
      description={sent ? `We sent a 6-digit code to ${email}.` : 'We use it to sign you in and send updates on your load.'}
      onSubmit={sent ? verify : send}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy}>{sent ? 'Verify and continue' : 'Send code'}</Button>
        </>
      )}
    >
      <div className="space-y-4">
        {sent ? (
          <>
            <Input
              label="6-digit code" required inputMode="numeric" autoComplete="one-time-code" maxLength={6}
              value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} autoFocus
              inputClassName="text-center text-2xl tracking-widest font-mono h-14"
            />
            <div className="flex flex-wrap gap-x-4 text-sm">
              <button type="button" className="text-brand hover:underline" onClick={() => { setSent(false); setCode(''); setError(null) }}>Change details</button>
              <button type="button" className="text-brand hover:underline" onClick={send}>Send the code again</button>
            </div>
          </>
        ) : (
          <div className="space-y-4">
            <Input
              label="Mobile number" required type="tel" inputMode="tel" autoComplete="tel-national" leading="+91"
              value={phone} onChange={e => setPhone(e.target.value)} autoFocus inputClassName="pl-12"
            />
            <Input
              label="Email address" required type="email" autoComplete="email"
              value={email} onChange={e => setEmail(e.target.value)}
            />
          </div>
        )}
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
        <p className="text-sm text-muted">
          {onUseEmail
            ? <>Prefer email? <button type="button" onClick={onUseEmail} className="font-medium text-brand hover:underline">Sign in with email and password</button>.</>
            : <>Prefer email? <Link to={emailSignInHref ?? '/login'} className="font-medium text-brand hover:underline">Sign in with email and password</Link>. Your load is kept.</>}
        </p>
      </div>
    </Modal>
  )
}
