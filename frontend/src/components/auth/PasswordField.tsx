import { useState, type ReactNode, type RefObject } from 'react'
import clsx from 'clsx'
import { Eye, EyeOff } from 'lucide-react'
import { Field, IconButton, controlClasses } from '@/components/ui'

/** A password input with a show/hide toggle, used by every flow that collects a password. */
export function PasswordField({ label, value, onChange, autoComplete, error, hint, inputRef }: {
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
