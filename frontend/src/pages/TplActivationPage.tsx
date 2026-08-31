import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Building2, CheckCircle2, ShieldCheck, Zap, Loader2 } from 'lucide-react'
import { Card } from '@/components/ui'
import clsx from 'clsx'

export default function TplActivationPage() {
  const navigate = useNavigate()
  
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Simple password strength
  const strength = password.length === 0 ? 0 : password.length < 6 ? 1 : password.length < 10 ? 2 : 3

  const handleActivate = (e: React.FormEvent) => {
    e.preventDefault()
    if (password !== confirm || strength < 2) return
    
    setIsSubmitting(true)
    setTimeout(() => {
      navigate('/3pl-portal')
    }, 2000)
  }

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-4">
      <div className="w-full max-w-md animate-fade-in">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-4">
            <Building2 size={32} />
          </div>
          <h1 className="font-display text-3xl font-black uppercase tracking-tight text-text">Account Activation</h1>
          <p className="text-sm text-muted font-medium mt-2">Setting up access for <span className="font-bold text-text">Safexpress Logistics</span></p>
        </div>

        <Card className="p-8 border-border bg-surface shadow-2xl">
          {isSubmitting ? (
            <div className="py-12 flex flex-col items-center justify-center text-center animate-fade-in">
              <Loader2 size={48} className="text-primary animate-spin mb-6" />
              <h2 className="text-xl font-black uppercase tracking-widest text-text">Setting up your dashboard...</h2>
              <p className="text-sm text-muted mt-2">Finalizing operational links.</p>
            </div>
          ) : (
            <form onSubmit={handleActivate} className="space-y-6">
              <div>
                <label className="text-[10px] font-black uppercase text-muted tracking-widest ml-1">Email Address</label>
                <input
                  type="email"
                  value="admin@safexpress.com"
                  readOnly
                  className="w-full bg-surface2 border border-border rounded-xl px-4 py-3 text-muted font-bold mt-1 outline-none cursor-not-allowed opacity-70"
                />
              </div>

              <div>
                <label className="text-[10px] font-black uppercase text-muted tracking-widest ml-1">Set Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full bg-surface border border-border rounded-xl px-4 py-3 text-text font-bold mt-1 outline-none focus:border-primary transition-colors"
                  placeholder="••••••••"
                />
                <div className="flex gap-1 mt-2 px-1">
                  <div className={clsx("h-1 flex-1 rounded-full", strength >= 1 ? 'bg-red-500' : 'bg-surface2')} />
                  <div className={clsx("h-1 flex-1 rounded-full", strength >= 2 ? 'bg-yellow-500' : 'bg-surface2')} />
                  <div className={clsx("h-1 flex-1 rounded-full", strength >= 3 ? 'bg-green-500' : 'bg-surface2')} />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-black uppercase text-muted tracking-widest ml-1">Confirm Password</label>
                <input
                  type="password"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  className="w-full bg-surface border border-border rounded-xl px-4 py-3 text-text font-bold mt-1 outline-none focus:border-primary transition-colors"
                  placeholder="••••••••"
                />
                {confirm.length > 0 && confirm !== password && (
                  <p className="text-[10px] text-red-500 font-bold uppercase mt-1 ml-1">Passwords do not match</p>
                )}
              </div>

              <div className="pt-4">
                <button 
                  type="submit"
                  disabled={password !== confirm || strength < 2 || password.length === 0}
                  className="w-full py-4 bg-primary hover:bg-primary-dark text-bg font-black uppercase tracking-widest text-sm rounded-xl transition-all shadow-lg shadow-primary/20 disabled:opacity-50 disabled:shadow-none flex items-center justify-center gap-2"
                >
                  <ShieldCheck size={18} /> Activate Account
                </button>
              </div>
            </form>
          )}
        </Card>
      </div>
    </div>
  )
}
