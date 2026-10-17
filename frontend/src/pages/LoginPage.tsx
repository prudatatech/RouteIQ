import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { Building2, MapPinned, Package, Truck } from 'lucide-react'
import OtpModal from '@/components/load-post/OtpModal'
import { LOGIN_PATH } from '@/utils/accountKind'
import { supabase } from '@/services/supabase'
import { Alert, Button, Card, LoadingState } from '@/components/ui'
import { linkClass } from '@/components/auth/constants'
import { useLoginFlow } from '@/components/auth/useLoginFlow'
import { SignInForm } from '@/components/auth/SignInForm'
import { SignUpForm } from '@/components/auth/SignUpForm'
import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm'
import { ResetPasswordForm } from '@/components/auth/ResetPasswordForm'

const brandHighlights: { icon: typeof Package; text: string }[] = [
  { icon: Package, text: 'Vendors post loads and track them to delivery' },
  { icon: Building2, text: 'Operations teams plan trips and fill capacity' },
  { icon: Truck, text: '3PL partners manage their fleet and coverage' },
  { icon: MapPinned, text: 'Everyone sees where a shipment is, live' },
]

/**
 * The one sign-in page, for every kind of account (utils/accountKind.ts). After signing in, each account is sent to
 * its own area: the platform console, a company's console, the vendor area, the 3PL portal or the driver app.
 *
 * This page is a thin container: all the sign-in / sign-up / forgot-password / reset-password behaviour lives in
 * useLoginFlow (frontend/src/components/auth), and each flow has its own presentational form component. This page
 * only picks which one to render and wraps it in the shared layout (brand panel, card, other ways to get started).
 */
