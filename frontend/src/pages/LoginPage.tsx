import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Zap, Eye, EyeOff, ShieldCheck, UserCog, User, Truck } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { supabase } from '@/services/supabase'
import { Card, Button, Spinner } from '@/components/ui'
import toast from 'react-hot-toast'
import clsx from 'clsx'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()



  const handleLogin = async (e?: React.FormEvent, customEmail?: string, customPass?: string) => {
    e?.preventDefault()
    setLoading(true)
    const targetEmail = customEmail || email
    const targetPass = customPass || password

    try {
      // Sign in via Supabase Auth (not our custom endpoint)
      const { data, error } = await supabase.auth.signInWithPassword({
        email: targetEmail,
        password: targetPass,
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
        throw new Error('Account pending approval or role assignment.');
      }

      useAuthStore.getState().setSession(data.session, role)

      toast.success(`Welcome back, ${role}!`)
      if (role === 'superadmin') {
        navigate('/superadmin')
      } else if (role === 'vendor') {
        navigate('/vendor')
      } else if (role === 'driver') {
        navigate('/driver')
      } else {
        navigate('/dashboard')
      }
    } catch (e: any) {
      toast.error(e.message || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  const QUICK_LOGINS = [
    { role: 'admin', icon: UserCog, email: 'admin@routeiq.io', pass: 'Admin1234!', color: 'text-text' },
    { role: 'vendor', icon: User, email: 'vendor@routeiq.io', pass: 'Vendor1234!', color: 'text-primary' },
  ]

  return (
    <div className="min-h-screen bg-bg flex flex-col items-center justify-center p-6 relative overflow-hidden">
      {/* Background Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/20 blur-[120px] rounded-full pointer-events-none" />

      <div className="w-full max-w-[420px] space-y-8 relative z-10 animate-fade-in">
        {/* Branding */}
        <div className="text-center space-y-3">
          <div className="inline-flex w-20 h-20 bg-primary rounded-3xl items-center justify-center shadow-[0_8px_32px_rgba(79,172,254,0.3)] rotate-3 hover:rotate-0 transition-transform duration-500">
            <Zap size={44} className="text-bg fill-current" strokeWidth={2.5} />
          </div>
          <h1 className="font-display text-5xl font-black text-text tracking-tighter uppercase leading-none pt-4">
            ROUTE<span className="text-primary">IQ</span>
          </h1>
          <p className="text-muted font-bold uppercase tracking-[0.12em] text-[9px]">
            by Prudata
          </p>
        </div>

        {/* Login Card */}
        <Card className="p-8 border-border bg-surface/50 shadow-2xl backdrop-blur-3xl">

          <form onSubmit={handleLogin} className="space-y-6">
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase text-muted tracking-widest ml-1">Command Control ID</label>
              <input
                type="email"
                placeholder="nexus.auth@prudata.io"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="w-full bg-surface2 border border-border rounded-2xl px-5 py-4 text-text text-sm focus:outline-none focus:border-primary/50 transition-all font-bold placeholder:text-muted shadow-sm"
              />
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase text-muted tracking-widest ml-1">Access Pass-Key</label>
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
              className="w-full py-7 rounded-2xl text-base shadow-[0_20px_40px_rgba(79,172,254,0.15)] group"
              type="submit"
              disabled={loading}
            >
              {loading ? (
                <Spinner size={20} />
              ) : (
                <span className="flex items-center gap-2">
                  AUTHORIZE SESSION <Zap size={16} className="fill-current" />
                </span>
              )}
            </Button>
          </form>
        </Card>

      </div>

      {/* Footer Meta */}
      <div className="mt-12 text-[10px] font-bold text-muted uppercase tracking-[0.5em] animate-pulse">
        Core v1.0 // Intelligence Grid Active
      </div>
    </div>
  )
}
