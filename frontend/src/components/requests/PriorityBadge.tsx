import { StatusPill } from '@/components/ui'

/** The load's priority for a logistic company: "Urgent" for high, a plain label otherwise. Nothing for medium. */
export default function PriorityBadge({ priority }: { priority: 'high' | 'medium' | 'low' | null | undefined }) {
  if (priority === 'high') return <StatusPill tone="danger">Urgent</StatusPill>
  if (priority === 'low') return <StatusPill tone="neutral">Low priority</StatusPill>
  return <span className="text-muted">Normal</span>
}
