import { useState, useEffect, type FormEvent } from 'react'
import { Page, PageHeader, Card, Input, Button, Select, Alert } from '@/components/ui'
import { CheckCircle2, ChevronLeft, ChevronRight, Truck, Blocks } from 'lucide-react'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import { supabase } from '@/services/supabase'
import type { Session } from '@supabase/supabase-js'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { publicAPI, tplAPI } from '@/services/api'
import { useAuthStore } from '@/store/authStore'
import { loadAccount } from '@/services/account'

const STEPS = [
  'Contact Details',
  'Fleet Details',
  'Review',
]

const MIN_PASSWORD_LENGTH = 8
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function GoogleIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
    </svg>
  )
}

function Stepper({ step }: { step: number }) {
  return (
    <Card padded className="mb-6 flex justify-between items-center py-4 px-6 md:px-12">
      {STEPS.map((label, i) => (
        <div key={label} className="flex flex-col items-center relative flex-1">
          {i < STEPS.length - 1 && (
            <div
              className={clsx(
                'absolute top-4 left-[50%] right-[-50%] h-[2px]',
                i < step ? 'bg-text' : 'bg-border'
              )}
            />
          )}
          
          <div
            className={clsx(
              'relative z-10 flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold',
              i < step ? 'bg-success text-white' : i === step ? 'bg-text text-white' : 'bg-surface-subtle text-muted border border-border'
            )}
          >
            {i < step ? <CheckCircle2 size={16} /> : i + 1}
          </div>
          
          <span
            className={clsx(
              'mt-2 text-xs font-medium',
              i === step ? 'text-text' : 'text-muted'
            )}
          >
            {label}
          </span>
        </div>
      ))}
    </Card>
  )
}

