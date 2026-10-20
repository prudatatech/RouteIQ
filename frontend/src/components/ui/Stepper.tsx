import { Check, CheckCircle2 } from 'lucide-react'
import clsx from 'clsx'
import { Card } from './Card'

export interface StepperProps {
  /** Step labels, in order. */
  steps: readonly string[]
  /** Index (0-based) of the active step. */
  current: number
  /**
   * Called with a step's index when the user clicks it. When omitted, the
   * stepper renders read-only (no buttons, no hover/focus affordance).
   */
  onSelect?: (index: number) => void
  /**
   * Visual chrome: `'panel'` is a centered card with a connecting line through
   * icon centers and the label below each icon (used by the 3PL onboarding
   * wizard). `'inline'` is a left-aligned row with the label beside each icon
   * and a short connector between steps (used by vendor KYC). Defaults to
   * `'panel'`.
   */
  variant?: 'panel' | 'inline'
}

/**
 * Progress indicator for multi-step wizards. Shows a checkmark on completed
 * steps and highlights the current one; optionally lets completed/current
 * steps be clicked via `onSelect`.
 */
export function Stepper({ steps, current, onSelect, variant = 'panel' }: StepperProps) {
  if (variant === 'inline') {
    return (
      <ol className="flex flex-wrap items-center gap-y-2">
        {steps.map((label, i) => {
          const completed = i < current
          const icon = (
            <span className={
              completed
                ? 'flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-fill text-xs font-medium text-text'
                : i === current
                  ? 'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-brand text-xs font-medium text-brand'
                  : 'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border text-xs font-medium text-muted'
            }>
              {completed ? <Check size={14} /> : i + 1}
            </span>
          )
          const text = <span className={i === current ? 'text-sm font-medium text-text' : 'text-sm text-muted'}>{label}</span>

          return (
            <li key={label} className="flex items-center">
              {onSelect ? (
                <button
                  type="button"
                  onClick={() => onSelect(i)}
                  aria-current={i === current ? 'step' : undefined}
                  className="flex items-center gap-2 rounded-control px-1 py-1 text-left"
                >
                  {icon}
                  {text}
                </button>
              ) : (
                <span aria-current={i === current ? 'step' : undefined} className="flex items-center gap-2 px-1 py-1 text-left">
                  {icon}
                  {text}
                </span>
              )}
              {i < steps.length - 1 && <span className="mx-2 h-px w-6 bg-border sm:w-10" aria-hidden="true" />}
            </li>
          )
        })}
      </ol>
    )
  }

  return (
    <Card padded className="mb-6 flex justify-between items-center py-3.5 px-3 sm:py-4 sm:px-6 md:px-12 overflow-hidden shadow-xs">
      {steps.map((label, i) => {
        const completed = i < current
        return (
          <div key={label} className="flex flex-col items-center relative flex-1 min-w-0">
            {i < steps.length - 1 && (
              <div
                className={clsx(
                  'absolute top-3.5 sm:top-4 left-[50%] right-[-50%] h-[2px] transition-colors',
                  completed ? 'bg-success' : 'bg-border'
                )}
              />
            )}

            <div
              className={clsx(
                'relative z-10 flex h-7 w-7 sm:h-8 sm:w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-all',
                completed
                  ? 'bg-success text-white shadow-xs'
                  : i === current
                    ? 'bg-brand text-brand-fill ring-4 ring-brand/20 shadow-xs'
                    : 'bg-surface text-muted border border-border'
              )}
            >
              {completed ? <CheckCircle2 size={16} /> : i + 1}
            </div>

            <span
              className={clsx(
                'mt-2 text-[10px] sm:text-xs font-semibold text-center transition-colors truncate max-w-full px-0.5 sm:px-1',
                i === current ? 'text-brand font-bold' : completed ? 'text-text' : 'text-muted'
              )}
            >
              {label}
            </span>
          </div>
        )
      })}
    </Card>
  )
}
