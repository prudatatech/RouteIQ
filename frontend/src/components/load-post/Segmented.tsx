import type { ReactNode } from 'react'
import clsx from 'clsx'

export interface SegmentOption<T extends string> {
  value: T
  label: ReactNode
  /** One short line under the label. */
  hint?: ReactNode
  /** Plain-text name for screen readers when the label is not text. */
  ariaLabel?: string
}

/**
 * A compact segmented control built on radio inputs: the keyboard (arrows) and screen readers work as for any radio
 * group. Options sit side by side from sm and stack on a phone.
 */
export default function Segmented<T extends string>({ name, legend, required, value, options, onChange, error, columns = 'sm:grid-cols-3' }: {
  name: string
  legend: string
  required?: boolean
  value: T
  options: SegmentOption<T>[]
  onChange: (value: T) => void
  error?: string
  columns?: string
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium text-text">
        {legend} {required && <span className="text-danger" aria-hidden="true">*</span>}
      </legend>
      <div className={clsx('grid gap-2', columns)}>
        {options.map(o => (
          <label
            key={o.value}
            className={clsx(
              'flex cursor-pointer flex-col justify-center rounded-control border px-3 py-2 text-sm transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand',
              value === o.value ? 'border-brand bg-brand-soft' : 'border-border-strong bg-surface hover:bg-surface-subtle',
            )}
          >
            <input
              type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)}
              className="sr-only" aria-label={o.ariaLabel}
            />
            <span className="font-medium text-text">{o.label}</span>
            {o.hint && <span className="text-xs text-muted">{o.hint}</span>}
          </label>
        ))}
      </div>
      {error && <p className="mt-1 text-xs text-danger" role="alert">{error}</p>}
    </fieldset>
  )
}
