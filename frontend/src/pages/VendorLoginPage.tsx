import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Zap, Eye, EyeOff, Package, ArrowRight, ArrowLeft } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { supabase } from '@/services/supabase'
import { Card, Button, Spinner } from '@/components/ui'
import toast from 'react-hot-toast'
import clsx from 'clsx'

export default function VendorLoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [isSignUp, setIsSignUp] = useState(false)

  const navigate = useNavigate()

  useEffect(() => {
    // If they land here and they already have a session, redirect back to vendor page
    const session = useAuthStore.getState().session
    if (session) navigate('/vendor')
  }, [navigate])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      if (isSignUp) {
        // Sign Up Flow for Vendors
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { role: 'vendor' }
          }
        })

        if (error) throw error
        if (!data.session) {
          toast.success('Account created! Please check your email to verify (if enabled).')
          setLoading(false)
          setIsSignUp(false)
          return
        }

        useAuthStore.getState().setSession(data.session, 'vendor')
        toast.success('Account created! Welcome to margixindia Marketplace.')
        handleSuccessfulLogin()

      } else {
        // Sign In Flow
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        })

        if (error) throw error
        if (!data.session) throw new Error('No session returned')

        // Fetch role from public.users & vendor_profiles
        const { data: user } = await supabase
          .from('users')
          .select('role')
          .eq('id', data.session.user.id)
          .maybeSingle()

        const { data: vProfile } = await supabase
          .from('vendor_profiles')
          .select('id')
          .eq('id', data.session.user.id)
          .maybeSingle()

        let role = user?.role || data.session.user.user_metadata?.role;
        if (role !== 'admin' && role !== 'superadmin') {
          if (vProfile || data.session.user.user_metadata?.role === 'vendor') {
            role = 'vendor';
          }
        }

        if (!role) {
          role = 'vendor' // fallback to vendor
        }

        useAuthStore.getState().setSession(data.session, role)
        toast.success(`Welcome back!`)
        handleSuccessfulLogin(vProfile)
      }
    } catch (e: any) {
      toast.error(e.message || 'Authentication failed')
    } finally {
      setLoading(false)
    }
  }

  const handleSuccessfulLogin = (vProfile?: any) => {
    if (sessionStorage.getItem('pendingMapRequest')) {
      navigate('/vendor/request')
    } else {
      navigate('/vendor')
    }
  }

  return (
    <div className="min-h-screen bg-bg flex flex-col items-center justify-center p-6 relative overflow-hidden">
      {/* Background Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/20 blur-[120px] rounded-full pointer-events-none" />

      <div className="w-full max-w-[420px] space-y-8 relative z-10 animate-fade-in">

        <button onClick={() => navigate('/vendor')} className="text-muted hover:text-text font-bold text-xs uppercase tracking-widest flex items-center gap-2 transition-colors">
          <ArrowLeft size={14} /> Back to Marketplace
        </button>

        {/* Branding */}
        <div className="text-center space-y-3">
          <div className="inline-flex w-16 h-16 bg-primary/10 rounded-2xl items-center justify-center border border-primary/20 shadow-[0_8px_32px_rgba(79,172,254,0.15)]">
            <Package size={32} className="text-primary" />
          </div>
          <h1 className="font-display text-4xl font-black text-text tracking-tighter uppercase leading-none pt-2">
            VENDOR <span className="text-primary">PORTAL</span>
          </h1>
          <p className="text-muted font-bold text-sm">
            Sign in to claim capacity or post loads.
          </p>
        </div>

        {/* Login Card */}
        <Card className="p-2 border-border bg-surface/50 shadow-2xl backdrop-blur-3xl overflow-hidden rounded-3xl">

          <form onSubmit={handleLogin} className="space-y-6 p-6">

            <div className="flex bg-surface2 rounded-xl p-1 mb-6 border border-border">
              <button
                type="button"
                onClick={() => setIsSignUp(false)}
                className={clsx(
                  "flex-1 py-2 text-xs font-bold rounded-lg transition-all",
                  !isSignUp ? "bg-primary text-white shadow-md" : "text-muted hover:text-text"
                )}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => setIsSignUp(true)}
                className={clsx(
                  "flex-1 py-2 text-xs font-bold rounded-lg transition-all",
                  isSignUp ? "bg-primary text-white shadow-md" : "text-muted hover:text-text"
                )}
              >
                Create Account
              </button>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase text-muted tracking-widest ml-1">
                Email Address
              </label>
              <input
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="w-full bg-surface2 border border-border rounded-2xl px-5 py-4 text-text text-sm focus:outline-none focus:border-primary/50 transition-all font-bold placeholder:text-muted shadow-sm"
              />
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase text-muted tracking-widest ml-1">
                {isSignUp ? 'Choose Password' : 'Password'}
              </label>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  className="w-full bg-surface2 border border-border rounded-2xl px-5 py-4 text-text text-sm focus:outline-none focus:border-primary/50 transition-all font-bold placeholder:text-muted shadow-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-5 top-1/2 -translate-y-1/2 text-muted hover:text-text transition-colors"
                >
                  {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <Button
              variant="accent"
              className="w-full py-6 rounded-2xl text-sm font-black shadow-[0_20px_40px_rgba(79,172,254,0.15)] group tracking-widest uppercase"
              type="submit"
              disabled={loading}
            >
              {loading ? (
                <Spinner size={20} />
              ) : (
                <span className="flex items-center gap-2">
                  {isSignUp ? 'Create Account' : 'Sign In'} <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
                </span>
              )}
            </Button>
          </form>

        </Card>
      </div>
    </div>
  )
}
