import clsx from 'clsx'
import { Check } from 'lucide-react'

/** Numbered steps across the top of a wizard. Completed steps show a tick. */
export default function StepIndicator({ steps, current }: { steps: readonly { id: string; label: string }[]; current: number }) {
  return (
    <nav aria-label="Progress">
      <p className="text-sm text-muted sm:hidden">
        Step {current + 1} of {steps.length}: <span className="font-medium text-text">{steps[current].label}</span>
      </p>
      <ol className="hidden items-center gap-2 sm:flex">
        {steps.map((step, i) => {
          const done = i < current
          const active = i === current
          return (
            <li key={step.id} className="flex flex-1 items-center gap-2" aria-current={active ? 'step' : undefined}>
              <span
                className={clsx(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                  done && 'bg-brand-soft text-brand',
                  active && 'bg-brand-fill text-on-brand',
                  !done && !active && 'border border-border-strong text-muted',
                )}
              >
                {done ? <Check size={14} aria-hidden="true" /> : i + 1}
              </span>
              <span className={clsx('text-sm', active ? 'font-medium text-text' : 'text-muted')}>
                {step.label}
                {done && <span className="sr-only"> (done)</span>}
              </span>
              {i < steps.length - 1 && <span aria-hidden="true" className="h-px flex-1 bg-border" />}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
