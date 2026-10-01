import {
  forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react'
import clsx from 'clsx'
import { ChevronDown, Search, X } from 'lucide-react'
import { formatDate } from '@/utils/display'

export const controlClasses =
  'block w-full rounded-control border bg-surface px-3 text-base sm:text-sm text-text placeholder:text-placeholder ' +
  'transition-colors focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand ' +
  'disabled:bg-surface-subtle disabled:text-muted disabled:cursor-not-allowed'

const borderClasses = (invalid?: boolean) => (invalid ? 'border-danger' : 'border-border-strong')

interface FieldOwnProps {
  label?: ReactNode
  /** Short help text under the control. Hidden while an error is shown. */
  hint?: ReactNode
  /** Validation message; also marks the control invalid. */
  error?: ReactNode
  required?: boolean
  /** Hide the label visually but keep it for screen readers. */
  hideLabel?: boolean
  className?: string
}

/**
 * Label, hint and error around any control. The render prop receives the ids and
 * aria attributes to spread on the control so the label and messages are linked.
 */
export function Field({ label, hint, error, required, hideLabel, className, id, children }: FieldOwnProps & {
  id?: string
  children: (control: { id: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string; required?: boolean }) => ReactNode
}) {
  const generated = useId()
  const controlId = id ?? generated
  const messageId = `${controlId}-message`
  const message = error || hint
  return (
    <div className={clsx('flex flex-col gap-1.5', className)}>
      {label && (
        <label htmlFor={controlId} className={clsx('text-sm font-medium text-text', hideLabel && 'sr-only')}>
          {label}
          {required && <span className="text-danger" aria-hidden="true"> *</span>}
        </label>
      )}
      {children({
        id: controlId,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': message ? messageId : undefined,
        required,
      })}
      {message && (
        <p id={messageId} className={clsx('text-xs', error ? 'text-danger' : 'text-muted')} role={error ? 'alert' : undefined}>
          {message}
        </p>
      )}
    </div>
  )
}

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'>, FieldOwnProps {
  /** Content shown inside the control on the left, such as an icon or currency sign. */
  leading?: ReactNode
  /** Content shown inside the control on the right, such as a unit. */
  trailing?: ReactNode
  inputClassName?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, required, hideLabel, className, inputClassName, leading, trailing, id, ...props },
  ref,
) {
  // A native date box follows the browser's locale (10/01/2026 is 1 Oct or 10 Jan); say the date in words.
  const typed = props.type === 'date' && typeof props.value === 'string' && props.value ? formatDate(props.value) : null
  const shownHint = typed ? (hint ? <>{hint} <span className="whitespace-nowrap">({typed})</span></> : typed) : hint
  return (
    <Field label={label} hint={shownHint} error={error} required={required} hideLabel={hideLabel} className={className} id={id}>
      {control => (
        <div className="relative">
          {leading && (
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted">{leading}</span>
          )}
          <input
            ref={ref}
            {...control}
            {...props}
            className={clsx(
              controlClasses, borderClasses(!!error), 'h-control',
              leading && 'pl-9', trailing && 'pr-12', inputClassName,
            )}
          />
          {trailing && (
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted">{trailing}</span>
          )}
        </div>
      )}
    </Field>
  )
})

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'>, FieldOwnProps {
  options?: SelectOption[]
  /** Shown as a disabled first option when no value is chosen. */
  placeholder?: string
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, required, hideLabel, className, options, placeholder, children, id, ...props },
  ref,
) {
  return (
    <Field label={label} hint={hint} error={error} required={required} hideLabel={hideLabel} className={className} id={id}>
      {control => (
        <div className="relative">
          <select
            ref={ref}
            {...control}
            {...props}
            className={clsx(controlClasses, borderClasses(!!error), 'h-control appearance-none pr-9')}
          >
            {placeholder && <option value="" disabled>{placeholder}</option>}
            {options?.map(o => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
            {children}
          </select>
          <ChevronDown size={16} aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
        </div>
      )}
    </Field>
  )
})

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement>, FieldOwnProps {}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, required, hideLabel, className, rows = 3, id, ...props },
  ref,
) {
  return (
    <Field label={label} hint={hint} error={error} required={required} hideLabel={hideLabel} className={className} id={id}>
      {control => (
        <textarea
          ref={ref}
          rows={rows}
          {...control}
          {...props}
          className={clsx(controlClasses, borderClasses(!!error), 'py-2 resize-y')}
        />
      )}
    </Field>
  )
})

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  label: ReactNode
  description?: ReactNode
  error?: ReactNode
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, description, error, className, id, ...props },
  ref,
) {
  const generated = useId()
  const controlId = id ?? generated
  return (
    <div className={clsx('flex flex-col gap-1', className)}>
      <label htmlFor={controlId} className="flex items-start gap-3 cursor-pointer">
        <input
          ref={ref}
          id={controlId}
          type="checkbox"
          aria-invalid={error ? true : undefined}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-border-strong accent-brand cursor-pointer"
          {...props}
        />
        <span className="text-sm">
          <span className="text-text">{label}</span>
          {description && <span className="block text-muted mt-0.5">{description}</span>}
        </span>
      </label>
      {error && <p className="text-xs text-danger pl-7" role="alert">{error}</p>}
    </div>
  )
})

export interface SearchInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'size'> {
  value: string
  onChange: (value: string) => void
  /** Accessible name; the placeholder alone is not a label. */
  label?: string
}

/** Search box with a clear button, for filtering lists and tables. */
export function SearchInput({ value, onChange, label = 'Search', placeholder = 'Search', className, ...props }: SearchInputProps) {
  return (
    <div className={clsx('relative', className)}>
      <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
      <input
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        className={clsx(controlClasses, 'border-border-strong h-control pl-9 pr-9 [&::-webkit-search-cancel-button]:hidden')}
        {...props}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-control text-muted hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        >
          <X size={14} />
        </button>
      )}
    </div>
  )
}
