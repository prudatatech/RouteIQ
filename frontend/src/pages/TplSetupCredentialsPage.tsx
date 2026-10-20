import { errorMessage } from '@/utils/display'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ShieldCheck, Mail, Lock, KeyRound, ArrowLeft, ArrowRight, CheckCircle2 } from 'lucide-react'
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
      setFormError('Enter the valid corporate email address you applied with.')
      return
    }
    setLoading(true)
    try {
      await tplAPI.sendSetupOtp(email.trim())
      toast.success('If this email belongs to an approved partner, a verification code is on its way')
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
    if (password.length < 10) found.password = 'Password must be at least 10 characters.'
    else if (password !== confirmPassword) found.confirm = 'The passwords do not match.'
    setErrors(found)
    if (Object.keys(found).length > 0) return
    setLoading(true)
    try {
      await tplAPI.setupPassword(email.trim(), otp, password)
      toast.success('Password set successfully. You can now sign in to your dashboard.')
      navigate(`/login?email=${encodeURIComponent(email)}`)
    } catch (err) {
      console.error(err)
      setFormError(errorMessage(err, 'That code did not work. Check it for typos, or request a new code.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-bg text-text">
      {/* Top Navbar */}
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-16 w-full max-w-content items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5 rounded-control text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
            <img src="/margix-logo.png" alt="" className="h-8 w-8 object-contain" />
            <span className="text-lg font-bold tracking-tight">
              Margix<span className="text-brand">India</span>
            </span>
          </Link>
          <Link to="/login" className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-text">
            <ArrowLeft size={14} /> Back to Sign in
          </Link>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center p-4 sm:p-6 sm:py-12">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center space-y-2">
            <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-soft text-brand shadow-xs">
              <ShieldCheck size={28} />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-text">Set up your partner login</h1>
            <p className="text-xs sm:text-sm text-muted max-w-sm mx-auto">
              For approved 3PL carriers. We verify your registered email before configuring your secure dashboard password.
            </p>
          </div>

          {/* Stepper Indicator */}
          <div className="flex items-center justify-center gap-3 text-xs font-semibold">
            <span className={step === 1 ? 'text-brand font-bold flex items-center gap-1' : 'text-success flex items-center gap-1'}>
              {step > 1 ? <CheckCircle2 size={14} /> : '1.'} Verify Email
            </span>
            <span className="text-border">→</span>
            <span className={step === 2 ? 'text-brand font-bold' : 'text-muted'}>
              2. Set Password
            </span>
          </div>

          <Card padded className="shadow-raised border border-border">
            {step === 1 ? (
              <form noValidate onSubmit={handleSendOtp} className="space-y-5">
                {formError && <Alert tone="danger">{formError}</Alert>}
                <Input
                  label="Registered carrier email"
                  type="email"
                  required
                  autoComplete="email"
                  inputMode="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="operations@carrier.com"
                  hint="The email address used when applying as a 3PL partner."
                  leading={<Mail size={16} />}
                />
                <Button type="submit" size="lg" fullWidth loading={loading} className="font-bold justify-center">
                  Send verification code <ArrowRight size={15} className="ml-1" />
                </Button>
              </form>
            ) : (
              <form noValidate onSubmit={handleSetupPassword} className="space-y-5">
                {formError && <Alert tone="danger">{formError}</Alert>}
                <div className="rounded-control bg-surface-subtle border border-border p-3 text-center text-xs">
                  <span className="text-muted">Verification code dispatched to: </span>
                  <strong className="text-text font-semibold block mt-0.5">{email}</strong>
                </div>

                <div className="flex items-end justify-between gap-2">
                  <Input
                    className="flex-1"
                    inputClassName="text-center font-mono text-xl tracking-widest font-extrabold"
                    label="6-digit verification code"
                    required
                    maxLength={6}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    error={errors.otp}
                    value={otp}
                    onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    leading={<KeyRound size={16} />}
                  />
                  <Button type="button" variant="ghost" size="sm" loading={loading} onClick={handleSendOtp} className="mb-1 text-xs">
                    Resend
                  </Button>
                </div>

                <Input
                  label="Create dashboard password"
                  type="password"
                  required
                  autoComplete="new-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  hint="Must be at least 10 characters."
                  error={errors.password}
                  leading={<Lock size={16} />}
                />
                <Input
                  label="Confirm dashboard password"
                  type="password"
                  required
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  error={errors.confirm}
                  leading={<Lock size={16} />}
                />

                <Button type="submit" size="lg" fullWidth loading={loading} className="font-bold justify-center">
                  Activate partner login <ArrowRight size={15} className="ml-1" />
                </Button>
              </form>
            )}
          </Card>

          <p className="text-center text-xs text-muted">
            Already configured your credentials?{' '}
            <Link to="/login" className="font-bold text-brand hover:underline">
              Sign in to dashboard
            </Link>
          </p>
        </div>
      </main>
    </div>
  )
}
