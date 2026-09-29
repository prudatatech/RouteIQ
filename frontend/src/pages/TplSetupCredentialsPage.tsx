import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'
import { tplAPI } from '@/services/api'
import { Button, Card, Input } from '@/components/ui'
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

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) {
      toast.error('Enter your email.')
      return
    }
    setLoading(true)
    try {
      await tplAPI.sendSetupOtp(email)
      toast.success('If this email belongs to an approved partner, a code is on its way.')
      setStep(2)
    } catch (err) {
      console.error(err)
      toast.error(err instanceof Error ? err.message : 'Failed to send the verification code.')
    } finally {
      setLoading(false)
    }
  }

  const handleSetupPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password !== confirmPassword) {
      toast.error('Passwords do not match.')
      return
    }
    if (password.length < 10) {
      toast.error('Password must be at least 10 characters.')
      return
    }
    if (!otp || otp.length !== 6) {
      toast.error('Enter the 6-digit code.')
      return
    }
    setLoading(true)
    try {
      await tplAPI.setupPassword(email, otp, password)
      toast.success('Password set. You can now sign in.')
      navigate(`/login?as=vendor&email=${encodeURIComponent(email)}`)
    } catch (err) {
      console.error(err)
      toast.error(err instanceof Error ? err.message : 'Failed to verify the code and set the password.')
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
          <h1 className="text-2xl font-semibold text-text">Setup credentials</h1>
          <p className="mt-1 text-sm text-muted">Secure your 3PL partner account.</p>
        </div>

        <Card padded>
          {step === 1 ? (
            <form onSubmit={handleSendOtp} className="space-y-5">
              <Input label="Registered email" type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" />
              <Button type="submit" fullWidth loading={loading}>Send verification code</Button>
            </form>
          ) : (
            <form onSubmit={handleSetupPassword} className="space-y-5">
              <p className="text-center text-sm text-muted">
                Code sent to <span className="font-medium text-text">{email}</span>
              </p>
              <div className="flex items-end justify-between gap-2">
                <Input
                  className="flex-1 text-center font-mono"
                  label="6-digit verification code"
                  required
                  maxLength={6}
                  value={otp}
                  onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
                  placeholder="000000"
                />
                <Button type="button" variant="ghost" size="sm" loading={loading} onClick={handleSendOtp}>Resend</Button>
              </div>
              <Input label="New password" type="password" required value={password} onChange={e => setPassword(e.target.value)} hint="At least 10 characters." />
              <Input label="Confirm password" type="password" required value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} />
              <Button type="submit" fullWidth loading={loading}>Set password and continue</Button>
            </form>
          )}
        </Card>
      </div>
    </div>
  )
}
