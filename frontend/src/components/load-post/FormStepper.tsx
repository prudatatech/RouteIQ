import clsx from 'clsx'
import { Check } from 'lucide-react'
import { STEP_LABELS } from './logic'

/** Where the person is in the form. Phone: "Step 2 of 4 · Goods" over a thin four-segment bar. Wider: modern circular numbered stepper. */
export default function FormStepper({ step, onGo }: { step: number; onGo: (s: number) => void }) {
  return (
    <nav aria-label="Steps" className="space-y-1.5 py-1">
      <p className="text-sm font-medium text-text sm:hidden">Step {step + 1} of {STEP_LABELS.length} · {STEP_LABELS[step]}</p>

      <ol className="flex items-center gap-2 sm:gap-3">
        {STEP_LABELS.map((label, i) => {
          const isDone = i < step
          const isCurrent = i === step
          return (
            <li key={label} className="min-w-0 flex-1">
              <button
                type="button"
                disabled={i > step}
                onClick={() => onGo(i)}
                aria-current={isCurrent ? 'step' : undefined}
                aria-label={`${i + 1}. ${label}`}
                className={clsx(
                  'group flex w-full flex-col gap-1.5 text-left transition-all',
                  isCurrent ? 'font-bold text-text' : isDone ? 'font-medium text-text hover:text-brand' : 'text-muted',
                  i > step && 'cursor-default opacity-60'
                )}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={clsx(
                      'hidden sm:flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-mono transition-all',
                      isDone
                        ? 'bg-success text-white'
                        : isCurrent
                        ? 'bg-brand-fill text-on-brand font-bold ring-2 ring-brand-fill/30'
                        : 'bg-surface-subtle border border-border text-muted'
                    )}
                  >
                    {isDone ? <Check size={12} strokeWidth={3} /> : i + 1}
                  </span>
                  <span className="hidden sm:inline-block text-xs truncate">
                    {label}
                  </span>
                </div>
                <span
                  className={clsx(
                    'block h-1.5 w-full rounded-full transition-all duration-300',
                    isDone ? 'bg-success' : isCurrent ? 'bg-brand-fill' : 'bg-border'
                  )}
                />
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