export default function TplOnboardingPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const step = parseInt(searchParams.get('step') || '0', 10)
  const setStep = (newStep: number | ((s: number) => number)) => {
    const nextStep = typeof newStep === 'function' ? newStep(step) : newStep
    setSearchParams({ step: nextStep.toString() })
  }
  const [direction, setDirection] = useState<'forward' | 'backward'>('forward')
  const [submitted, setSubmitted] = useState(false)
  
  // Step 1
  const [ownerName, setOwnerName] = useState('')
  const [email, setEmail] = useState('')
  const [mobile, setMobile] = useState('')
  const [location, setLocation] = useState('')
  
  // Step 2
  const [fleetSize, setFleetSize] = useState<'single' | 'multiple' | null>(null)
  const [truckType, setTruckType] = useState('')
  const [multipleTruckCounts, setMultipleTruckCounts] = useState<Record<string, number>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  const [userLoading, setUserLoading] = useState(true)
  const [session, setSession] = useState<Session | null>(null)

  const [createdPartnerId, setCreatedPartnerId] = useState<string | null>(null)

  const { data: vehicles } = useQuery({ queryKey: ['public', 'vehicle-classes'], queryFn: () => publicAPI.vehicleClasses() })

  useEffect(() => {
    let isMounted = true

    const checkExistingPartner = async (userSession: Session) => {
      try {
        const existing = await tplAPI.checkPartner({
          user_id: userSession.user.id,
          email: userSession.user.email,
        })
        if (existing?.id) {
          const account = await loadAccount(userSession.user.id).catch(() => ({
            role: 'vendor',
            hasVendorProfile: false,
            tplPartnerId: existing.id,
          }))
          useAuthStore.getState().setSession(userSession, account.role || 'vendor', existing.id)
          navigate(`/3pl-portal/${existing.id}`, { replace: true })
          return
        }
      } catch (err) {
        console.error('Error verifying 3PL partner status:', err)
      }
      // Not an existing partner — show the onboarding form
      if (isMounted) setUserLoading(false)
    }

    // After Google OAuth, Supabase redirects back with a hash fragment (#access_token=...).
    const isOAuthReturn = window.location.hash.includes('access_token')

    if (isOAuthReturn) {
      // OAuth just returned — wait for Supabase to process the hash and establish the session
      const { data: authListener } = supabase.auth.onAuthStateChange((_event, currentSession) => {
        if (!isMounted) return
        setSession(currentSession)
        if (currentSession?.user) {
          checkExistingPartner(currentSession)
        } else {
          setUserLoading(false)
        }
      })
      return () => { isMounted = false; authListener.subscription.unsubscribe() }
    }

    // First visit (not an OAuth return): check if user already has an active session
    supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
      if (!isMounted) return
      if (currentSession?.user) {
        setSession(currentSession)
        checkExistingPartner(currentSession)
      } else {
        setUserLoading(false)
      }
    }).catch(() => {
      if (isMounted) setUserLoading(false)
    })

    return () => { isMounted = false }
  }, [navigate])

  // Prefills what the sign-in already told us (verified email, and Google's name when available) so
  // there is less to type by hand. Both stay editable: the sign-in email may differ from the company's
  // preferred contact address.
  useEffect(() => {
    if (!session?.user) return
    if (!ownerName) {
      const name = session.user.user_metadata?.full_name || session.user.user_metadata?.name
      if (typeof name === 'string' && name.trim()) setOwnerName(name.trim())
    }
    if (!email && session.user.email) setEmail(session.user.email)
    // Runs once per new session, to prefill an empty form without overwriting what the applicant typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  // Sign-up before the form: Google (verified email, prefilled name) or a plain email and password.
  const [signupEmail, setSignupEmail] = useState('')
  const [signupPassword, setSignupPassword] = useState('')
  const [signingUp, setSigningUp] = useState(false)
  const [signupSent, setSignupSent] = useState(false)
  const [signupError, setSignupError] = useState<string | null>(null)

  const signUpWithEmail = async (e: FormEvent) => {
    e.preventDefault()
    setSignupError(null)
    const email = signupEmail.trim()
    if (!EMAIL_PATTERN.test(email)) { setSignupError('Enter an email like you@company.com.'); return }
    if (signupPassword.length < MIN_PASSWORD_LENGTH) { setSignupError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`); return }
    setSigningUp(true)
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password: signupPassword,
        options: { data: { role: 'vendor' }, emailRedirectTo: `${window.location.origin}/3pl/onboard` },
      })
      if (error) {
        setSignupError(/already registered|already exists/i.test(error.message) ? 'An account with this email already exists. Sign in instead, then apply.' : error.message)
        return
      }
      if (data.session) {
        setSession(data.session)
        setUserLoading(false)
        return
      }
      setSignupSent(true)
    } catch {
      setSignupError('We could not create your account. Try again.')
    } finally {
      setSigningUp(false)
    }
  }

  // Warn on refresh if form has data and is not submitted
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if ((ownerName || mobile || location || step > 0) && !submitted) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [ownerName, mobile, location, step, submitted])

  // Return to step 1 if state is lost (e.g. after a refresh)
  useEffect(() => {
    if (step > 0 && !submitted) {
      if (!ownerName || !email || !mobile || !location) {
        setSearchParams({ step: '0' }, { replace: true })
      }
    }
  }, [step, ownerName, email, mobile, location, submitted, setSearchParams])

  if (userLoading) {
    return <div className="min-h-screen bg-bg flex items-center justify-center">Loading...</div>
  }

  if (!session) {
    return (
      <Page width="form" className="py-12">
        <PageHeader title="Join Margix as a Truck Partner" description="Create an account to start your application. You'll fill in your truck details next." />
        <Card padded className="mt-8 max-w-sm mx-auto">
          <Button
            variant="secondary"
            size="lg"
            fullWidth
            className="flex items-center justify-center gap-2"
            onClick={() => supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/3pl/onboard` } })}
          >
            <GoogleIcon />
            Continue with Google
          </Button>
          <div className="relative my-4 flex items-center justify-center">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border" /></div>
            <span className="relative bg-surface px-2 text-xs uppercase text-muted">or</span>
          </div>

          {signupSent ? (
            <Alert tone="success">Check {signupEmail.trim()} for a confirmation link, then come back here to continue.</Alert>
          ) : (
            <form onSubmit={signUpWithEmail} className="space-y-3" noValidate>
              {signupError && <Alert tone="danger">{signupError}</Alert>}
              <Input
                label="Email"
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                value={signupEmail}
                onChange={e => setSignupEmail(e.target.value)}
              />
              <Input
                label="Password"
                type="password"
                autoComplete="new-password"
                placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                value={signupPassword}
                onChange={e => setSignupPassword(e.target.value)}
              />
              <Button type="submit" size="lg" fullWidth loading={signingUp}>
                {signingUp ? 'Creating account…' : 'Create account & continue'}
              </Button>
            </form>
          )}
          <p className="mt-4 text-xs text-muted text-center">
            Already applied? <a href="/3pl/onboard/track" className="underline">Track your application</a> or <a href="/login" className="underline">sign in</a>.
          </p>
        </Card>
      </Page>
    )
  }

  const next = async () => {
    setDirection('forward')
    if (step === 0) {
      if (!ownerName || !email || !mobile || !location) {
        toast.error('Please fill all fields.')
        return
      }
      if (!EMAIL_PATTERN.test(email.trim())) {
        toast.error('Please enter a valid email address.')
        return
      }
      const digits = mobile.replace(/\D/g, '')
      if (digits.length < 10) {
        toast.error('Please enter a valid 10-digit mobile number.')
        return
      }
    }
    if (step === 1 && fleetSize === 'single' && !truckType) {
      toast.error('Please select a truck type.')
      return
    }
    if (step === 1 && fleetSize === 'multiple' && Object.values(multipleTruckCounts).reduce((a, b) => a + b, 0) === 0) {
      toast.error('Please select at least one truck.')
      return
    }
    
    if (step === STEPS.length - 1) {
      setIsSubmitting(true)
      try {
        const res = await tplAPI.onboard({
          companyName: ownerName,
          phone: mobile,
          email: email.trim() || session?.user?.email || '',
          operatingFrom: location,
          fleetSize,
          truckType: fleetSize === 'single' ? truckType : JSON.stringify(multipleTruckCounts),
          user_id: session?.user?.id
        })
        toast.success('Successfully onboarded!')
        const partnerId = res?.partner?.id
        if (partnerId && session) {
          const account = await loadAccount(session.user.id).catch(() => ({
            role: 'vendor',
            hasVendorProfile: false,
            tplPartnerId: partnerId,
          }))
          useAuthStore.getState().setSession(session, account.role || 'vendor', partnerId)
          navigate(`/3pl-portal/${partnerId}`, { replace: true })
          return
        }
        setCreatedPartnerId(partnerId || null)
        setSubmitted(true)
      } catch (err) {
        const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed to onboard.'
        toast.error(message)
        if (session?.user && /already exists/i.test(message)) {
          try {
            const existing = await tplAPI.byUser(session.user.id)
            if (existing?.id) {
              const account = await loadAccount(session.user.id).catch(() => ({
                role: 'vendor',
                hasVendorProfile: false,
                tplPartnerId: existing.id,
              }))
              useAuthStore.getState().setSession(session, account.role || 'vendor', existing.id)
              navigate(`/3pl-portal/${existing.id}`, { replace: true })
            }
          } catch {
            // ignore
          }
        }
      } finally {
        setIsSubmitting(false)
      }
      return
    }
    setStep((s) => Math.min(STEPS.length - 1, s + 1))
  }

  const back = () => {
    setDirection('backward')
    setStep((s) => Math.max(0, s - 1))
  }


  const selectedVehicle = vehicles?.find(v => v.key === truckType)

  if (submitted) {
    return (
      <Page width="form" className="!space-y-4 py-8 flex items-center justify-center min-h-[60vh]">
        <Card padded className="text-center space-y-6 max-w-md w-full">
          <div className="mx-auto w-16 h-16 bg-success/10 text-success flex items-center justify-center rounded-full mb-4">
            <CheckCircle2 size={32} />
          </div>
          <h2 className="text-2xl font-semibold text-text">Application Submitted!</h2>
          <p className="text-muted">
            Your truck details have been successfully registered.
          </p>
          <div className="p-4 bg-surface-subtle border border-border rounded-control">
            <p className="font-medium text-text">
              Your application is pending approval. We'll email you as soon as it's reviewed — you can keep
              signing in with Google to check its status in the meantime.
            </p>
          </div>
          <button onClick={() => navigate(createdPartnerId ? `/3pl-portal/${createdPartnerId}` : '/3pl/onboard/track')} className="w-full py-3 bg-brand text-brand-fill font-semibold rounded-control transition-opacity hover:opacity-90">
            Go to 3PL Portal
          </button>
        </Card>
      </Page>
    )
  }

  return (
    <Page width="form" className="!space-y-4 py-8 overflow-hidden">
      <PageHeader
        title="Join Margix as a Truck Partner"
        description="Register in under a minute. Tell us about your fleet, you can upload documents later."
      />

      <Stepper step={step} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 relative">
        <div
          className={clsx(
            'lg:col-span-8 transition-transform duration-300 ease-in-out',
            direction === 'forward' ? 'animate-slide-in-right' : 'animate-slide-in-left'
          )}
          key={step}
        >
          <Card padded className="min-h-[400px]">
            <h2 className="text-lg font-semibold mb-6">{STEPS[step]}</h2>
            
            {step === 0 && (
              <div className="space-y-6">
                <Input
                  label="Contact person"
                  required
                  placeholder="Full name"
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                />
                <Input
                  label="Email"
                  required
                  type="email"
                  autoComplete="email"
                  placeholder="you@company.com"
                  hint="This is where we'll send your application status and, once approved, your partner portal access."
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <Input
                  label="Mobile number"
                  required
                  placeholder="10-digit mobile number"
                  type="tel"
                  maxLength={10}
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value.replace(/\D/g, ''))}
                />
                <Input
                  label="Operating from"
                  required
                  placeholder="E.g., Mumbai, MH"
                  hint="Your base location"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                />
              </div>
            )}

            {step === 1 && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <button
                    onClick={() => setFleetSize('single')}
                    className={clsx(
                      'flex flex-col items-center justify-center p-6 border rounded-control transition-colors',
                      fleetSize === 'single' ? 'border-brand bg-brand-fill text-brand' : 'border-border text-muted hover:border-text hover:text-text'
                    )}
                  >
                    <Truck size={32} className="mb-2" />
                    <span className="font-semibold text-sm">Single Truck</span>
                  </button>
                  <button
                    onClick={() => setFleetSize('multiple')}
                    className={clsx(
                      'flex flex-col items-center justify-center p-6 border rounded-control transition-colors',
                      fleetSize === 'multiple' ? 'border-brand bg-brand-fill text-brand' : 'border-border text-muted hover:border-text hover:text-text'
                    )}
                  >
                    <Blocks size={32} className="mb-2" />
                    <span className="font-semibold text-sm">Multiple Trucks</span>
                  </button>
                </div>

                {fleetSize === 'multiple' && (
                  <div className="space-y-4 pt-4 border-t border-border">
                    <p className="text-sm font-medium text-text">Specify how many of each vehicle you have:</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {vehicles?.map(v => {
                        const count = multipleTruckCounts[v.key] || 0;
                        return (
                          <div key={v.key} className={clsx("flex items-center justify-between p-3 border rounded-control transition-colors", count > 0 ? "border-brand bg-brand-fill/50" : "border-border")}>
                            <span className="font-medium text-sm text-text">{v.name}</span>
                            <div className="flex items-center space-x-3 bg-surface rounded-full border border-border px-2 py-1">
                              <button 
                                onClick={() => setMultipleTruckCounts(p => ({...p, [v.key]: Math.max(0, count - 1)}))}
                                className="w-6 h-6 flex items-center justify-center text-muted hover:text-text hover:bg-surface-subtle rounded-full transition-colors"
                              >-</button>
                              <span className="text-sm font-semibold w-4 text-center">{count}</span>
                              <button 
                                onClick={() => setMultipleTruckCounts(p => ({...p, [v.key]: count + 1}))}
                                className="w-6 h-6 flex items-center justify-center text-brand hover:bg-brand-fill rounded-full transition-colors"
                              >+</button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {fleetSize === 'single' && (
                  <div className="space-y-4 pt-4 border-t border-border">
                    <Select
                      label="Select Truck Name"
                      value={truckType}
                      onChange={(e) => setTruckType(e.target.value)}
                    >
                      <option value="" disabled>Select a truck type...</option>
                      {vehicles?.map(v => (
                        <option key={v.key} value={v.key}>{v.name}</option>
                      ))}
                    </Select>
                    
                    {selectedVehicle && (
                      <div className="p-4 bg-surface-subtle border border-border rounded-control">
                        <p className="text-sm font-medium text-text">Auto-detected Load Capacity:</p>
                        <p className="text-2xl font-semibold text-brand mt-1">{selectedVehicle.max_t} Tons</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {step > 1 && (
              <div className="space-y-6">
                <div className="p-6 bg-surface-subtle border border-border rounded-control space-y-4">
                  <h3 className="font-semibold text-text">Application Summary</h3>
                  
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-muted block mb-1">Contact person</span>
                      <span className="font-medium text-text">{ownerName}</span>
                    </div>
                    <div>
                      <span className="text-muted block mb-1">Email</span>
                      <span className="font-medium text-text">{email}</span>
                    </div>
                    <div>
                      <span className="text-muted block mb-1">Mobile number</span>
                      <span className="font-medium text-text">{mobile}</span>
                    </div>
                    <div>
                      <span className="text-muted block mb-1">Operating from</span>
                      <span className="font-medium text-text">{location}</span>
                    </div>
                    
                    <div className="col-span-2 pt-4 border-t border-border">
                      <span className="text-muted block mb-3">Selected Trucks</span>
                      {fleetSize === 'single' && truckType ? (
                        <div className="inline-flex items-center px-3 py-1 bg-surface border border-border rounded-full font-medium">
                          1x {vehicles?.find(v => v.key === truckType)?.name}
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(multipleTruckCounts).filter(([_, count]) => count > 0).map(([key, count]) => (
                            <div key={key} className="inline-flex items-center px-3 py-1 bg-brand-fill text-brand border border-brand rounded-full font-medium">
                              {count}x {vehicles?.find(v => v.key === key)?.name || key}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                
                <p className="text-sm text-muted text-center">
                  Review your details above, then submit. You can add PAN, GST and other documents from
                  your partner portal once your application is approved.
                </p>
              </div>
            )}
          </Card>
        </div>

        <div className="hidden space-y-4 lg:block lg:col-span-4">
          <Card padded className="bg-text">
            <h3 className="text-sm font-semibold text-white">What happens after you apply</h3>
            <ol className="mt-4 space-y-4">
              {[
                ['Submit your application', 'Takes under a minute — you can add documents later.'],
                ['Our team reviews it', 'Usually within one business day.'],
                ["You're in", "We'll email you, and you can start getting load offers."],
              ].map(([title, body], i) => (
                <li key={title} className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-fill text-xs font-semibold text-on-brand">
                    {i + 1}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-white">{title}</p>
                    <p className="mt-0.5 text-xs text-white/60">{body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>

          <Card padded>
            <h3 className="font-semibold text-text text-sm mb-3">Before you continue</h3>
            <ul className="space-y-3 text-xs text-muted">
              <li className="flex items-start gap-2">
                <CheckCircle2 size={16} className="text-brand shrink-0" />
                Keep your PAN card handy
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 size={16} className="text-brand shrink-0" />
                Know your preferred corridors
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 size={16} className="text-brand shrink-0" />
                Add GST details if available
              </li>
            </ul>
          </Card>
        </div>
      </div>

      <Card padded className="mt-6">
        <div className="flex items-center justify-between">
          <Button variant="secondary" onClick={back} disabled={step === 0} icon={<ChevronLeft size={16} />}>
            Back
          </Button>
          <Button onClick={next} disabled={isSubmitting} variant={step === STEPS.length - 1 ? 'primary' : 'secondary'}>
            {step === STEPS.length - 1 ? (isSubmitting ? 'Submitting...' : 'Submit') : 'Next'}
            {step !== STEPS.length - 1 && <ChevronRight size={16} className="ml-1" />}
          </Button>
        </div>
      </Card>
      
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(20px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes slideInLeft {
          from { transform: translateX(-20px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        .animate-slide-in-right { animation: slideInRight 0.3s ease-out forwards; }
        .animate-slide-in-left { animation: slideInLeft 0.3s ease-out forwards; }
      `}</style>
    </Page>
  )
}
