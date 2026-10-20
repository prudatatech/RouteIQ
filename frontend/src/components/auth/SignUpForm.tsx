import type { ChangeEvent, FormEvent, RefObject } from 'react'
import { Mail, Lock } from 'lucide-react'
import { Alert, Button, Input } from '@/components/ui'
import { PasswordField } from './PasswordField'
import { MIN_PASSWORD_LENGTH } from './constants'
import type { FieldErrors } from './types'

export function SignUpForm({
  formError, notice, submitting, onSubmit, busyLabel, submitLabel,
  email, onEmailChange, emailRef,
  password, onPasswordChange, passwordRef,
  confirm, onConfirmChange, confirmRef,
  errors,
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
  confirm: string
  onConfirmChange: (value: string) => void
  confirmRef: RefObject<HTMLInputElement>
  errors: FieldErrors
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
        autoComplete="new-password"
        error={errors.password}
        hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
        inputRef={passwordRef}
        leading={<Lock size={16} />}
      />

      <PasswordField
        label="Confirm password"
        value={confirm}
        onChange={onConfirmChange}
        autoComplete="new-password"
        error={errors.confirm}
        inputRef={confirmRef}
        leading={<Lock size={16} />}
      />

      <Button type="submit" size="lg" fullWidth loading={submitting} className="font-bold justify-center shadow-xs">
        {submitting ? busyLabel : submitLabel}
      </Button>
    </form>
  )
}
