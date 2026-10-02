import { Button } from '@/components/ui'

/**
 * Back and Next. On a phone the bar sticks to the bottom of the screen (with the home-bar safe area) so it is always
 * within reach; from sm it sits in the flow as before.
 */
export default function StepActions({ step, last, onBack, onNext }: { step: number; last: number; onBack: () => void; onNext: () => void }) {
  return (
    <div
      className="sticky bottom-0 z-30 -mx-4 flex gap-2 border-t border-border bg-surface px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:static sm:mx-0 sm:justify-end sm:border-0 sm:bg-transparent sm:p-0"
      data-testid="step-actions"
    >
      {step > 0 && <Button variant={step === last ? 'ghost' : 'secondary'} size="lg" onClick={onBack}>Back</Button>}
      {step < last && <Button size="lg" className="flex-1 sm:flex-none" onClick={onNext}>Next</Button>}
    </div>
  )
}
