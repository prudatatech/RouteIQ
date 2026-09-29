import { errorMessage } from '@/utils/display'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'
import { tplAPI } from '@/services/api'
import { Alert, Button, Card, Input } from '@/components/ui'
import toast from 'react-hot-toast'

export default function TplSetupCredentialsPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [email, setEmail] = useState(searchParams.get('email') || '')
  const [otp, setOtp] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const [step, setStep] = useState<1 | 2>(1)
  const [loading, setLoading] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [errors, setErrors] = useState<{ otp?: string; password?: string; confirm?: string }>({})

  const handleSendOtp = async (e: React.SyntheticEvent) => {
    e.preventDefault()
    setFormError(null)
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setFormError('Enter the email address you applied with.')
      return
    }
    setLoading(true)
    try {
      await tplAPI.sendSetupOtp(email.trim())
      toast.success('If this email belongs to an approved partner, a code is on its way.')
      setStep(2)
    } catch (err) {
      console.error(err)
      setFormError(errorMessage(err, 'We could not send the code. Check your connection and try again.'))
    } finally {
      setLoading(false)
    }
  }

  const handleSetupPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)
    const found: { otp?: string; password?: string; confirm?: string } = {}
    if (otp.length !== 6) found.otp = 'Enter the 6-digit code from the email.'
    if (password.length < 10) found.password = 'Use at least 10 characters.'
    else if (password !== confirmPassword) found.confirm = 'The passwords do not match.'
    setErrors(found)
    if (Object.keys(found).length > 0) return
    setLoading(true)
    try {
      await tplAPI.setupPassword(email.trim(), otp, password)
      toast.success('Password set. You can now sign in.')
      navigate(`/login?as=vendor&email=${encodeURIComponent(email)}`)
    } catch (err) {
      console.error(err)
      setFormError(errorMessage(err, 'That code did not work. Check it, or ask for a new one.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-6">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-brand-soft text-brand">
            <ShieldCheck size={28} />
          </div>
          <h1 className="text-2xl font-semibold text-text">Set up your partner login</h1>
          <p className="mt-1 text-sm text-muted">For 3PL partners whose application was approved. We email you a code to confirm it is you.</p>
        </div>

        <Card padded>
          {step === 1 ? (
            <form noValidate onSubmit={handleSendOtp} className="space-y-5">
              {formError && <Alert tone="danger">{formError}</Alert>}
              <Input label="Registered email" type="email" required autoComplete="email" inputMode="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" hint="The email you used on your application." />
              <Button type="submit" fullWidth loading={loading}>Send verification code</Button>
            </form>
          ) : (
            <form noValidate onSubmit={handleSetupPassword} className="space-y-5">
              {formError && <Alert tone="danger">{formError}</Alert>}
              <p className="text-center text-sm text-muted">
                Code sent to <span className="font-medium text-text">{email}</span>
              </p>
              <div className="flex items-end justify-between gap-2">
                <Input
                  className="flex-1 text-center font-mono"
                  label="6-digit verification code"
                  required
                  maxLength={6}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  error={errors.otp}
                  value={otp}
                  onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                />
                <Button type="button" variant="ghost" size="sm" loading={loading} onClick={handleSendOtp}>Resend</Button>
              </div>
              <Input label="New password" type="password" required autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} hint="At least 10 characters." error={errors.password} />
              <Input label="Confirm password" type="password" required autoComplete="new-password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} error={errors.confirm} />
              <Button type="submit" fullWidth loading={loading}>Set password and continue</Button>
            </form>
          )}
        </Card>

        <p className="text-center text-sm text-muted">
          Already set it up? <Link to="/login?as=vendor" className="font-medium text-brand hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  )
}
