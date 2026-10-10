import { useState, useEffect } from 'react'
import { Page, PageHeader, Card, Input, Button, Select } from '@/components/ui'
import { CheckCircle2, ChevronLeft, ChevronRight, Truck, Blocks } from 'lucide-react'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import { supabase } from '@/services/supabase'
import type { Session } from '@supabase/supabase-js'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { publicAPI, tplAPI } from '@/services/api'

const STEPS = [
  'Contact Details',
  'Fleet Details',
  'Review',
]

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
  const [mobile, setMobile] = useState('')
  const [location, setLocation] = useState('')
  
  // Step 2
  const [fleetSize, setFleetSize] = useState<'single' | 'multiple' | null>(null)
  const [truckType, setTruckType] = useState('')
  const [multipleTruckCounts, setMultipleTruckCounts] = useState<Record<string, number>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  const [userLoading, setUserLoading] = useState(true)
  const [session, setSession] = useState<Session | null>(null)

  const { data: vehicles } = useQuery({ queryKey: ['public', 'vehicle-classes'], queryFn: () => publicAPI.vehicleClasses() })

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setUserLoading(false)
    })
  }, [])

  const next = async () => {
    setDirection('forward')
    if (step === 0) {
      if (!ownerName || !mobile || !location) {
        toast.error('Please fill all fields.')
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
        await tplAPI.onboard({
          companyName: ownerName,
          phone: mobile,
          email: session?.user?.email || '',
          operatingFrom: location,
          fleetSize,
          truckType: fleetSize === 'single' ? truckType : JSON.stringify(multipleTruckCounts),
          user_id: session?.user?.id
        })
        toast.success('Successfully onboarded!')
        setSubmitted(true)
      } catch (err) {
        toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed to onboard.')
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

  if (userLoading) {
    return <div className="min-h-screen bg-bg flex items-center justify-center">Loading...</div>
  }

  if (!session) {
    return (
      <Page width="form" className="py-12">
        <PageHeader title="Join Margix as a Truck Partner" description="Register in under a minute" />
        <Card padded className="mt-8 text-center max-w-sm mx-auto">
          <Button
            className="w-full flex justify-center items-center gap-2"
            onClick={() => supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.href } })}
          >
            Sign in with Google
          </Button>
          <p className="mt-4 text-xs text-muted">Sign in to start your quick 3PL application.</p>
        </Card>
      </Page>
    )
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
              Please check your email for your login credentials to access the 3PL Portal.
            </p>
          </div>
          <button onClick={() => navigate('/3pl/dashboard')} className="w-full py-3 bg-brand text-brand-fill font-semibold rounded-control transition-opacity hover:opacity-90">
            Go to Dashboard
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
                  label="Owner / Contact Person Name *"
                  placeholder="Enter full name"
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                />
                <Input
                  label="Mobile Number *"
                  placeholder="10-digit mobile number"
                  type="tel"
                  maxLength={10}
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value.replace(/\D/g, ''))}
                />
                <Input
                  label="Operating From (Base Location) *"
                  placeholder="E.g., Mumbai, MH"
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
                      <span className="text-muted block mb-1">Owner Name</span>
                      <span className="font-medium text-text">{ownerName}</span>
                    </div>
                    <div>
                      <span className="text-muted block mb-1">Operating From</span>
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
                  Please review your details above. If everything is correct, submit your application. 
                  These trucks are requested for our active load tracking system.
                </p>
              </div>
            )}
          </Card>
        </div>

        <div className="hidden space-y-4 lg:block lg:col-span-4">
          <Card className="overflow-hidden">
            <div className="h-32 bg-surface-subtle flex items-center justify-center border-b border-border">
              <span className="text-muted text-xs">Image placeholder</span>
            </div>
            <div className="p-4">
              <h3 className="font-semibold text-text text-sm mb-1">A few details, then you're ready.</h3>
              <p className="text-xs text-muted leading-relaxed">
                We collect just the essentials so you can start browsing relevant loads immediately.
              </p>
            </div>
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
