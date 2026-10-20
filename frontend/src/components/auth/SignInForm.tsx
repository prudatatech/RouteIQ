import type { ChangeEvent, FormEvent, RefObject } from 'react'
import clsx from 'clsx'
import { Mail, Lock } from 'lucide-react'
import { Alert, Button, Input } from '@/components/ui'
import { PasswordField } from './PasswordField'
import { linkClass } from './constants'
import type { FieldErrors } from './types'

export function SignInForm({
  formError, notice, submitting, onSubmit, busyLabel, submitLabel,
  email, onEmailChange, emailRef,
  password, onPasswordChange, passwordRef,
  errors,
  onUseMobileCode, onForgotPassword,
}: {
  formError: string | null
  notice: string | null
  submitting: boolean
  onSubmit: (e: FormEvent) => void
  busyLabel: string
  submitLabel: string
  email: string
  onEmailChange: (e: ChangeEvent<HTMLInputElement>) => void
  emailRef: RefObject<HTMLInputElement>
  password: string
  onPasswordChange: (value: string) => void
  passwordRef: RefObject<HTMLInputElement>
  errors: FieldErrors
  onUseMobileCode: () => void
  onForgotPassword: () => void
}) {
  return (
    <form noValidate onSubmit={onSubmit} aria-labelledby="sign-in-title" className="space-y-4">
      {notice && <Alert tone="success">{notice}</Alert>}
      {formError && <Alert tone="danger">{formError}</Alert>}

      <Input
        ref={emailRef}
        label="Email"
        type="email"
        name="email"
        autoComplete="email"
        inputMode="email"
        placeholder="you@company.com"
        value={email}
        onChange={onEmailChange}
        error={errors.email}
        leading={<Mail size={16} />}
      />

      <PasswordField
        label="Password"
        value={password}
        onChange={onPasswordChange}
        autoComplete="current-password"
        error={errors.password}
        inputRef={passwordRef}
        leading={<Lock size={16} />}
      />

      <div className="flex items-center justify-between text-xs sm:text-sm">
        <button type="button" className={clsx(linkClass)} onClick={onUseMobileCode}>
          Use a mobile code instead
        </button>
        <button type="button" className={clsx(linkClass)} onClick={onForgotPassword}>
          Forgot password?
        </button>
      </div>

      <Button type="submit" size="lg" fullWidth loading={submitting} className="font-bold justify-center shadow-xs">
        {submitting ? busyLabel : submitLabel}
      </Button>
    </form>
  )
}
