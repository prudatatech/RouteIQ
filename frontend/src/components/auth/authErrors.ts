import type { Mode } from './types'

/** Turns a Supabase auth error into a sentence that says what happened and what to do. */
export function describeAuthError(error: unknown, mode: Mode): string {
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