export default function LoginPage() {
  const flow = useLoginFlow()
  const { mode, registering, next, switchMode } = flow

  // Sign-in has one audience-defining choice shown inline (run a company?) and several narrower ones
  // (vendor quick-start, tracking, 3PL) tucked under a disclosure so the card itself stays short.
  const otherOptions: ReactNode[] = []
  const moreOptions: ReactNode[] = []
  if (mode === 'sign-in') {
    if (!registering) {
      otherOptions.push(
        <>Run a transport company? <Link className={linkClass} to="/login?register=company">Register your logistic company</Link></>,
      )
    }
    moreOptions.push(
      <>Ready to ship? <Link className={linkClass} to="/vendor/request">Start your load without signing in</Link></>,
      <>Have a tracking ID? <Link className={linkClass} to="/track">Track a shipment</Link></>,
      <>Want to work with us as a 3PL partner? <Link className={linkClass} to="/3pl/onboard">Apply to join</Link></>,
      <>Approved partner without a password? <Link className={linkClass} to="/3pl/onboard/setup">Set up your partner login</Link></>,
      <>Already applied? <Link className={linkClass} to="/3pl/onboard/track">Track your application</Link></>,
      <>Staff and driver accounts are created by your administrator.</>,
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

  const sharedFormProps = {
    formError: flow.formError,
    notice: flow.notice,
    submitting: flow.submitting,
    onSubmit: flow.onSubmit,
    busyLabel: flow.busyLabel,
    submitLabel: flow.submitLabel,
    errors: flow.errors,
  }

  return (
    <div className="min-h-screen bg-bg text-text lg:grid lg:grid-cols-2">
      {/* Brand panel: desktop only. A plain form on a blank page reads as a bare admin tool; this gives the
          sign-in a visual identity and tells a visitor what the product actually does while they wait. */}
      <aside className="hidden flex-col justify-between bg-text p-10 lg:flex">
        <Link to="/" className="flex items-center gap-2.5 text-white hover:no-underline">
          <img src="/margix-logo.png" alt="" className="h-8 w-8 object-contain" />
          <span className="text-lg font-semibold text-white">MargixIndia</span>
        </Link>
        <div>
          <h2 className="text-3xl font-semibold leading-tight text-white">
            One sign-in for your whole freight operation
          </h2>
          <ul className="mt-8 space-y-4">
            {brandHighlights.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3 text-sm text-white/70">
                <Icon size={18} className="mt-0.5 shrink-0 text-brand-fill" aria-hidden />
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-white/40">© {new Date().getFullYear()} MargixIndia by Prudata</p>
      </aside>

      <main className="flex min-h-screen flex-col px-4 py-6 sm:px-6 lg:min-h-0 lg:justify-center lg:px-16 lg:py-0">
        <Link to="/" className={clsx(linkClass, 'mb-8 flex items-center gap-2.5 text-text hover:no-underline lg:hidden')}>
          <img src="/margix-logo.png" alt="" className="h-8 w-8 object-contain" />
          <span className="text-lg font-semibold">MargixIndia</span>
        </Link>

        <div className="mx-auto w-full max-w-md lg:mx-0">
          {flow.waitingForSession ? (
            <LoadingState label="Checking your sign-in" />
          ) : (
            <>
              <h1 id="sign-in-title" className="text-2xl font-semibold text-text sm:text-3xl">{flow.title}</h1>
              <p className="mt-1 text-sm text-muted sm:text-base">{flow.subtitle}</p>

              <Card padded className="mt-6">
                {flow.resetLinkMissing ? (
                  <div className="space-y-4">
                    <Alert tone="warning" title="This link has expired or was already used">
                      Reset links work once and for a limited time.
                    </Alert>
                    <Button variant="secondary" size="lg" fullWidth onClick={() => switchMode('forgot')}>Send a new link</Button>
                  </div>
                ) : (
                  <>
                    {mode === 'sign-in' && (
                      <div className="mb-4">
                        <Button
                          type="button"
                          variant="secondary"
                          size="lg"
                          fullWidth
                          onClick={() => {
                            supabase.auth.signInWithOAuth({
                              provider: 'google',
                              options: { redirectTo: `${window.location.origin}${LOGIN_PATH}${next ? `?next=${encodeURIComponent(next)}` : ''}` },
                            })
                          }}
                          className="flex items-center justify-center gap-2"
                        >
                          <svg className="h-4 w-4" viewBox="0 0 24 24">
                            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                          </svg>
                          Continue with Google
                        </Button>
                        <div className="relative my-4 flex items-center justify-center">
                          <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border" /></div>
                          <span className="relative bg-surface px-2 text-xs uppercase text-muted">or</span>
                        </div>
                      </div>
                    )}

                    {mode === 'sign-in' && (
                      <SignInForm
                        {...sharedFormProps}
                        email={flow.email}
                        onEmailChange={e => flow.setEmail(e.target.value)}
                        emailRef={flow.emailRef}
                        password={flow.password}
                        onPasswordChange={flow.setPassword}
                        passwordRef={flow.passwordRef}
                        onUseMobileCode={() => flow.setOtpOpen(true)}
                        onForgotPassword={() => switchMode('forgot')}
                      />
                    )}
                    {mode === 'sign-up' && (
                      <SignUpForm
                        {...sharedFormProps}
                        email={flow.email}
                        onEmailChange={e => flow.setEmail(e.target.value)}
                        emailRef={flow.emailRef}
                        password={flow.password}
                        onPasswordChange={flow.setPassword}
                        passwordRef={flow.passwordRef}
                        confirm={flow.confirm}
                        onConfirmChange={flow.setConfirm}
                        confirmRef={flow.confirmRef}
                      />
                    )}
                    {mode === 'forgot' && (
                      <ForgotPasswordForm
                        {...sharedFormProps}
                        email={flow.email}
                        onEmailChange={e => flow.setEmail(e.target.value)}
                        emailRef={flow.emailRef}
                      />
                    )}
                    {mode === 'reset' && (
                      <ResetPasswordForm
                        {...sharedFormProps}
                        password={flow.password}
                        onPasswordChange={flow.setPassword}
                        passwordRef={flow.passwordRef}
                        confirm={flow.confirm}
                        onConfirmChange={flow.setConfirm}
                        confirmRef={flow.confirmRef}
                      />
                    )}
                  </>
                )}
              </Card>

              {mode === 'sign-in' && !flow.resetLinkMissing && (
                <p className="mt-4 text-center text-sm text-muted">
                  New here? <button type="button" className={linkClass} onClick={() => switchMode('sign-up')}>Create a free vendor account</button>
                </p>
              )}

              {otherOptions.length > 0 && (
                <ul className="mt-6 space-y-2 text-sm text-muted">
                  {otherOptions.map((option, i) => <li key={i}>{option}</li>)}
                </ul>
              )}

              {mode === 'sign-in' && moreOptions.length > 0 && (
                <details className="group mt-4">
                  <summary className="cursor-pointer list-none text-sm font-medium text-muted hover:text-text">
                    More ways to get started
                    <span className="ml-1 inline-block transition-transform group-open:rotate-180">⌄</span>
                  </summary>
                  <ul className="mt-3 space-y-2 text-sm text-muted">
                    {moreOptions.map((option, i) => <li key={i}>{option}</li>)}
                  </ul>
                </details>
              )}
            </>
          )}
        </div>
      </main>

      <OtpModal
        open={flow.otpOpen}
        onClose={() => flow.setOtpOpen(false)}
        onUseEmail={() => flow.setOtpOpen(false)}
        onVerified={flow.onOtpVerified}
      />
    </div>
  )
}
