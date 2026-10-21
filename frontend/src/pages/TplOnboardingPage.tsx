import { useState, useEffect, type FormEvent } from 'react'
import { Page, Card, Input, Button, Select, Alert, Stepper, IfscField } from '@/components/ui'
import {
  CheckCircle2, ChevronLeft, ChevronRight, Truck, Blocks, Zap, ShieldCheck,
  Landmark, FileText, Building, Phone, Mail, Clock, Headphones, Award, Check,
  ExternalLink, Sparkles
} from 'lucide-react'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import { supabase } from '@/services/supabase'
import type { Session } from '@supabase/supabase-js'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams, useNavigate, Link } from 'react-router-dom'
import { publicAPI, tplAPI } from '@/services/api'
import { useAuthStore } from '@/store/authStore'
import { loadAccount } from '@/services/account'
import { errorMessage } from '@/utils/display'
import { DocUploadField } from '@/components/kyc/DocUploadField'
import DocumentViewerModal from '@/components/ui/DocumentViewerModal'
import { uploadTplDocument } from '@/services/tplDocuments'
import { getKycDocumentUrl } from '@/services/kycDocuments'
import { ENTITY_TYPE_OPTIONS, entityTypeRequiresCin, isCinFormat } from '@/utils/entityType'
import { gstinError } from '@/utils/gstin'
import { validatePanFormat, validateGstinFormat } from '@/utils/taxValidation'
import { TPL_DOCUMENT_TYPES, TPL_MSME_OPTIONS } from '@/components/tpl/constants'

const QUICK_STEPS = [
  'Contact Details',
  'Fleet Details',
  'Review',
]

const FULL_STEPS = [
  'Contact Details',
  'Fleet Details',
  'Business & Identity',
  'Bank Details',
  'KYC Documents',
  'Review',
]

const STEP_DESCRIPTIONS: Record<string, string> = {
  'Contact Details': 'Primary contact, operating base & speed',
  'Fleet Details': 'Fleet scale & vehicle carrying capacity',
  'Business & Identity': 'Entity type, PAN card & GSTIN verification',
  'Bank Details': 'Bank account for freight payouts & settlements',
  'KYC Documents': 'Upload verified company & compliance scans',
  'Review': 'Confirm application details before submission',
}

const MIN_PASSWORD_LENGTH = 8
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/
const ACCOUNT_PATTERN = /^\d{9,18}$/
const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/i

