import type { ReactNode } from 'react'
import clsx from 'clsx'
import { toneClasses } from '@/components/ui/status'
import { FLOW_STAGES, stageState, type NextStep } from './nextStep'

/**
 * The bar at the top of a shipment page: the six stages of the core flow with the current one
 * marked, what is happening now, and the one thing to do next (or who it is waiting on).
 * `action` is the button or link for `step.action`, built by the page.
 */
export default function NextStepBar({ step, action }: { step: NextStep; action?: ReactNode }) {
  const tone = toneClasses[step.tone]
  const currentIndex = step.stage ? FLOW_STAGES.findIndex(s => s.id === step.stage) : -1
  const stageLabel = step.stage ? FLOW_STAGES[currentIndex].label : 'Left the flow'

  return (
    <section aria-label="What's next" className="space-y-4 rounded-card border border-border bg-surface p-4 sm:p-6">
      <div>
        <p className="mb-2 flex items-center justify-between gap-3 text-xs text-muted sm:hidden">
          <span>{step.stage ? `Step ${currentIndex + 1} of ${FLOW_STAGES.length}` : 'Not in the flow'}</span>
          <span className="font-medium text-text">{stageLabel}</span>
        </p>
        <ol className="grid grid-cols-6 gap-1.5 sm:gap-3" aria-label="Where it is in the flow">
          {FLOW_STAGES.map(s => {
            const state = stageState(step.stage, s.id)
            return (
              <li key={s.id} className="min-w-0" aria-current={state === 'current' ? 'step' : undefined}>
                <span className={clsx('block h-1.5 rounded-full', state === 'todo' ? 'bg-neutral-soft' : state === 'done' ? 'bg-brand-fill' : tone.dot)} aria-hidden="true" />
                <span className={clsx('mt-1.5 hidden truncate text-xs sm:block', state === 'current' ? 'font-semibold text-text' : 'text-muted')}>
                  {s.label}
                  <span className="sr-only">{state === 'done' ? ', done' : state === 'current' ? ', current stage' : ', still to come'}</span>
                </span>
              </li>
            )
          })}
        </ol>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className={clsx('text-lg font-semibold', step.tone === 'neutral' ? 'text-text' : tone.text)}>{step.headline}</p>
          {step.detail && <p className="mt-0.5 text-sm text-muted">{step.detail}</p>}
          {!action && step.waitingOn && <p className="mt-1 text-sm text-text">Waiting on {step.waitingOn}.</p>}
        </div>
        {action && <div className="flex shrink-0 flex-wrap items-center gap-2 [&>*]:w-full sm:[&>*]:w-auto">{action}</div>}
      </div>
    </section>
  )
}
