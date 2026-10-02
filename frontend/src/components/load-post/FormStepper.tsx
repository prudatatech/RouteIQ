import clsx from 'clsx'
import { STEP_LABELS } from './logic'

/** Where the person is in the form. Phone: "Step 2 of 4 · Goods" over a thin four-segment bar. Wider: the four step names. */
export default function FormStepper({ step, onGo }: { step: number; onGo: (s: number) => void }) {
  return (
    <nav aria-label="Steps" className="space-y-1.5">
      <p className="text-sm font-medium text-text sm:hidden">Step {step + 1} of {STEP_LABELS.length} · {STEP_LABELS[step]}</p>
      <ol className="flex gap-1.5">
        {STEP_LABELS.map((label, i) => (
          <li key={label} className="min-w-0 flex-1">
            <button
              type="button"
              disabled={i > step}
              onClick={() => onGo(i)}
              aria-current={i === step ? 'step' : undefined}
              aria-label={`${i + 1}. ${label}`}
              className={clsx('flex w-full flex-col gap-1.5 text-left text-xs', i === step ? 'font-semibold text-text' : 'text-muted', i > step && 'cursor-default')}
            >
              <span className={clsx('block h-1 w-full rounded-full sm:h-1.5', i <= step ? 'bg-brand-fill' : 'bg-border')} />
              <span className="hidden truncate sm:block">{i + 1}. {label}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  )
}