function suggestCustomId(companyName: string): string {
  const base = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 14) || 'partner'
  const suffix = Math.floor(1000 + Math.random() * 9000)
  return `${base}_${suffix}`.slice(0, 20)
}

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
  const [companyName, setCompanyName] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [email, setEmail] = useState('')
  const [mobile, setMobile] = useState('')
  const [location, setLocation] = useState('')
  const [emailTakenError, setEmailTakenError] = useState<string | null>(null)
  const [mobileTakenError, setMobileTakenError] = useState<string | null>(null)
  const [checkingEmail, setCheckingEmail] = useState(false)
  const [checkingMobile, setCheckingMobile] = useState(false)
  
  // Flow mode: Quick Onboard (contact + fleet) vs Complete Self-Onboarding (PAN, GSTIN, Bank, KYC docs)
  const [onboardingMode, setOnboardingMode] = useState<'quick' | 'full'>('quick')
  const steps = onboardingMode === 'quick' ? QUICK_STEPS : FULL_STEPS

  // Full onboarding fields
  const [customId, setCustomId] = useState('')
  const [pan, setPan] = useState('')
  const [gst, setGst] = useState('')
  const [entityType, setEntityType] = useState('')
  const [cin, setCin] = useState('')
  const [authorizedSignatoryName, setAuthorizedSignatoryName] = useState('')
  const [msmeStatus, setMsmeStatus] = useState('Not Registered')
  const [bankAccount, setBankAccount] = useState('')
  const [bankIfsc, setBankIfsc] = useState('')
  const [docUrls, setDocUrls] = useState<Record<string, string>>({})
  const [uploadingDocType, setUploadingDocType] = useState<string | null>(null)
  const [viewer, setViewer] = useState<{ url: string; name: string } | null>(null)

  const [attemptedStep0, setAttemptedStep0] = useState(false)
  const [attemptedStep2, setAttemptedStep2] = useState(false)
  const [attemptedStep3, setAttemptedStep3] = useState(false)

  const step0Errors = {
    companyName: !companyName.trim() ? 'Company name is required.' : undefined,
    ownerName: !ownerName.trim() ? 'Contact person is required.' : undefined,
    email: !email.trim() ? 'Email is required.' : !EMAIL_PATTERN.test(email.trim()) ? 'Please enter a valid email address.' : undefined,
    mobile: !mobile.trim() ? 'Mobile number is required.' : mobile.replace(/\D/g, '').length < 10 ? 'Please enter a valid 10-digit mobile number.' : undefined,
    location: !location.trim() ? 'Operating location is required.' : undefined,
  }

  const step2Errors = {
    entityType: !entityType ? 'Please select an entity type.' : undefined,
    authorizedSignatoryName: !authorizedSignatoryName.trim() ? 'Please enter the authorized signatory name.' : undefined,
    pan: !pan.trim() ? 'PAN is required.' : !PAN_PATTERN.test(pan.trim().toUpperCase()) ? 'Please enter a valid PAN (e.g. ABCDE1234F).' : undefined,
    cin: entityTypeRequiresCin(entityType) && (!cin.trim() || !isCinFormat(cin.trim().toUpperCase())) ? 'Please enter a valid 21-digit CIN.' : undefined,
    gst: gst.trim() ? gstinError(gst.trim().toUpperCase(), pan.trim().toUpperCase()) : undefined,
  }

  const step3Errors = {
    bankAccount: !bankAccount.trim() ? 'Bank account is required.' : !ACCOUNT_PATTERN.test(bankAccount.trim()) ? 'Please enter a valid 9 to 18 digit bank account number.' : undefined,
    bankIfsc: !bankIfsc.trim() ? 'Bank IFSC is required.' : !IFSC_PATTERN.test(bankIfsc.trim().toUpperCase()) ? 'Please enter a valid 11-character IFSC code.' : undefined,
  }

  const handleGstChange = (val: string) => {
    const upper = val.toUpperCase()
    setGst(upper)
    if (!pan.trim() && upper.length >= 12) {
      const derived = upper.slice(2, 12)
      if (PAN_PATTERN.test(derived)) {
        setPan(derived)
      }
    }
  }

  // Step 2
  const [fleetSize, setFleetSize] = useState<'single' | 'multiple' | null>(null)
  const [truckType, setTruckType] = useState('')
  const [multipleTruckCounts, setMultipleTruckCounts] = useState<Record<string, number>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  const [userLoading, setUserLoading] = useState(true)
  const [session, setSession] = useState<Session | null>(null)

  const [createdPartnerId, setCreatedPartnerId] = useState<string | null>(null)

  const { data: vehicles } = useQuery({ queryKey: ['public', 'vehicle-classes'], queryFn: () => publicAPI.vehicleClasses() })

  const uploadDoc = async (docType: string, file: File) => {
    let targetCustomId = customId
    if (!targetCustomId) {
      targetCustomId = suggestCustomId(companyName)
      setCustomId(targetCustomId)
    }
    setUploadingDocType(docType)
    try {
      const path = await uploadTplDocument(file, docType, { customId: targetCustomId })
      setDocUrls(u => ({ ...u, [docType]: path }))
      toast.success(`${docType} uploaded`)
    } catch (err) {
      toast.error(errorMessage(err, `Failed to upload ${docType}.`))
    } finally {
      setUploadingDocType(null)
    }
  }

  const removeDoc = (docType: string) => {
    setDocUrls(u => {
      const next = { ...u }
      delete next[docType]
      return next
    })
  }

  const openDocViewer = async (path: string, name: string) => {
    try {
      setViewer({ url: await getKycDocumentUrl(path), name })
    } catch {
      toast.error('Could not open document.')
    }
  }

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
      if (isMounted) setUserLoading(false)
    }

    const isOAuthReturn = window.location.hash.includes('access_token')

    if (isOAuthReturn) {
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

  useEffect(() => {
    if (!session?.user) return
    if (!ownerName) {
      const name = session.user.user_metadata?.full_name || session.user.user_metadata?.name
      if (typeof name === 'string' && name.trim()) setOwnerName(name.trim())
    }
    if (!email && session.user.email) setEmail(session.user.email)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  const [signupEmail, setSignupEmail] = useState('')
  const [signupPassword, setSignupPassword] = useState('')
  const [signingUp, setSigningUp] = useState(false)
  const [signupSent, setSignupSent] = useState(false)
  const [signupError, setSignupError] = useState<string | null>(null)

  const signUpWithEmail = async (e: FormEvent) => {
    e.preventDefault()
    setSignupError(null)
    const emailToUse = signupEmail.trim()
    if (!EMAIL_PATTERN.test(emailToUse)) { setSignupError('Enter an email like you@company.com.'); return }
    if (signupPassword.length < MIN_PASSWORD_LENGTH) { setSignupError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`); return }
    setSigningUp(true)
    try {
      const { data, error } = await supabase.auth.signUp({
        email: emailToUse,
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
      if ((companyName || ownerName || mobile || location || step > 0) && !submitted) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [companyName, ownerName, mobile, location, step, submitted])

  // Return to step 1 if state is lost (e.g. after a refresh)
  useEffect(() => {
    if (step > 0 && !submitted) {
      if (!companyName || !ownerName || !email || !mobile || !location) {
        setSearchParams({ step: '0' }, { replace: true })
      }
    }
  }, [step, companyName, ownerName, email, mobile, location, submitted, setSearchParams])

  const checkEmailTaken = async (value: string) => {
    const trimmed = value.trim()
    if (!EMAIL_PATTERN.test(trimmed)) { setEmailTakenError(null); return false }
    setCheckingEmail(true)
    try {
      const { taken } = await tplAPI.checkAvailability('email', trimmed)
      setEmailTakenError(taken ? 'An application with this email already exists. Use your tracking ID to view it.' : null)
      return taken
    } catch {
      return false
    } finally {
      setCheckingEmail(false)
    }
  }

  const checkMobileTaken = async (value: string) => {
    const digits = value.replace(/\D/g, '')
    if (digits.length < 10) { setMobileTakenError(null); return false }
    setCheckingMobile(true)
    try {
      const { taken } = await tplAPI.checkAvailability('phone', digits)
      setMobileTakenError(taken ? 'An application with this mobile number already exists. Use your tracking ID to view it.' : null)
      return taken
    } catch {
      return false
    } finally {
      setCheckingMobile(false)
    }
  }

  const next = async () => {
    setDirection('forward')
    if (step === 0) {
      setAttemptedStep0(true)
      const firstError = Object.values(step0Errors).find(Boolean)
      if (firstError) {
        toast.error(firstError)
        return
      }
      const [emailTaken, mobileTaken] = await Promise.all([checkEmailTaken(email), checkMobileTaken(mobile)])
      if (emailTaken || mobileTaken) return
    }
    if (step === 1 && fleetSize === 'single' && !truckType) {
      toast.error('Please select a truck type.')
      return
    }
    if (step === 1 && fleetSize === 'multiple' && Object.values(multipleTruckCounts).reduce((a, b) => a + b, 0) === 0) {
      toast.error('Please select at least one truck.')
      return
    }

    if (onboardingMode === 'full') {
      if (step === 2) {
        setAttemptedStep2(true)
        const firstError = Object.values(step2Errors).find(Boolean)
        if (firstError) {
          toast.error(firstError)
          return
        }
      }
      if (step === 3) {
        setAttemptedStep3(true)
        const firstError = Object.values(step3Errors).find(Boolean)
        if (firstError) {
          toast.error(firstError)
          return
        }
      }
      if (step === 4) {
        if (!docUrls['PAN Card']) {
          toast.error('Please upload your PAN Card to proceed.')
          return
        }
      }
    }
    
    if (step === steps.length - 1) {
      setIsSubmitting(true)
      try {
        const payload: Record<string, unknown> = {
          companyName: companyName.trim(),
          contactName: ownerName.trim(),
          phone: mobile,
          operating_from: location.trim(),
          fleet_size: fleetSize,
          truck_type: fleetSize === 'single' 
            ? truckType 
            : Object.entries(multipleTruckCounts).filter(([_, c]) => c > 0).map(([k, c]) => `${c}x ${k}`).join(', '),
          custom_id: customId || suggestCustomId(companyName),
        }

        if (onboardingMode === 'full') {
          payload.pan = pan.trim().toUpperCase()
          payload.gst = gst.trim() ? gst.trim().toUpperCase() : null
          payload.entityType = entityType
          payload.cin = cin.trim() ? cin.trim().toUpperCase() : null
          payload.authorizedSignatoryName = authorizedSignatoryName.trim()
          payload.msmeStatus = msmeStatus
          payload.bankAccount = bankAccount.trim()
          payload.bankIfsc = bankIfsc.trim().toUpperCase()
          payload.documents = Object.entries(docUrls).map(([type, url]) => ({ type, url }))
        }

        const res = await tplAPI.onboard(payload)
        setSubmitted(true)
        if (res?.partner?.id) {
          setCreatedPartnerId(res.partner.id)
        }
        toast.success('Application submitted successfully!')
        
        if (session?.user) {
          try {
            const existing = await tplAPI.checkPartner({ user_id: session.user.id })
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
      } catch (err: unknown) {
        toast.error(errorMessage(err, 'Failed to submit application. Please check your inputs.'))
      } finally {
        setIsSubmitting(false)
      }
      return
    }
    setStep((s) => Math.min(steps.length - 1, s + 1))
  }

  const back = () => {
    setDirection('backward')
    setStep((s) => Math.max(0, s - 1))
  }

  const switchAccount = async () => {
    await supabase.auth.signOut().catch(() => undefined)
    setSession(null)
    setUserLoading(false)
  }

  const selectedVehicle = vehicles?.find(v => v.key === truckType)
  const totalTrucksCount = Object.values(multipleTruckCounts).reduce((a, b) => a + b, 0)
  const totalTonnage = vehicles ? Object.entries(multipleTruckCounts).reduce((sum, [key, count]) => {
    const v = vehicles.find(item => item.key === key)
    return sum + (v && v.max_t ? v.max_t * count : 0)
  }, 0) : 0

  if (userLoading) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
          <p className="text-sm font-medium text-muted">Loading partner portal…</p>
        </div>
      </div>
    )
  }

  // Common Header for unauthenticated and authenticated onboarding views
  const renderTopNavbar = () => (
    <header className="border-b border-border bg-surface/95 backdrop-blur-md sticky top-0 z-40">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2.5 rounded-control focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">
            <img src="/margix-logo.png" alt="Margix" className="h-8 w-8 object-contain" />
            <span className="text-lg font-bold tracking-tight text-text">
              Margix<span className="text-brand">India</span>
            </span>
          </Link>
          <div className="hidden h-5 w-px bg-border sm:block" />
          <span className="hidden text-xs font-semibold uppercase tracking-wider text-muted sm:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-surface-subtle border border-border">
            <Truck size={12} className="text-brand" /> 3PL Carrier Partner Network
          </span>
        </div>

        <div className="flex items-center gap-4 text-xs">
          <a href="tel:+9102248901234" className="hidden lg:flex items-center gap-1.5 text-muted hover:text-text transition-colors">
            <Phone size={13} className="text-brand" /> +91 (022) 4890-1234
          </a>
          <div className="hidden h-4 w-px bg-border lg:block" />
          <Link to="/3pl/onboard/track" className="text-muted hover:text-text font-medium transition-colors">
            Track Application
          </Link>
          {session ? (
            <div className="flex items-center gap-2 border-l border-border pl-4">
              <span className="text-muted hidden md:inline">
                Signed in as <strong className="text-text font-medium">{session.user.email}</strong>
              </span>
              <button
                type="button"
                onClick={switchAccount}
                className="text-xs text-brand font-semibold hover:underline cursor-pointer"
              >
                Switch
              </button>
            </div>
          ) : (
            <Link to="/login" className="font-semibold text-brand hover:underline">
              Sign In
            </Link>
          )}
        </div>
      </div>
    </header>
  )

  // 1. Unauthenticated Showcase Landing
  if (!session) {
    return (
      <div className="min-h-screen bg-bg flex flex-col">
        {renderTopNavbar()}

        <main className="flex-1 mx-auto max-w-6xl w-full px-4 sm:px-6 lg:px-8 py-10 lg:py-16">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14 items-center">
            {/* Left Column: Brand Hero & Value Proposition */}
            <div className="lg:col-span-7 space-y-6">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-soft/70 border border-brand/30 text-xs font-semibold text-brand">
                <Sparkles size={13} /> Official Carrier Partner Program
              </div>

              <div className="space-y-3">
                <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-text leading-[1.15]">
                  Drive High-Margin Loads. Get Paid <span className="text-brand">On Time</span>.
                </h1>
                <p className="text-base sm:text-lg text-muted leading-relaxed max-w-xl">
                  Join hundreds of verified 3PL fleet owners and truck operators across India. Direct enterprise freight, zero broker cuts, and hassle-free bank settlements.
                </p>
              </div>

              {/* 4 Core Value Pillars */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <div className="p-4 rounded-card bg-surface border border-border shadow-xs space-y-1.5">
                  <div className="flex items-center gap-2 font-semibold text-sm text-text">
                    <Zap size={16} className="text-brand shrink-0" />
                    <span>Direct Shipper Freight</span>
                  </div>
                  <p className="text-xs text-muted leading-relaxed">
                    Access premium corporate loads without paying margins to middlemen or brokers.
                  </p>
                </div>

                <div className="p-4 rounded-card bg-surface border border-border shadow-xs space-y-1.5">
                  <div className="flex items-center gap-2 font-semibold text-sm text-text">
                    <Landmark size={16} className="text-brand shrink-0" />
                    <span>Guaranteed Direct Settlements</span>
                  </div>
                  <p className="text-xs text-muted leading-relaxed">
                    Automated, on-time bank transfers as soon as proof of delivery is cleared.
                  </p>
                </div>

                <div className="p-4 rounded-card bg-surface border border-border shadow-xs space-y-1.5">
                  <div className="flex items-center gap-2 font-semibold text-sm text-text">
                    <Truck size={16} className="text-brand shrink-0" />
                    <span>Return-Trip Optimization</span>
                  </div>
                  <p className="text-xs text-muted leading-relaxed">
                    Eliminate empty deadhead miles with intelligent corridor matching.
                  </p>
                </div>

                <div className="p-4 rounded-card bg-surface border border-border shadow-xs space-y-1.5">
                  <div className="flex items-center gap-2 font-semibold text-sm text-text">
                    <Headphones size={16} className="text-brand shrink-0" />
                    <span>24/7 Dispatch Control</span>
                  </div>
                  <p className="text-xs text-muted leading-relaxed">
                    Live operational coordinators assist your drivers through every route and checkpost.
                  </p>
                </div>
              </div>

              {/* Trust Metric Badges */}
              <div className="pt-2 flex flex-wrap items-center gap-6 text-xs text-muted font-medium">
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 size={15} className="text-success" />
                  <span>5,000+ Verified Trucks</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 size={15} className="text-success" />
                  <span>₹15+ Cr Disbursed</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 size={15} className="text-success" />
                  <span>2-Minute Registration</span>
                </div>
              </div>
            </div>

            {/* Right Column: Clean Sign Up / Authentication Box */}
            <div className="lg:col-span-5">
              <Card padded className="p-6 sm:p-8 shadow-raised border border-border bg-surface rounded-card">
                <div className="mb-6 space-y-1">
                  <h2 className="text-xl font-bold text-text">Start Partner Application</h2>
                  <p className="text-xs text-muted">
                    Create or connect your account to submit your fleet details.
                  </p>
                </div>

                <Button
                  variant="secondary"
                  size="lg"
                  fullWidth
                  className="flex items-center justify-center gap-2.5 font-medium"
                  onClick={() => supabase.auth.signInWithOAuth({
                    provider: 'google',
                    options: { redirectTo: `${window.location.origin}/3pl/onboard` },
                  })}
                >
                  <GoogleIcon />
                  Continue with Google
                </Button>

                <div className="relative my-5 flex items-center justify-center">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-border" />
                  </div>
                  <span className="relative bg-surface px-3 text-xs uppercase tracking-wider text-muted font-medium">
                    or with work email
                  </span>
                </div>

                {signupSent ? (
                  <Alert tone="success" title="Check your inbox">
                    We sent a verification link to <strong className="font-semibold">{signupEmail.trim()}</strong>. Click the link to complete your account setup and resume your application.
                  </Alert>
                ) : (
                  <form onSubmit={signUpWithEmail} className="space-y-4" noValidate>
                    {signupError && <Alert tone="danger">{signupError}</Alert>}
                    <Input
                      label="Email address"
                      type="email"
                      autoComplete="email"
                      placeholder="you@transportagency.com"
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
                    <Button type="submit" size="lg" fullWidth loading={signingUp} className="font-semibold">
                      {signingUp ? 'Creating account…' : 'Create Account & Continue'}
                    </Button>
                  </form>
                )}

                <div className="mt-6 pt-5 border-t border-border text-center space-y-2 text-xs text-muted">
                  <p>
                    Already submitted an application?{' '}
                    <Link to="/3pl/onboard/track" className="text-brand font-semibold hover:underline">
                      Track Status
                    </Link>
                  </p>
                  <p>
                    Staff or platform administrator?{' '}
                    <Link to="/login" className="underline hover:text-text">
                      Sign In Here
                    </Link>
                  </p>
                </div>
              </Card>
            </div>
          </div>
        </main>
      </div>
    )
  }

  // 2. Submission Success View
  if (submitted) {
    return (
      <div className="min-h-screen bg-bg flex flex-col">
        {renderTopNavbar()}

        <main className="flex-1 flex items-center justify-center px-4 py-12">
          <Card padded className="text-center space-y-6 max-w-lg w-full p-8 sm:p-10 shadow-raised border border-border">
            <div className="mx-auto w-16 h-16 bg-success-soft text-success flex items-center justify-center rounded-full mb-2">
              <CheckCircle2 size={36} />
            </div>

            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-text">Application Submitted!</h2>
              <p className="text-sm text-muted leading-relaxed">
                {onboardingMode === 'full'
                  ? 'Your company profile, bank payout details, and KYC compliance documents have been sent to our dispatch operations team for verification.'
                  : 'Your fleet scale and contact details have been registered. Our partner operations team will contact you to finalize onboarding.'}
              </p>
            </div>

            <div className="p-4 bg-surface-subtle border border-border rounded-card text-left space-y-2 text-xs text-muted">
              <p className="font-semibold text-text flex items-center gap-1.5">
                <Clock size={14} className="text-brand" /> What happens next?
              </p>
              <ul className="space-y-1.5 list-disc pl-4 leading-relaxed">
                <li>Applications are reviewed within 1 business day.</li>
                <li>You will receive SMS & email notifications upon review.</li>
                <li>You can access your partner portal anytime using this email.</li>
              </ul>
            </div>

            <Button
              size="lg"
              fullWidth
              onClick={() => navigate(createdPartnerId ? `/3pl-portal/${createdPartnerId}` : '/3pl/onboard/track')}
              className="py-3 font-semibold"
            >
              Go to 3PL Partner Portal
            </Button>
          </Card>
        </main>
      </div>
    )
  }

  const progressPercent = Math.round(((step + 1) / steps.length) * 100)

  // 3. Authenticated Onboarding Wizard
  return (
    <div className="min-h-screen bg-bg flex flex-col">
      {renderTopNavbar()}

      <main className="flex-1 mx-auto max-w-6xl w-full px-4 sm:px-6 lg:px-8 py-8">
        {/* Full-width Horizontal Stepper */}
        <div className="mb-8">
          <Stepper steps={steps} current={step} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start relative">
          {/* Main Form Column (lg:col-span-8) */}
          <div
            className={clsx(
              'lg:col-span-8 transition-transform duration-300 ease-in-out',
              direction === 'forward' ? 'animate-slide-in-right' : 'animate-slide-in-left'
            )}
            key={step}
          >
            <Card padded className="p-6 sm:p-8 md:p-10 shadow-raised border border-border bg-surface rounded-card min-h-[540px] flex flex-col justify-between">
              <div>
                {/* Form Step Header */}
                <div className="flex items-center justify-between border-b border-border pb-5 mb-7">
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wider text-brand block mb-1">
                      Step {step + 1} of {steps.length}
                    </span>
                    <h2 className="text-2xl font-bold tracking-tight text-text">
                      {steps[step]}
                    </h2>
                  </div>
                  <span className="hidden sm:inline-flex text-xs font-semibold px-3 py-1 rounded-full bg-surface-subtle border border-border text-muted">
                    {onboardingMode === 'quick' ? 'Quick Mode' : 'Complete Mode'}
                  </span>
                </div>

                {/* Step 0: Contact Details & Mode Selection */}
                {step === 0 && (
                  <div className="space-y-7">
                    <div>
                      <label className="text-xs font-bold uppercase tracking-wider text-muted mb-3 block">
                        Choose Onboarding Speed
                      </label>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <button
                          type="button"
                          onClick={() => { setOnboardingMode('quick'); if (step > 2) setStep(2) }}
                          className={clsx(
                            'flex flex-col items-start p-5 text-left border rounded-card transition-all duration-200 cursor-pointer',
                            onboardingMode === 'quick'
                              ? 'border-brand bg-brand-soft/30 ring-2 ring-brand/40 shadow-xs'
                              : 'border-border bg-surface hover:border-text/40'
                          )}
                        >
                          <div className="flex items-center justify-between w-full mb-1.5">
                            <div className="flex items-center gap-1.5 font-bold text-sm text-text">
                              <Zap size={16} className="text-brand" />
                              <span>Quick Onboard (2 mins)</span>
                            </div>
                            <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-brand-soft text-brand">
                              Fastest
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-muted leading-relaxed">
                            Submit basic contact and fleet info. Our operations team will call to finish paperwork.
                          </p>
                          <div className="mt-3.5 flex items-center gap-2 text-xs text-muted font-medium">
                            <span className="flex items-center gap-1 text-success font-semibold">
                              <CheckCircle2 size={13} /> 3 simple steps
                            </span>
                            <span>•</span>
                            <span>Zero docs now</span>
                          </div>
                        </button>

                        <button
                          type="button"
                          onClick={() => setOnboardingMode('full')}
                          className={clsx(
                            'flex flex-col items-start p-5 text-left border rounded-card transition-all duration-200 cursor-pointer',
                            onboardingMode === 'full'
                              ? 'border-brand bg-brand-soft/30 ring-2 ring-brand/40 shadow-xs'
                              : 'border-border bg-surface hover:border-text/40'
                          )}
                        >
                          <div className="flex items-center justify-between w-full mb-1.5">
                            <div className="flex items-center gap-1.5 font-bold text-sm text-text">
                              <ShieldCheck size={16} className="text-brand" />
                              <span>Complete Self-Onboarding</span>
                            </div>
                            <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-surface-subtle text-muted border border-border">
                              Direct Approval
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-muted leading-relaxed">
                            Upload company PAN, GSTIN, bank details and KYC documents now for instant rate lock and faster dispatch.
                          </p>
                          <div className="mt-3.5 flex items-center gap-2 text-xs text-muted font-medium">
                            <span className="flex items-center gap-1 text-brand font-semibold">
                              <CheckCircle2 size={13} /> Rate contract lock
                            </span>
                            <span>•</span>
                            <span>Direct verification</span>
                          </div>
                        </button>
                      </div>
                    </div>

                    <div className="border-t border-border pt-6 space-y-5">
                      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                        <Input
                          label="Company name"
                          required
                          placeholder="Registered logistics business name"
                          value={companyName}
                          error={attemptedStep0 ? step0Errors.companyName : undefined}
                          onChange={(e) => {
                            setCompanyName(e.target.value)
                            if (!customId) setCustomId(suggestCustomId(e.target.value))
                          }}
                        />
                        <Input
                          label="Contact person"
                          required
                          placeholder="Full name of owner/manager"
                          value={ownerName}
                          error={attemptedStep0 ? step0Errors.ownerName : undefined}
                          onChange={(e) => setOwnerName(e.target.value)}
                        />
                      </div>

                      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                        <div>
                          <Input
                            label="Email"
                            required
                            type="email"
                            autoComplete="email"
                            placeholder="you@company.com"
                            hint={checkingEmail ? 'Checking availability…' : "We'll send application updates and portal credentials here."}
                            error={emailTakenError || (attemptedStep0 ? step0Errors.email : undefined)}
                            value={email}
                            onChange={(e) => { setEmail(e.target.value); setEmailTakenError(null) }}
                            onBlur={(e) => checkEmailTaken(e.target.value)}
                          />
                          {!emailTakenError && !checkingEmail && EMAIL_PATTERN.test(email.trim()) && (
                            <p className="mt-1 text-xs text-success flex items-center gap-1 font-medium">
                              <CheckCircle2 size={12} /> Email address available
                            </p>
                          )}
                        </div>

                        <div>
                          <Input
                            label="Mobile number"
                            required
                            placeholder="10-digit mobile number"
                            type="tel"
                            maxLength={10}
                            hint={checkingMobile ? 'Checking availability…' : undefined}
                            error={mobileTakenError || (attemptedStep0 ? step0Errors.mobile : undefined)}
                            value={mobile}
                            onChange={(e) => { setMobile(e.target.value.replace(/\D/g, '')); setMobileTakenError(null) }}
                            onBlur={(e) => checkMobileTaken(e.target.value)}
                          />
                          {!mobileTakenError && !checkingMobile && mobile.replace(/\D/g, '').length === 10 && (
                            <p className="mt-1 text-xs text-success flex items-center gap-1 font-medium">
                              <CheckCircle2 size={12} /> Valid 10-digit number
                            </p>
                          )}
                        </div>
                      </div>

                      <Input
                        label="Operating from"
                        required
                        placeholder="E.g., Mumbai, Maharashtra or Bhiwandi Hub"
                        hint="Primary dispatch base, terminal or city where trucks operate"
                        error={attemptedStep0 ? step0Errors.location : undefined}
                        value={location}
                        onChange={(e) => setLocation(e.target.value)}
                      />
                    </div>
                  </div>
                )}

                {/* Step 1: Fleet Details */}
                {step === 1 && (
                  <div className="space-y-7">
                    <div>
                      <label className="text-xs font-bold uppercase tracking-wider text-muted mb-3 block">
                        Select Fleet Scale
                      </label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <button
                          type="button"
                          onClick={() => setFleetSize('single')}
                          className={clsx(
                            'flex flex-col items-center justify-center p-6 border rounded-card transition-all duration-200 cursor-pointer',
                            fleetSize === 'single'
                              ? 'border-brand bg-brand-soft/30 text-brand ring-2 ring-brand/40 shadow-xs'
                              : 'border-border bg-surface text-muted hover:border-text/40 hover:text-text'
                          )}
                        >
                          <div className={clsx('p-3 rounded-full mb-2.5', fleetSize === 'single' ? 'bg-brand text-brand-fill' : 'bg-surface-subtle text-muted')}>
                            <Truck size={28} />
                          </div>
                          <span className="font-bold text-base text-text">Single Truck</span>
                          <span className="text-xs text-muted mt-0.5">Owner operator / single vehicle</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setFleetSize('multiple')}
                          className={clsx(
                            'flex flex-col items-center justify-center p-6 border rounded-card transition-all duration-200 cursor-pointer',
                            fleetSize === 'multiple'
                              ? 'border-brand bg-brand-soft/30 text-brand ring-2 ring-brand/40 shadow-xs'
                              : 'border-border bg-surface text-muted hover:border-text/40 hover:text-text'
                          )}
                        >
                          <div className={clsx('p-3 rounded-full mb-2.5', fleetSize === 'multiple' ? 'bg-brand text-brand-fill' : 'bg-surface-subtle text-muted')}>
                            <Blocks size={28} />
                          </div>
                          <span className="font-bold text-base text-text">Multiple Trucks</span>
                          <span className="text-xs text-muted mt-0.5">Fleet owner / transport agency</span>
                        </button>
                      </div>
                    </div>

                    {fleetSize === 'multiple' && (
                      <div className="space-y-5 pt-5 border-t border-border">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                          <p className="text-sm font-semibold text-text">Specify vehicle counts across your fleet:</p>
                          {totalTrucksCount > 0 && (
                            <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-brand-soft text-brand rounded-full text-xs font-bold border border-brand/30">
                              <Truck size={13} />
                              <span>{totalTrucksCount} Trucks · {totalTonnage.toFixed(1)} Tons Total Capacity</span>
                            </div>
                          )}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                          {vehicles?.map(v => {
                            const count = multipleTruckCounts[v.key] || 0
                            return (
                              <div
                                key={v.key}
                                className={clsx(
                                  'flex items-center justify-between p-4 border rounded-card transition-all duration-150',
                                  count > 0 ? 'border-brand bg-brand-soft/20 shadow-xs' : 'border-border bg-surface'
                                )}
                              >
                                <div>
                                  <span className="font-semibold text-sm text-text block">{v.name}</span>
                                  <span className="text-xs text-muted">{v.max_t} Tons payload</span>
                                </div>
                                <div className="flex items-center space-x-2.5 bg-surface rounded-full border border-border px-2.5 py-1 shadow-2xs">
                                  <button
                                    type="button"
                                    onClick={() => setMultipleTruckCounts(p => ({ ...p, [v.key]: Math.max(0, count - 1) }))}
                                    className="w-7 h-7 flex items-center justify-center text-muted hover:text-text hover:bg-surface-subtle rounded-full transition-colors cursor-pointer text-base font-bold disabled:opacity-30 disabled:cursor-not-allowed"
                                    disabled={count === 0}
                                  >
                                    -
                                  </button>
                                  <span className="text-sm font-bold w-6 text-center text-text">{count}</span>
                                  <button
                                    type="button"
                                    onClick={() => setMultipleTruckCounts(p => ({ ...p, [v.key]: count + 1 }))}
                                    className="w-7 h-7 flex items-center justify-center text-brand hover:bg-brand-soft rounded-full transition-colors cursor-pointer text-base font-bold"
                                  >
                                    +
                                  </button>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {fleetSize === 'single' && (
                      <div className="space-y-4 pt-5 border-t border-border">
                        <Select
                          label="Select Truck Name"
                          value={truckType}
                          onChange={(e) => setTruckType(e.target.value)}
                        >
                          <option value="" disabled>Select truck type and payload capacity...</option>
                          {vehicles?.map(v => (
                            <option key={v.key} value={v.key}>{v.name} ({v.max_t} Tons Payload)</option>
                          ))}
                        </Select>
                        
                        {selectedVehicle && (
                          <div className="p-4 bg-surface-subtle border border-border rounded-card flex items-center justify-between">
                            <div>
                              <p className="text-xs uppercase font-bold text-muted tracking-wider">Vehicle Specification</p>
                              <p className="text-base font-bold text-text mt-0.5">{selectedVehicle.name}</p>
                            </div>
                            <div className="text-right">
                              <p className="text-2xl font-bold text-brand">{selectedVehicle.max_t} Tons</p>
                              <p className="text-xs text-muted">Maximum Rated Payload</p>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Step 2: Identity & Tax (Complete Mode) */}
                {onboardingMode === 'full' && step === 2 && (
                  <div className="space-y-6">
                    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                      <Select
                        label="Entity Type"
                        required
                        value={entityType}
                        error={attemptedStep2 ? step2Errors.entityType : undefined}
                        onChange={e => setEntityType(e.target.value)}
                      >
                        <option value="" disabled>Select legal entity classification...</option>
                        {ENTITY_TYPE_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </Select>

                      <Input
                        label="Authorized Signatory Name"
                        required
                        placeholder="Full legal name of signatory"
                        value={authorizedSignatoryName}
                        error={attemptedStep2 ? step2Errors.authorizedSignatoryName : undefined}
                        onChange={e => setAuthorizedSignatoryName(e.target.value)}
                      />
                    </div>

                    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                      <div>
                        <Input
                          label="PAN Number"
                          required
                          placeholder="ABCDE1234F"
                          value={pan}
                          maxLength={10}
                          error={attemptedStep2 ? step2Errors.pan : undefined}
                          onChange={e => setPan(e.target.value.toUpperCase())}
                          inputClassName="font-mono uppercase text-base"
                        />
                        {pan && (
                          <div className="mt-1.5 flex items-center gap-1.5 text-xs">
                            {validatePanFormat(pan).valid ? (
                              <span className="text-success flex items-center gap-1 font-semibold">
                                <CheckCircle2 size={13} /> {validatePanFormat(pan).hint}
                              </span>
                            ) : (
                              <span className="text-muted">
                                {validatePanFormat(pan).hint || '10 alphanumeric characters'}
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      <div>
                        <Input
                          label="GSTIN (Optional)"
                          placeholder="07ABCDE1234F1Z5"
                          value={gst}
                          maxLength={15}
                          error={attemptedStep2 ? step2Errors.gst : undefined}
                          onChange={e => handleGstChange(e.target.value)}
                          inputClassName="font-mono uppercase text-base"
                        />
                        {gst && (
                          <div className="mt-1.5 flex items-center gap-1.5 text-xs">
                            {validateGstinFormat(gst, pan).valid ? (
                              <span className="text-success flex items-center gap-1 font-semibold">
                                <CheckCircle2 size={13} /> Valid GSTIN {pan ? '· Matches PAN' : ''}
                              </span>
                            ) : (
                              <span className="text-danger font-semibold">
                                {validateGstinFormat(gst, pan).error}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {entityTypeRequiresCin(entityType) && (
                      <Input
                        label="Corporate Identification Number (CIN)"
                        required
                        placeholder="U74999DL2019PTC123456"
                        value={cin}
                        maxLength={21}
                        error={attemptedStep2 ? step2Errors.cin : undefined}
                        onChange={e => setCin(e.target.value.toUpperCase())}
                        inputClassName="font-mono uppercase"
                        hint="21-character CIN from your Certificate of Incorporation"
                      />
                    )}

                    <Select
                      label="MSME Registration"
                      value={msmeStatus}
                      onChange={e => setMsmeStatus(e.target.value)}
                    >
                      {TPL_MSME_OPTIONS.map(opt => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </Select>
                  </div>
                )}

                {/* Step 3: Bank Details (Complete Mode) */}
                {onboardingMode === 'full' && step === 3 && (
                  <div className="space-y-6">
                    <div className="p-4 bg-brand-soft/30 border border-brand/30 rounded-card flex items-center gap-3 text-xs text-text">
                      <Landmark size={20} className="text-brand shrink-0" />
                      <span className="leading-relaxed">
                        Direct freight disbursements, detention allowances, and settlements will be credited directly to this verified business bank account.
                      </span>
                    </div>

                    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                      <Input
                        label="Bank Account Number"
                        required
                        placeholder="9 to 18 digits"
                        inputMode="numeric"
                        value={bankAccount}
                        error={attemptedStep3 ? step3Errors.bankAccount : undefined}
                        onChange={e => setBankAccount(e.target.value.replace(/\D/g, '').slice(0, 18))}
                        inputClassName="font-mono text-base"
                        hint={bankAccount ? `${bankAccount.length} digits entered` : 'Account number without spaces or dashes'}
                      />

                      <IfscField
                        value={bankIfsc}
                        error={attemptedStep3 ? step3Errors.bankIfsc : undefined}
                        onChange={setBankIfsc}
                      />
                    </div>
                  </div>
                )}

                {/* Step 4: KYC Documents (Complete Mode) */}
                {onboardingMode === 'full' && step === 4 && (
                  <div className="space-y-5">
                    <div className="p-4 bg-surface-subtle border border-border rounded-card flex items-center justify-between text-xs text-muted">
                      <span>Upload clear scanned copies or photos (PDF, PNG, JPG up to 2MB).</span>
                      <span className="font-bold text-brand">Company PAN Card is required</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {TPL_DOCUMENT_TYPES.map(docType => (
                        <DocUploadField
                          key={docType}
                          label={docType}
                          hint={docType === 'PAN Card' ? 'Required for verification' : 'Recommended for instant approval'}
                          path={docUrls[docType]}
                          busy={uploadingDocType === docType}
                          onUpload={file => uploadDoc(docType, file)}
                          onRemove={() => removeDoc(docType)}
                          onView={() => {
                            if (docUrls[docType]) void openDocViewer(docUrls[docType], docType)
                          }}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Final Step: Review & Submit */}
                {step === steps.length - 1 && (
                  <div className="space-y-6">
                    <div className="space-y-4">
                      {/* Contact Summary */}
                      <div className="p-5 bg-surface rounded-card border border-border shadow-xs">
                        <div className="flex items-center justify-between border-b border-border pb-3 mb-3.5">
                          <div className="flex items-center gap-2">
                            <Building size={16} className="text-brand" />
                            <h4 className="text-sm font-bold text-text">Contact & Business Details</h4>
                          </div>
                          <button
                            type="button"
                            onClick={() => setStep(0)}
                            className="text-xs text-brand hover:underline font-semibold cursor-pointer"
                          >
                            Edit
                          </button>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-xs sm:text-sm">
                          <div>
                            <span className="text-muted block text-xs mb-0.5">Company name</span>
                            <span className="font-semibold text-text">{companyName}</span>
                          </div>
                          <div>
                            <span className="text-muted block text-xs mb-0.5">Contact person</span>
                            <span className="font-semibold text-text">{ownerName}</span>
                          </div>
                          <div>
                            <span className="text-muted block text-xs mb-0.5">Email</span>
                            <span className="font-semibold text-text break-all">{email}</span>
                          </div>
                          <div>
                            <span className="text-muted block text-xs mb-0.5">Mobile</span>
                            <span className="font-semibold text-text">{mobile}</span>
                          </div>
                          <div className="sm:col-span-2">
                            <span className="text-muted block text-xs mb-0.5">Operating from</span>
                            <span className="font-semibold text-text">{location}</span>
                          </div>
                        </div>
                      </div>

                      {/* Fleet Summary */}
                      <div className="p-5 bg-surface rounded-card border border-border shadow-xs">
                        <div className="flex items-center justify-between border-b border-border pb-3 mb-3.5">
                          <div className="flex items-center gap-2">
                            <Truck size={16} className="text-brand" />
                            <h4 className="text-sm font-bold text-text">Fleet Specifications</h4>
                          </div>
                          <button
                            type="button"
                            onClick={() => setStep(1)}
                            className="text-xs text-brand hover:underline font-semibold cursor-pointer"
                          >
                            Edit
                          </button>
                        </div>
                        <div>
                          {fleetSize === 'single' && truckType ? (
                            <div className="flex items-center gap-2">
                              <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-surface-subtle border border-border rounded-full font-semibold text-xs text-text">
                                <Truck size={13} /> 1x {vehicles?.find(v => v.key === truckType)?.name}
                              </span>
                              <span className="text-xs text-muted">
                                ({vehicles?.find(v => v.key === truckType)?.max_t} Tons payload capacity)
                              </span>
                            </div>
                          ) : (
                            <div className="space-y-2">
                              <div className="flex flex-wrap gap-2">
                                {Object.entries(multipleTruckCounts).filter(([_, count]) => count > 0).map(([key, count]) => (
                                   <div key={key} className="inline-flex items-center gap-1.5 px-3 py-1 bg-brand-soft text-brand border border-brand/30 rounded-full font-semibold text-xs">
                                    <Truck size={13} /> {count}x {vehicles?.find(v => v.key === key)?.name || key}
                                  </div>
                                ))}
                              </div>
                              {totalTrucksCount > 0 && (
                                <p className="text-xs text-muted font-medium pt-1">
                                  Total: {totalTrucksCount} vehicles · {totalTonnage.toFixed(1)} Tons aggregate carrying capacity
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Full Onboarding Cards */}
                      {onboardingMode === 'full' && (
                        <>
                          <div className="p-5 bg-surface rounded-card border border-border shadow-xs">
                            <div className="flex items-center justify-between border-b border-border pb-3 mb-3.5">
                              <div className="flex items-center gap-2">
                                <ShieldCheck size={16} className="text-brand" />
                                <h4 className="text-sm font-bold text-text">Identity & Tax Information</h4>
                              </div>
                              <button
                                type="button"
                                onClick={() => setStep(2)}
                                className="text-xs text-brand hover:underline font-semibold cursor-pointer"
                              >
                                Edit
                              </button>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-xs sm:text-sm">
                              <div>
                                <span className="text-muted block text-xs mb-0.5">Entity type</span>
                                <span className="font-semibold text-text">{entityType}</span>
                              </div>
                              <div>
                                <span className="text-muted block text-xs mb-0.5">Authorized Signatory</span>
                                <span className="font-semibold text-text">{authorizedSignatoryName}</span>
                              </div>
                              <div>
                                <span className="text-muted block text-xs mb-0.5">PAN</span>
                                <span className="font-mono font-bold text-text">{pan}</span>
                              </div>
                              <div>
                                <span className="text-muted block text-xs mb-0.5">GSTIN</span>
                                <span className="font-mono font-bold text-text">{gst || '—'}</span>
                              </div>
                              {cin && (
                                <div>
                                  <span className="text-muted block text-xs mb-0.5">CIN</span>
                                  <span className="font-mono font-bold text-text">{cin}</span>
                                </div>
                              )}
                              <div>
                                <span className="text-muted block text-xs mb-0.5">MSME</span>
                                <span className="font-semibold text-text">{msmeStatus}</span>
                              </div>
                            </div>
                          </div>

                          <div className="p-5 bg-surface rounded-card border border-border shadow-xs">
                            <div className="flex items-center justify-between border-b border-border pb-3 mb-3.5">
                              <div className="flex items-center gap-2">
                                <Landmark size={16} className="text-brand" />
                                <h4 className="text-sm font-bold text-text">Bank Account for Payouts</h4>
                              </div>
                              <button
                                type="button"
                                onClick={() => setStep(3)}
                                className="text-xs text-brand hover:underline font-semibold cursor-pointer"
                              >
                                Edit
                              </button>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-xs sm:text-sm">
                              <div>
                                <span className="text-muted block text-xs mb-0.5">Account number</span>
                                <span className="font-mono font-bold text-text">
                                  {bankAccount ? `••••••••${bankAccount.slice(-4)}` : '—'}
                                </span>
                              </div>
                              <div>
                                <span className="text-muted block text-xs mb-0.5">IFSC code</span>
                                <span className="font-mono font-bold text-text">{bankIfsc || '—'}</span>
                              </div>
                            </div>
                          </div>

                          <div className="p-5 bg-surface rounded-card border border-border shadow-xs">
                            <div className="flex items-center justify-between border-b border-border pb-3 mb-3.5">
                              <div className="flex items-center gap-2">
                                <FileText size={16} className="text-brand" />
                                <h4 className="text-sm font-bold text-text">Uploaded Documents</h4>
                              </div>
                              <button
                                type="button"
                                onClick={() => setStep(4)}
                                className="text-xs text-brand hover:underline font-semibold cursor-pointer"
                              >
                                Edit
                              </button>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                              {TPL_DOCUMENT_TYPES.map(docType => (
                                <div key={docType} className="flex items-center justify-between p-2.5 rounded-control bg-surface-subtle border border-border">
                                  <span className="font-medium text-text">{docType}</span>
                                  {docUrls[docType] ? (
                                    <span className="text-success flex items-center gap-1 font-semibold">
                                      <CheckCircle2 size={13} /> Uploaded
                                    </span>
                                  ) : (
                                    <span className="text-muted italic">Not uploaded</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        </>
                      )}
                    </div>

                    <div className="p-4 rounded-card bg-surface-subtle border border-border text-xs text-muted">
                      By submitting this application, you declare that the vehicle and business information provided is accurate and you agree to the Margix Carrier Partner Terms of Carriage.
                    </div>
                  </div>
                )}
              </div>

              {/* In-Card Docked Navigation Controls */}
              <div className="mt-8 pt-6 border-t border-border flex items-center justify-between">
                <Button
                  variant="secondary"
                  onClick={back}
                  disabled={step === 0}
                  icon={<ChevronLeft size={16} />}
                >
                  Back
                </Button>

                <div className="text-xs font-semibold text-muted hidden sm:block">
                  {progressPercent}% completed
                </div>

                <Button
                  onClick={next}
                  disabled={isSubmitting}
                  variant={step === steps.length - 1 ? 'primary' : 'secondary'}
                  className="font-semibold"
                >
                  {step === steps.length - 1 ? (isSubmitting ? 'Submitting Application...' : 'Submit Application') : 'Next'}
                  {step !== steps.length - 1 && <ChevronRight size={16} className="ml-1" />}
                </Button>
              </div>
            </Card>
          </div>

          {/* Desktop Sidebar: Application Overview, Partner Advantages & Help Desk (lg:col-span-4) */}
          <aside className="hidden lg:block lg:col-span-4 space-y-5 lg:sticky lg:top-24">
            {/* Progress Overview Card */}
            <Card padded className="p-6 bg-surface border border-border shadow-xs rounded-card space-y-5">
              <div>
                <div className="flex items-center justify-between text-xs font-semibold mb-2">
                  <span className="text-brand uppercase tracking-wider">
                    Application Progress
                  </span>
                  <span className="text-muted font-bold">{progressPercent}%</span>
                </div>
                <div className="w-full h-2 bg-surface-subtle border border-border rounded-full overflow-hidden">
                  <div
                    className="h-full bg-brand transition-all duration-300 rounded-full"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>

              <div className="pt-2 border-t border-border space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted">Selected Mode:</span>
                  <span className="font-semibold px-2.5 py-0.5 rounded-full bg-surface-subtle border border-border text-text">
                    {onboardingMode === 'quick' ? '⚡ Quick (2 mins)' : '🛡️ Complete Verification'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted">Review SLA:</span>
                  <span className="font-semibold text-text">Within 1 Business Day</span>
                </div>
              </div>
            </Card>

            {/* Carrier Advantages Card */}
            <Card padded className="p-6 bg-surface border border-border shadow-xs rounded-card space-y-4">
              <h3 className="text-sm font-bold text-text flex items-center gap-2">
                <Award size={16} className="text-brand" />
                <span>Partner Advantages</span>
              </h3>
              <ul className="space-y-3 text-xs text-muted">
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 size={15} className="text-brand shrink-0 mt-0.5" />
                  <span><strong className="text-text">Direct Shipper Freight:</strong> Eliminate middlemen broker margins for maximum earnings.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 size={15} className="text-brand shrink-0 mt-0.5" />
                  <span><strong className="text-text">Guaranteed Settlements:</strong> On-time direct bank transfers without payment disputes.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 size={15} className="text-brand shrink-0 mt-0.5" />
                  <span><strong className="text-text">Dedicated Dispatch:</strong> 24/7 route support and live load assistance for your drivers.</span>
                </li>
              </ul>
            </Card>

            {/* Need Help Desk Card */}
            <div className="p-5 rounded-card border border-border bg-surface-subtle text-xs text-muted space-y-3">
              <div className="flex items-center gap-2 font-bold text-text text-sm">
                <Headphones size={16} className="text-brand" />
                <span>Need help onboarding?</span>
              </div>
              <p className="leading-relaxed">
                Our partner operations desk is available Monday to Saturday (9 AM – 7 PM IST) to assist with registration.
              </p>
              <div className="pt-1 space-y-1.5 font-mono text-[11px] text-text">
                <div className="flex items-center gap-2">
                  <Phone size={12} className="text-muted" />
                  <span>+91 (022) 4890-1234</span>
                </div>
                <div className="flex items-center gap-2">
                  <Mail size={12} className="text-muted" />
                  <span>3pl-support@margixindia.com</span>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </main>

      {viewer && (
        <DocumentViewerModal
          isOpen={!!viewer}
          onClose={() => setViewer(null)}
          fileUrl={viewer.url}
          fileName={viewer.name}
        />
      )}
    </div>
  )
}
