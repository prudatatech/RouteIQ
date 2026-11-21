import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/services/supabase'
import { destinationFor, loadAccount } from '@/services/account'
import { accountKindOf, homeForKind, LOGIN_PATH, nextForKind } from '@/utils/accountKind'
import { authAPI, orgAPI } from '@/services/api'
import { useOrgStore } from '@/store/orgStore'
import { destinationForOrgs } from '@/utils/orgAccess'
import { useAuthStore } from '@/store/authStore'
import { safeNextPath } from '@/utils/safeNext'
import { platformMembership, type Membership } from '@/utils/orgs'
import { describeAuthError } from './authErrors'
import { ACCOUNT_LOAD_FAILED, EMAIL_PATTERN, MIN_PASSWORD_LENGTH, NO_ACCESS } from './constants'
import type { FieldErrors, Mode } from './types'

const COPY = {
  title: 'Sign in to MargixIndia',
  subtitle: 'One sign-in for logistic companies, vendors, 3PL partners and drivers. We take you to your own area.',
}

const modeTitles: Record<Exclude<Mode, 'sign-in'>, string> = {
  'sign-up': 'Create a vendor account',
  forgot: 'Reset your password',
  reset: 'Set a new password',
}

const busyLabels: Record<Mode, string> = {
  'sign-in': 'Signing in…',
  'sign-up': 'Creating account…',
  forgot: 'Sending link…',
  reset: 'Saving password…',
}
const submitLabels: Record<Mode, string> = {
  'sign-in': 'Sign in',
  'sign-up': 'Create account',
  forgot: 'Send reset link',
  reset: 'Save new password',
}

/**
 * All the state and behaviour behind the one sign-in page: which flow is active, the fields, validation,
 * the Supabase calls, and where each kind of account ends up afterwards. The page (LoginPage.tsx) and its
 * per-flow form components are purely presentational; this hook is where the business logic lives.
 */
