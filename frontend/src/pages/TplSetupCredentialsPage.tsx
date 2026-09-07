import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Mail, Key, ShieldCheck, Loader2, Eye, EyeOff, RefreshCw } from 'lucide-react'
import { tplAPI } from '@/services/api'
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
  const [showPassword, setShowPassword] = useState(false)

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) {
      toast.error('Please enter your email')
      return
    }

    setLoading(true)
    try {
      await tplAPI.sendSetupOtp(email)
      toast.success('Verification code sent to your email')
      setStep(2)
    } catch (err: any) {
      console.error(err)
      toast.error(err.response?.data?.error || err.message || 'Failed to send verification code')
    } finally {
      setLoading(false)
    }
  }

  const handleSetupPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password !== confirmPassword) {
      toast.error('Passwords do not match')
      return
    }
    if (password.length < 6) {
      toast.error('Password must be at least 6 characters long')
      return
    }
    if (!otp || otp.length !== 4) {
      toast.error('Please enter the 4-digit OTP')
      return
    }

    setLoading(true)
    try {
      await tplAPI.setupPassword(email, otp, password)
      toast.success('Password setup successfully! You can now log in.')
      navigate(`/login?email=${encodeURIComponent(email)}`)
    } catch (err: any) {
      console.error(err)
      toast.error(err.response?.data?.error || err.message || 'Failed to verify OTP and set password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-bg flex flex-col items-center justify-center p-6 relative overflow-hidden animate-fade-in">
      {/* Background Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/20 blur-[120px] rounded-full pointer-events-none" />

      <div className="w-full max-w-[420px] space-y-8 relative z-10">
        {/* Branding */}
        <div className="text-center space-y-3">
          <div className="inline-flex w-20 h-20 bg-primary/10 border border-primary/20 rounded-3xl items-center justify-center shadow-[0_8px_32px_rgba(79,172,254,0.1)]">
            <ShieldCheck size={44} className="text-primary" strokeWidth={2} />
          </div>
          <h1 className="text-3xl font-black uppercase tracking-tight text-text">Setup Credentials</h1>
          <p className="text-sm text-muted">Secure your 3PL Partner account</p>
        </div>

        {/* Form Card */}
        <div className="bg-surface border border-border p-8 rounded-3xl shadow-2xl backdrop-blur-xl">
          {step === 1 ? (
            <form onSubmit={handleSendOtp} className="space-y-6">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted">Registered Email</label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" size={18} />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter your registered email"
                    className="w-full bg-bg border border-border rounded-xl pl-12 pr-4 py-3 text-sm text-text focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-4 bg-primary text-bg font-black uppercase tracking-widest text-sm rounded-xl transition-all shadow-[0_0_20px_rgba(79,172,254,0.3)] hover:shadow-[0_0_30px_rgba(79,172,254,0.5)] hover:scale-[1.02] flex items-center justify-center gap-2 disabled:opacity-50 disabled:hover:scale-100"
              >
                {loading ? <Loader2 size={18} className="animate-spin" /> : 'Send Verification Code'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleSetupPassword} className="space-y-6 animate-fade-in">
              <div className="text-center mb-6">
                <div className="text-xs text-muted mb-1">Code sent to</div>
                <div className="text-sm font-bold text-text bg-bg py-2 rounded-lg border border-border">{email}</div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted">4-Digit Verification Code</label>
                  <button 
                    type="button" 
                    onClick={handleSendOtp} 
                    disabled={loading}
                    className="text-[10px] font-bold uppercase tracking-widest text-primary flex items-center gap-1 hover:text-white transition-colors"
                  >
                    <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Resend
                  </button>
                </div>
                <input
                  type="text"
                  required
                  maxLength={4}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                  placeholder="0000"
                  className="w-full bg-bg border border-border rounded-xl px-4 py-3 text-center text-2xl tracking-[1em] font-mono text-text focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted">Set New Password</label>
                <div className="relative">
                  <Key className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" size={18} />
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter new password"
                    className="w-full bg-bg border border-border rounded-xl pl-12 pr-12 py-3 text-sm text-text focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                  />
                  <button 
                    type="button" 
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-muted hover:text-text transition-colors"
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted">Confirm Password</label>
                <div className="relative">
                  <Key className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" size={18} />
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm new password"
                    className="w-full bg-bg border border-border rounded-xl pl-12 pr-12 py-3 text-sm text-text focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-4 bg-primary text-bg font-black uppercase tracking-widest text-sm rounded-xl transition-all shadow-[0_0_20px_rgba(79,172,254,0.3)] hover:shadow-[0_0_30px_rgba(79,172,254,0.5)] hover:scale-[1.02] flex items-center justify-center gap-2 disabled:opacity-50 disabled:hover:scale-100"
              >
                {loading ? <Loader2 size={18} className="animate-spin" /> : 'Set Password & Continue'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
