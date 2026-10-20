import type { FormEvent, RefObject } from 'react'
import { Lock } from 'lucide-react'
import { Alert, Button } from '@/components/ui'
import { PasswordField } from './PasswordField'
import type { FieldErrors } from './types'

export function ResetPasswordForm({
  formError, notice, submitting, onSubmit, busyLabel, submitLabel,
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

      <PasswordField
        label="New password"
        value={password}
        onChange={onPasswordChange}
        autoComplete="new-password"
        error={errors.password}
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
