import { useEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import { Eye, EyeOff } from 'lucide-react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/services/supabase'
import { destinationFor, loadAccount } from '@/services/account'
import { useAuthStore } from '@/store/authStore'
import { safeNextPath } from '@/utils/safeNext'
import {
  Alert, Button, Card, Field, IconButton, Input, LoadingState, TabPanel, Tabs, controlClasses,
} from '@/components/ui'

type Audience = 'staff' | 'partner'
type Mode = 'sign-in' | 'sign-up' | 'forgot' | 'reset'
type FieldErrors = { email?: string; password?: string; confirm?: string }

const PARTNER_VALUES = ['vendor', 'partner', '3pl']
const MIN_PASSWORD_LENGTH = 8
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const NO_ACCESS =
  'This account does not have access to MargixIndia on the web. Ask your administrator to set up your access.'
const ACCOUNT_LOAD_FAILED = 'We could not load your account. Check your connection and try again.'

const linkClass =
  'rounded-control font-medium text-brand underline-offset-2 hover:underline focus-visible:outline ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand'

const titles: Record<Mode, string> = {
  'sign-in': 'Sign in',
  'sign-up': 'Create a vendor account',
  forgot: 'Reset your password',
  reset: 'Set a new password',
}

/** Turns a Supabase auth error into a sentence that says what happened and what to do. */
function describeAuthError(error: unknown, mode: Mode): string {
  const e = (error ?? {}) as { message?: string; status?: number; code?: string }
  const message = (e.message ?? '').toLowerCase()
  if (e.status === 429 || e.code === 'over_request_rate_limit' || e.code === 'over_email_send_rate_limit' || message.includes('rate limit')) {
    return 'Too many attempts. Wait a minute and try again.'
  }
  if (e.code === 'invalid_credentials' || message.includes('invalid login credentials')) {
    return 'The email or password is incorrect.'
  }
  if (e.code === 'email_not_confirmed' || message.includes('email not confirmed')) {
    return 'Confirm your email first. Open the link we sent when you created the account, then sign in.'
  }
  if (e.code === 'user_already_exists' || message.includes('already registered')) {
    return 'An account with this email already exists. Sign in instead.'
  }
  if (e.code === 'weak_password' || message.includes('password should')) {
    return e.message ?? 'Choose a stronger password.'
  }
  if (e.code === 'same_password') return 'Choose a password that is different from your current one.'
  if (e.code === 'user_banned') return 'This account has been disabled. Ask your administrator for help.'
  if (message.includes('failed to fetch') || message.includes('network')) {
    return 'We could not reach the server. Check your connection and try again.'
  }
  const fallback: Record<Mode, string> = {
    'sign-in': 'We could not sign you in. Try again.',
    'sign-up': 'We could not create your account. Try again.',
    forgot: 'We could not send the reset link. Try again.',
    reset: 'We could not change your password. Request a new link and try again.',
  }
  return fallback[mode]
}

function PasswordField({ label, value, onChange, autoComplete, error, hint, inputRef }: {
  label: string
  value: string
  onChange: (value: string) => void
  autoComplete: 'current-password' | 'new-password'
  error?: string
  hint?: ReactNode
  inputRef?: RefObject<HTMLInputElement>
}) {
  const [visible, setVisible] = useState(false)
  return (
    <Field label={label} error={error} hint={hint}>
      {control => (
        <div className="relative">
          <input
            ref={inputRef}
            {...control}
            type={visible ? 'text' : 'password'}
            value={value}
            onChange={e => onChange(e.target.value)}
            autoComplete={autoComplete}
            className={clsx(controlClasses, error ? 'border-danger' : 'border-border-strong', 'h-control pr-12')}
          />
          <IconButton
            size="sm"
            label={visible ? 'Hide password' : 'Show password'}
            aria-pressed={visible}
            icon={visible ? <EyeOff size={16} /> : <Eye size={16} />}
            onClick={() => setVisible(v => !v)}
            className="absolute right-1 top-1/2 -translate-y-1/2 text-muted"
          />
        </div>
      )}
    </Field>
  )
}

export default function LoginPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const audience: Audience = PARTNER_VALUES.includes(params.get('as') ?? '') ? 'partner' : 'staff'
  const next = safeNextPath(params.get('next'))

  const authInitialized = useAuthStore(s => s.authInitialized)
  const token = useAuthStore(s => s.token)

  const [mode, setMode] = useState<Mode>(params.get('reset') ? 'reset' : 'sign-in')
  const [email, setEmail] = useState(params.get('email') ?? '')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const sessionChecked = useRef(false)

  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const confirmRef = useRef<HTMLInputElement>(null)

  const title = titles[mode]

  useEffect(() => {
    const previous = document.title
    document.title = `${title} · MargixIndia`
    return () => { document.title = previous }
  }, [title])

  /** Resolves the account's role from the database and sends the user to the right place. */
  const finishSignIn = async (session: Session) => {
    const signOut = async () => {
      await supabase.auth.signOut().catch(() => undefined)
      useAuthStore.getState().clearAuth()
    }
    let destination: string | null
    let role: string | null
    try {
      const account = await loadAccount(session.user.id)
      role = account.role
      destination = destinationFor(account, next)
    } catch (err) {
      console.error('Failed to load account after sign-in', err)
      await signOut()
      setFormError(ACCOUNT_LOAD_FAILED)
      return
    }
    if (!destination || !role) {
      await signOut()
      setFormError(NO_ACCESS)
      return
    }
    useAuthStore.getState().setSession(session, role)
    navigate(destination, { replace: true })
  }

  // Someone who is already signed in goes straight to their area.
  useEffect(() => {
    if (!authInitialized || sessionChecked.current) return
    sessionChecked.current = true
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

  const chooseAudience = (value: Audience) => {
    updateParams(p => (value === 'partner' ? p.set('as', 'vendor') : p.delete('as')))
    if (value === 'staff' && mode === 'sign-up') setMode('sign-in')
    clearMessages()
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

  const signUp = () => run(async () => {
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      // The database gives self-registered accounts the vendor role only when they ask for it here.
      options: { data: { role: 'vendor' }, emailRedirectTo: `${window.location.origin}/login?as=vendor` },
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
    const redirect = new URL('/login', window.location.origin)
    redirect.searchParams.set('reset', '1')
    if (audience === 'partner') redirect.searchParams.set('as', 'vendor')
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: redirect.toString() })
    if (error) {
      setFormError(describeAuthError(error, 'forgot'))
      return
    }
    setMode('sign-in')
    setNotice(`If an account exists for ${email.trim()}, we sent it a link to set a new password.`)
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

  const busyLabel: Record<Mode, string> = {
    'sign-in': 'Signing in…',
    'sign-up': 'Creating account…',
    forgot: 'Sending link…',
    reset: 'Saving password…',
  }
  const submitLabel: Record<Mode, string> = {
    'sign-in': 'Sign in',
    'sign-up': 'Create account',
    forgot: 'Send reset link',
    reset: 'Save new password',
  }
  const subtitle = {
    'sign-in': audience === 'staff' ? 'For operations staff and drivers.' : 'For vendors and 3PL partners.',
    'sign-up': 'Find truck capacity, post loads and track your shipments.',
    forgot: 'Enter the email you sign in with. We will send you a link to set a new password.',
    reset: 'Choose a new password for your account.',
  }[mode]

  const waitingForSession = !authInitialized || checkingSession
  const resetLinkMissing = mode === 'reset' && authInitialized && !token

  const form = (
    <form noValidate onSubmit={onSubmit} aria-labelledby="sign-in-title" className="space-y-4">
      {notice && <Alert tone="success">{notice}</Alert>}
      {formError && <Alert tone="danger">{formError}</Alert>}

      {mode !== 'reset' && (
        <Input
          ref={emailRef}
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          placeholder="you@company.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
          error={errors.email}
        />
      )}

      {(mode === 'sign-in' || mode === 'sign-up' || mode === 'reset') && (
        <PasswordField
          label={mode === 'reset' ? 'New password' : 'Password'}
          value={password}
          onChange={setPassword}
          autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
          error={errors.password}
          hint={mode === 'sign-in' ? undefined : `At least ${MIN_PASSWORD_LENGTH} characters.`}
          inputRef={passwordRef}
        />
      )}

      {(mode === 'sign-up' || mode === 'reset') && (
        <PasswordField
          label="Confirm password"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          error={errors.confirm}
          inputRef={confirmRef}
        />
      )}

      {mode === 'sign-in' && (
        <div className="flex justify-end">
          <button type="button" className={clsx(linkClass, 'text-sm')} onClick={() => switchMode('forgot')}>
            Forgot password?
          </button>
        </div>
      )}

      <Button type="submit" size="lg" fullWidth loading={submitting}>
        {submitting ? busyLabel[mode] : submitLabel[mode]}
      </Button>
    </form>
  )

  const otherOptions: ReactNode[] = []
  if (mode === 'sign-in' && audience === 'partner') {
    otherOptions.push(
      <>New vendor? <button type="button" className={linkClass} onClick={() => switchMode('sign-up')}>Create an account</button></>,
      <>Approved 3PL partner without a password? <Link className={linkClass} to="/3pl/onboard/setup">Set up your partner login</Link></>,
      <>Want to work with us as a 3PL partner? <Link className={linkClass} to="/3pl/onboard">Apply to join</Link></>,
      <>Just looking? <Link className={linkClass} to="/vendor">Browse capacity without signing in</Link></>,
    )
  } else if (mode === 'sign-in') {
    otherOptions.push(
      <>Staff and driver accounts are created by your administrator.</>,
      <>Have a tracking ID? <Link className={linkClass} to="/track">Track a shipment</Link></>,
    )
  } else if (mode === 'sign-up') {
    otherOptions.push(
      <>Already have an account? <button type="button" className={linkClass} onClick={() => switchMode('sign-in')}>Sign in</button></>,
    )
  } else {
    otherOptions.push(
      <button type="button" className={linkClass} onClick={() => switchMode('sign-in')}>Back to sign in</button>,
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-bg text-text">
      <header className="mx-auto flex w-full max-w-content items-center px-4 py-4 sm:px-6">
        <Link to="/" className={clsx(linkClass, 'flex items-center gap-2.5 text-text hover:no-underline')}>
          <img src="/margix-logo.png" alt="" className="h-8 w-8 object-contain" />
          <span className="text-lg font-semibold">MargixIndia</span>
          <span className="text-sm font-normal text-muted">by Prudata</span>
        </Link>
      </header>

      <main className="flex flex-1 justify-center px-4 pb-12 pt-4 sm:items-center sm:px-6 sm:pt-0">
        <div className="w-full max-w-md">
          {waitingForSession ? (
            <LoadingState label="Checking your sign-in" />
          ) : (
            <>
              <h1 id="sign-in-title" className="text-2xl font-semibold text-text sm:text-3xl">{title}</h1>
              <p className="mt-1 text-sm text-muted sm:text-base">{subtitle}</p>

              <Card padded className="mt-6">
                {resetLinkMissing ? (
                  <div className="space-y-4">
                    <Alert tone="warning" title="This link has expired or was already used">
                      Reset links work once and for a limited time.
                    </Alert>
                    <Button variant="secondary" size="lg" fullWidth onClick={() => switchMode('forgot')}>Send a new link</Button>
                  </div>
                ) : mode === 'sign-in' ? (
                  <>
                    <Tabs<Audience>
                      label="Who is signing in"
                      value={audience}
                      onChange={chooseAudience}
                      tabs={[{ id: 'staff', label: 'Staff' }, { id: 'partner', label: 'Vendor or 3PL partner' }]}
                      className="mb-5"
                    />
                    <TabPanel id={audience}>{form}</TabPanel>
                  </>
                ) : (
                  form
                )}
              </Card>

              <ul className="mt-6 space-y-2 text-sm text-muted">
                {otherOptions.map((option, i) => <li key={i}>{option}</li>)}
              </ul>
            </>
          )}
        </div>
      </main>
    </div>
  )
}
