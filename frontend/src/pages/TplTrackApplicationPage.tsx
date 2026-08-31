import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, ShieldAlert, ArrowRight, Building2, CheckCircle2 } from 'lucide-react'
import { tplAPI } from '@/services/api'
import toast from 'react-hot-toast'
import clsx from 'clsx'

export default function TplTrackApplicationPage() {
  const navigate = useNavigate()
  const [trackingId, setTrackingId] = useState('')
  const [panNumber, setPanNumber] = useState('')
  
  const [loading, setLoading] = useState(false)
  const [application, setApplication] = useState<any>(null)

  const handleTrack = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!trackingId || !panNumber) {
      toast.error('Please enter both Tracking ID and PAN Number')
      return
    }

    setLoading(true)
    try {
      // UUID format check (basic)
      if (trackingId.length < 32) {
        throw new Error('Invalid Tracking ID format')
      }
      
      const data = await tplAPI.getPartner(trackingId.trim())
      
      if (data.pan_number !== panNumber.trim().toUpperCase()) {
        throw new Error('PAN Number does not match our records for this application.')
      }

      setApplication(data)
    } catch (err: any) {
      console.error(err)
      toast.error(err.message || 'Application not found. Please check your Tracking ID.')
      setApplication(null)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-bg text-text relative overflow-x-hidden flex items-center justify-center p-6">
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-[-10%] right-[-5%] w-[800px] h-[800px] bg-primary/20 blur-[150px] rounded-full mix-blend-screen opacity-50" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[600px] h-[600px] bg-blue-500/10 blur-[120px] rounded-full mix-blend-screen opacity-50" />
      </div>

      <div className="w-full max-w-lg z-10 animate-fade-in">
        <button 
          onClick={() => navigate('/3pl/onboard')}
          className="text-xs font-bold uppercase tracking-widest text-muted hover:text-primary transition-colors mb-8 flex items-center gap-2"
        >
          &larr; Back to Onboarding
        </button>

        <div className="bg-surface border border-border rounded-3xl p-8 shadow-2xl relative overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-4 mb-8">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20">
              <Search className="text-primary" size={24} />
            </div>
            <div>
              <h1 className="text-2xl font-black uppercase tracking-tight">Track Application</h1>
              <p className="text-sm text-muted">Check status or edit your pending 3PL application.</p>
            </div>
          </div>

          {/* Form */}
          {!application ? (
            <form onSubmit={handleTrack} className="space-y-6 relative z-10">
              <div>
                <label className="block text-[10px] font-bold text-muted uppercase tracking-widest mb-2">
                  Application Tracking ID (UUID)
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 123e4567-e89b-12d3-a456-426614174000"
                  value={trackingId}
                  onChange={e => setTrackingId(e.target.value)}
                  className="w-full bg-bg border border-border rounded-xl px-4 py-3 text-sm text-text focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all font-mono"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-muted uppercase tracking-widest mb-2">
                  Registered PAN Number
                </label>
                <div className="relative">
                  <ShieldAlert className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" size={18} />
                  <input
                    type="text"
                    required
                    placeholder="ABCDE1234F"
                    value={panNumber}
                    onChange={e => setPanNumber(e.target.value.toUpperCase())}
                    className="w-full bg-bg border border-border rounded-xl pl-12 pr-4 py-3 text-sm text-text focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all uppercase"
                  />
                </div>
                <p className="text-[10px] text-muted mt-2">Required for security verification.</p>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-4 bg-primary hover:bg-primary-dark text-bg font-black uppercase tracking-widest text-sm rounded-xl transition-all shadow-lg shadow-primary/20 flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {loading ? 'Searching...' : 'Track Application'}
                {!loading && <ArrowRight size={18} />}
              </button>
            </form>
          ) : (
            <div className="animate-fade-in relative z-10">
              <div className="bg-bg border border-border rounded-2xl p-6 mb-6">
                <div className="flex items-start justify-between mb-6">
                  <div>
                    <h3 className="text-xl font-bold text-text">{application.company_name}</h3>
                    <div className="text-xs text-muted font-mono mt-1">{application.id}</div>
                  </div>
                  <div className={clsx(
                    "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border",
                    application.status === 'pending' ? "bg-yellow-500/10 text-yellow-500 border-yellow-500/20" :
                    application.status === 'active' ? "bg-green-500/10 text-green-500 border-green-500/20" :
                    "bg-blue-500/10 text-blue-500 border-blue-500/20"
                  )}>
                    {application.status}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-[9px] font-bold text-muted uppercase tracking-widest">Corridors Requested</div>
                    <div className="text-sm font-bold mt-1">{application.tpl_corridors?.length || 0}</div>
                  </div>
                  <div>
                    <div className="text-[9px] font-bold text-muted uppercase tracking-widest">Documents Provided</div>
                    <div className="text-sm font-bold mt-1">{application.tpl_documents?.length || 0}</div>
                  </div>
                  <div className="col-span-2">
                    <div className="text-[9px] font-bold text-muted uppercase tracking-widest">Submitted On</div>
                    <div className="text-sm font-medium mt-1">{new Date(application.created_at).toLocaleString()}</div>
                  </div>
                </div>
              </div>

              {application.status === 'pending' ? (
                <div className="space-y-4">
                  <p className="text-xs text-muted text-center mb-4">
                    Your application is currently under review. You may still make changes to your operational profile or upload missing documents.
                  </p>
                  <button
                    onClick={() => navigate(`/3pl/onboard?edit=${application.id}&pan=${application.pan_number}`)}
                    className="w-full py-4 bg-surface2 hover:bg-bg border border-border hover:border-primary text-text font-black uppercase tracking-widest text-sm rounded-xl transition-all shadow-sm flex items-center justify-center gap-2"
                  >
                    Edit Application Details
                  </button>
                  <button
                    onClick={() => setApplication(null)}
                    className="w-full py-3 text-muted hover:text-text font-bold uppercase tracking-widest text-xs transition-colors"
                  >
                    Track Another
                  </button>
                </div>
              ) : (
                <div className="text-center py-4">
                  <div className="w-12 h-12 bg-green-500/10 text-green-500 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle2 size={24} />
                  </div>
                  <h4 className="text-lg font-bold text-text mb-2">Application {application.status}</h4>
                  <p className="text-xs text-muted">
                    This application has been processed. You can no longer make edits. Please check your email for access instructions.
                  </p>
                  <button
                    onClick={() => navigate('/login')}
                    className="mt-6 px-6 py-3 bg-primary text-bg font-black uppercase tracking-widest text-sm rounded-xl"
                  >
                    Go to Login
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