export function useLoginFlow() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const next = safeNextPath(params.get('next'))
  // "Register your logistic company": sign up or in, then the registration form
  const registering = params.get('register') === 'company'

  const authInitialized = useAuthStore(s => s.authInitialized)
  const token = useAuthStore(s => s.token)

  const [mode, setMode] = useState<Mode>(params.get('reset') ? 'reset' : registering ? 'sign-up' : 'sign-in')
  const [email, setEmail] = useState(params.get('email') ?? '')
  const [password, setPassword] = useState(params.get('password') ?? '')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const [otpOpen, setOtpOpen] = useState(false)
  const sessionChecked = useRef(false)

  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const confirmRef = useRef<HTMLInputElement>(null)

  const title = mode === 'sign-in' ? COPY.title : registering && mode === 'sign-up' ? 'Register your logistic company' : modeTitles[mode]

  useEffect(() => {
    const previous = document.title
    document.title = `${title} · MargixIndia`
    return () => { document.title = previous }
  }, [title])

  useEffect(() => {
    if (params.has('password')) {
      const url = new URL(window.location.href)
      url.searchParams.delete('password')
      window.history.replaceState({}, '', url.pathname + url.search)
    }
  }, [params])

  /**
   * Resolves what the account is from the database and sends the user to the right place. An account of another
   * kind never keeps a session here: it is signed out and told which sign-in to use (unless it was already
   * signed in before this page opened, which only gets a notice).
   */
  const finishSignIn = async (session: Session) => {
    const signOut = async () => {
      await supabase.auth.signOut().catch(() => undefined)
      useAuthStore.getState().clearAuth()
      useOrgStore.getState().reset()
    }
    let destination: string | null = null
    try {
      // Clear any stale org context from a previous session so no invalid X-Org-Id header is sent
      useOrgStore.getState().reset()
      const account = await loadAccount(session.user.id)
      // The memberships call needs the session in the store
      useAuthStore.getState().setSession(session, account.role, account.tplPartnerId)
      const memberships: Membership[] = await orgAPI.mine().catch(() => [])
      const kind = accountKindOf(account, memberships)

      if (registering && kind !== 'tpl') {
        // Anyone who signed up or in here goes on to the registration form
        useAuthStore.getState().setSession(session, account.role ?? 'vendor', account.tplPartnerId)
        destination = '/register-company'
      } else if (!kind) {
        await signOut()
        setFormError(NO_ACCESS)
        return
      } else if (kind === 'staff') {
        // A company waiting for approval has only the waiting screen
        useOrgStore.getState().setMemberships(memberships)
        // The platform owner signs in to the platform console, even when they also sit in a company
        const platform = platformMembership(memberships)
        if (platform) useOrgStore.getState().setActiveOrg(platform.org.id)
        destination = destinationForOrgs(memberships, useOrgStore.getState().activeOrgId)
          ?? nextForKind('staff', next) ?? (platform ? '/platform/organisations' : homeForKind('staff', account))
      } else if (kind === 'vendor') {
        destination = destinationFor(account, next)
      } else {
        destination = nextForKind('tpl', next) ?? homeForKind('tpl', account)
      }
    } catch (err) {
      console.error('Failed to load account after sign-in', err)
      await signOut()
      setFormError(ACCOUNT_LOAD_FAILED)
      return
    }
    if (!destination) {
      await signOut()
      setFormError(NO_ACCESS)
      return
    }
    navigate(destination, { replace: true })
  }

  // Someone who is already signed in goes straight to their area, unless new credentials were provided in the URL.
  useEffect(() => {
    if (!authInitialized || sessionChecked.current) return
    sessionChecked.current = true

    const emailParam = params.get('email')
    const passwordParam = params.get('password')

    if (emailParam && passwordParam) {
      const currentSession = useAuthStore.getState().session
      if (currentSession && currentSession.user?.email?.toLowerCase() !== emailParam.toLowerCase()) {
        supabase.auth.signOut().catch(() => undefined)
        useAuthStore.getState().clearAuth()
        useOrgStore.getState().reset()
      }

      setSubmitting(true)
      supabase.auth.signInWithPassword({ email: emailParam.trim(), password: passwordParam })
        .then(async ({ data, error }) => {
          if (error || !data.session) {
            setFormError(describeAuthError(error, 'sign-in'))
            setCheckingSession(false)
            return
          }
          await finishSignIn(data.session)
        })
        .catch(err => {
          setFormError(describeAuthError(err, 'sign-in'))
          setCheckingSession(false)
        })
        .finally(() => {
          setSubmitting(false)
        })
      return
    }

    const session = useAuthStore.getState().session
    if (!session || mode === 'reset') {
      setCheckingSession(false)
      return
    }
    finishSignIn(session).finally(() => setCheckingSession(false))
    // Runs once, when the stored session has been restored.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authInitialized])

  const updateParams = (change: (p: URLSearchParams) => void) => {
    const nextParams = new URLSearchParams(params)
    change(nextParams)
    setParams(nextParams, { replace: true })
  }

  const clearMessages = () => {
    setErrors({})
    setFormError(null)
    setNotice(null)
  }

  const switchMode = (value: Mode) => {
    if (mode === 'reset') updateParams(p => p.delete('reset'))
    setMode(value)
    setPassword('')
    setConfirm('')
    clearMessages()
  }

  /** Shows inline errors and focuses the first field that needs fixing. Returns true when valid. */
  const validate = (fields: { email?: boolean; password?: 'current' | 'new'; confirm?: boolean }) => {
    const found: FieldErrors = {}
    if (fields.email) {
      if (!email.trim()) found.email = 'Enter your email.'
      else if (!EMAIL_PATTERN.test(email.trim())) found.email = 'Enter an email like you@company.com.'
    }
    if (fields.password === 'current' && !password) found.password = 'Enter your password.'
    if (fields.password === 'new') {
      if (!password) found.password = 'Enter a password.'
      else if (password.length < MIN_PASSWORD_LENGTH) found.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`
    }
    if (fields.confirm && !found.password && confirm !== password) found.confirm = 'The passwords do not match.'
    setErrors(found)
    if (found.email) emailRef.current?.focus()
    else if (found.password) passwordRef.current?.focus()
    else if (found.confirm) confirmRef.current?.focus()
    return Object.keys(found).length === 0
  }

  const run = async (action: () => Promise<void>) => {
    setFormError(null)
    setNotice(null)
    setSubmitting(true)
    try {
      await action()
    } finally {
      setSubmitting(false)
    }
  }

  const signIn = () => run(async () => {
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error || !data.session) {
      setFormError(describeAuthError(error, 'sign-in'))
      return
    }
    await finishSignIn(data.session)
  })

  /** The mobile code sign-in (vendors): the session is set by the modal, then checked like any other sign-in. */
  const onOtpVerified = () => run(async () => {
    setOtpOpen(false)
    const session = (await supabase.auth.getSession()).data.session
    if (!session) {
      setFormError(describeAuthError(null, 'sign-in'))
      return
    }
    await finishSignIn(session)
  })

  const signUp = () => run(async () => {
    const back = registering
      ? `${LOGIN_PATH}?register=company`
      : `${LOGIN_PATH}${next ? `?next=${encodeURIComponent(next)}` : ''}`
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      // The database gives self-registered accounts the vendor role only when they ask for it here.
      options: { data: { role: 'vendor' }, emailRedirectTo: `${window.location.origin}${back}` },
    })
    if (error) {
      setFormError(describeAuthError(error, 'sign-up'))
      return
    }
    if (data.session) {
      await finishSignIn(data.session)
      return
    }
    setMode('sign-in')
    setPassword('')
    setConfirm('')
    setNotice(`We sent a confirmation link to ${email.trim()}. Open it, then sign in.`)
  })

  const sendResetLink = () => run(async () => {
    const redirect = new URL(LOGIN_PATH, window.location.origin)
    redirect.searchParams.set('reset', '1')
    try {
      await authAPI.vendorSendResetLink(email.trim(), redirect.toString())
      setMode('sign-in')
      setNotice(`If an account exists for ${email.trim()}, we sent it a link to set a new password.`)
    } catch (err) {
      setFormError(describeAuthError(err, 'forgot'))
    }
  })

  const setNewPassword = () => run(async () => {
    const { data, error } = await supabase.auth.updateUser({ password })
    if (error) {
      setFormError(describeAuthError(error, 'reset'))
      return
    }
    toast.success('Your password has been changed')
    const session = (await supabase.auth.getSession()).data.session
    if (!session || !data.user) {
      switchMode('sign-in')
      return
    }
    updateParams(p => p.delete('reset'))
    await finishSignIn(session)
  })

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (submitting) return
    if (mode === 'sign-in' && validate({ email: true, password: 'current' })) signIn()
    if (mode === 'sign-up' && validate({ email: true, password: 'new', confirm: true })) signUp()
    if (mode === 'forgot' && validate({ email: true })) sendResetLink()
    if (mode === 'reset' && validate({ password: 'new', confirm: true })) setNewPassword()
  }

  const subtitle = {
    'sign-in': COPY.subtitle,
    'sign-up': registering ? 'Create your account first. Next you add your company details.' : 'Post loads, book return-trip space and track your shipments.',
    forgot: 'Enter the email you sign in with. We will send you a link to set a new password.',
    reset: 'Choose a new password for your account.',
  }[mode]

  const waitingForSession = !authInitialized || checkingSession
  const resetLinkMissing = mode === 'reset' && authInitialized && !token

  return {
    mode, switchMode, registering, next,
    title, subtitle,
    waitingForSession, resetLinkMissing,
    otpOpen, setOtpOpen, onOtpVerified,
    email, setEmail, emailRef,
    password, setPassword, passwordRef,
    confirm, setConfirm, confirmRef,
    errors, formError, notice, submitting,
    onSubmit,
    busyLabel: busyLabels[mode],
    submitLabel: submitLabels[mode],
  }
}
