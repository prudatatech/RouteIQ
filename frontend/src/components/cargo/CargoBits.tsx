/**
 * Small shared pieces for the cargo screens: the SLA countdown, the pieces bar, condition
 * and severity pills, consignment links and the step indicator.
 */
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { Check, Clock, X } from 'lucide-react'
import { StatusPill, toneClasses } from '@/components/ui'
import type { ConsignmentLabel, Pieces, Severity } from '@/services/cargo'
import { masterCodeOf } from '@/services/cargoMap'
import {
  CONDITION_TONES, SEVERITY_LABELS, SEVERITY_TONES, conditionLabel, consignmentCode, consignmentHref, pieceSummary, slaState, type StepState,
} from './logic'

/** "3 h 12 min left" / "Overdue by 25 min", coloured by how close the deadline is. */
export function SlaBadge({ dueAt, status, now, className }: { dueAt: string | null | undefined; status: string; now: number; className?: string }) {
  const sla = slaState(dueAt, status, now)
  if (sla.state === 'stopped') return <span className={clsx('text-xs text-muted', className)}>{sla.label}</span>
  return (
    <StatusPill tone={sla.tone} dot={false} className={clsx('tabular', className)}>
      <Clock size={12} aria-hidden="true" />
      <span className="whitespace-nowrap">{sla.label}</span>
    </StatusPill>
  )
}

export function SeverityPill({ severity }: { severity: Severity | string }) {
  const s = severity as Severity
  return <StatusPill tone={SEVERITY_TONES[s] ?? 'neutral'}>{SEVERITY_LABELS[s] ?? severity}</StatusPill>
}

export function ConditionPill({ condition }: { condition: string | null | undefined }) {
  if (!condition) return <span className="text-muted">—</span>
  return <StatusPill tone={CONDITION_TONES[condition as keyof typeof CONDITION_TONES] ?? 'neutral'} dot={false}>{conditionLabel(condition)}</StatusPill>
}

/** RTX-… / CM-… as a link to the consignment. A lot shows its own code (`RTX-ABC123-B`) and names its master on hover. */
export function ConsignmentLink({ c, className }: { c: ConsignmentLabel; className?: string }) {
  const href = consignmentHref(c)
  const code = consignmentCode(c)
  const master = masterCodeOf(code)
  const title = c.lot_label && master ? `Lot ${c.lot_label} of ${master}` : undefined
  if (!href) return <span title={title} className={clsx('whitespace-nowrap font-mono', className)}>{code}</span>
  return <Link to={href} title={title} className={clsx('whitespace-nowrap font-mono font-medium text-brand hover:underline', className)}>{code}</Link>
}

const segmentFill: Record<string, string> = {
  success: toneClasses.success.dot,
  info: toneClasses.info.dot,
  neutral: toneClasses.neutral.dot,
  danger: toneClasses.danger.dot,
}

/** Where a consignment's pieces are: a stacked bar with a legend. Colour is never the only cue. */
export function PiecesBar({ pieces, className }: { pieces: Pieces; className?: string }) {
  const s = pieceSummary(pieces)
  const base = Math.max(s.total ?? 0, s.segments.reduce((n, x) => n + x.value, 0)) || 1
  return (
    <div className={clsx('space-y-2', className)}>
      <p className="text-sm text-text">{s.headline}</p>
      {s.segments.length > 0 && (
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-neutral-soft" aria-hidden="true">
          {s.segments.map(seg => (
            <span key={seg.key} className={segmentFill[seg.tone]} style={{ width: `${(seg.value / base) * 100}%` }} />
          ))}
        </div>
      )}
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {s.segments.map(seg => (
          <li key={seg.key} className="inline-flex items-center gap-1.5">
            <span className={clsx('h-2 w-2 rounded-full', segmentFill[seg.tone])} aria-hidden="true" />
            {seg.label} <span className="tabular text-text">{seg.value.toLocaleString('en-IN')}</span>
          </li>
        ))}
        {s.damaged > 0 && <li className="text-warning">{s.damaged.toLocaleString('en-IN')} damaged</li>}
        {s.unaccounted > 0 && <li className="text-warning">{s.unaccounted.toLocaleString('en-IN')} not accounted for</li>}
        {s.overCounted && <li className="text-danger">Counts add up to more than the total</li>}
      </ul>
    </div>
  )
}

/**
 * Horizontal steps that wrap on narrow screens: done (tick, or its number when `numbered`), current (filled), to do (empty),
 * stopped (cross, for cancelled, rejected or withdrawn).
 */
export function Steps({ steps, label, className, numbered = false }: {
  steps: { key: string; label: string; state: StepState }[]
  label: string
  className?: string
  /** Show the step number in every circle, done ones included, instead of a tick. */
  numbered?: boolean
}) {
  return (
    <ol aria-label={label} className={clsx('flex flex-wrap items-center gap-x-2 gap-y-2', className)}>
      {steps.map((step, i) => (
        <li key={step.key} className="flex items-center gap-2" aria-current={step.state === 'current' ? 'step' : undefined}>
          <span
            className={clsx(
              'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
              step.state === 'done' && 'border-success bg-success text-white',
              step.state === 'current' && 'border-brand bg-brand-fill text-on-brand',
              step.state === 'todo' && 'border-border-strong bg-surface text-muted',
              step.state === 'stopped' && 'border-danger bg-danger text-white',
            )}
            aria-hidden="true"
          >
            {step.state === 'done' && !numbered ? <Check size={14} /> : step.state === 'stopped' ? <X size={14} /> : i + 1}
          </span>
          <span className={clsx('text-sm', step.state === 'todo' ? 'text-muted' : 'font-medium text-text')}>
            {step.label}
            <span className="sr-only">{step.state === 'done' ? ' (done)' : step.state === 'current' ? ' (now)' : step.state === 'stopped' ? ' (stopped)' : ''}</span>
          </span>
          {i < steps.length - 1 && <span className="hidden h-px w-6 bg-border sm:block" aria-hidden="true" />}
        </li>
      ))}
    </ol>
  )
}
