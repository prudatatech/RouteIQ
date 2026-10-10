import { useState, useEffect } from 'react'
import { Page, PageHeader, Card, Input, Button, Select } from '@/components/ui'
import { CheckCircle2, ChevronLeft, ChevronRight, Truck, Blocks } from 'lucide-react'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import { supabase } from '@/services/supabase'
import type { Session } from '@supabase/supabase-js'
import { useQuery } from '@tanstack/react-query'
import { publicAPI, tplAPI } from '@/services/api'

const STEPS = [
  'Contact Details',
  'Fleet Details',
  'Operations',
  'Documents',
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
  const [step, setStep] = useState(0)
  const [direction, setDirection] = useState<'forward' | 'backward'>('forward')
  
  // Step 1
  const [ownerName, setOwnerName] = useState('')
  const [mobile, setMobile] = useState('')
  const [location, setLocation] = useState('')
  
  // Step 2
  const [fleetSize, setFleetSize] = useState<'single' | 'multiple' | null>(null)
  const [truckType, setTruckType] = useState('')
  const [multipleTruckTypes, setMultipleTruckTypes] = useState<string[]>([])
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
    if (step === 1 && fleetSize === 'multiple' && multipleTruckTypes.length === 0) {
      toast.error('Please select at least one truck type.')
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
          truckType: fleetSize === 'single' ? truckType : multipleTruckTypes.join(','),
          user_id: session?.user?.id
        })
        toast.success('Successfully onboarded! Redirecting to Dashboard...')
        setTimeout(() => window.location.href = '/3pl/dashboard', 2000)
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
                    <p className="text-sm font-medium text-text">Select all vehicle types in your fleet:</p>
                    <div className="flex flex-wrap gap-2">
                      {vehicles?.map(v => (
                        <button
                          key={v.key}
                          onClick={() => setMultipleTruckTypes(prev => prev.includes(v.key) ? prev.filter(k => k !== v.key) : [...prev, v.key])}
                          className={clsx(
                            'px-4 py-2 rounded-full border text-sm font-medium transition-colors',
                            multipleTruckTypes.includes(v.key) ? 'border-brand bg-brand-fill text-brand' : 'border-border text-muted hover:border-text hover:text-text'
                          )}
                        >
                          {v.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {fleetSize === 'single' && (
                  <div className="space-y-4 pt-4 border-t border-border">
                    <Select
                      label="Select Truck Type"
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
              <div className="flex items-center justify-center h-48 text-muted border-2 border-dashed border-border rounded-control">
                <p>This is a placeholder for the {STEPS[step]} step.</p>
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
