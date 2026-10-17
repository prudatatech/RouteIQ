import type { ChangeEvent, FormEvent, RefObject } from 'react'
import { Alert, Button, Input } from '@/components/ui'
import type { FieldErrors } from './types'

export function ForgotPasswordForm({
  formError, notice, submitting, onSubmit, busyLabel, submitLabel,
  email, onEmailChange, emailRef,
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
      />

      <Button type="submit" size="lg" fullWidth loading={submitting}>
        {submitting ? busyLabel : submitLabel}
      </Button>
    </form>
  )
}
