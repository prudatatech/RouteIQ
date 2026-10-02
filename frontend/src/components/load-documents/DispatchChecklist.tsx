import { AlertTriangle } from 'lucide-react'
import { Alert, EmptyState, StatusPill } from '@/components/ui'
import type { DispatchCheck } from '@/types/loadDocuments'
import { CHECK_LABELS } from './model'

/** What is needed before this load moves, with a pill for each item. */
export function DispatchChecklist({ check }: { check: DispatchCheck }) {
  const problems = check.items.filter(i => i.status !== 'ok' && i.required)
  return (
    <section aria-labelledby="dispatch-check-title" className="space-y-3">
      <h3 id="dispatch-check-title" className="text-base font-semibold text-text">Before dispatch</h3>
      {check.blocking && (
        <Alert tone="danger" title="Dispatch is on hold">
          Your company requires these to be in order before a vehicle leaves.
        </Alert>
      )}
      {!check.blocking && problems.length > 0 && (
        <Alert tone="warning" title={`${problems.length} ${problems.length === 1 ? 'item needs' : 'items need'} attention`}>
          You can still dispatch, but fix these first.
        </Alert>
      )}
      {check.items.length === 0 ? (
        <EmptyState compact icon={<AlertTriangle size={20} />} title="Nothing to check yet" />
      ) : (
        <ul className="divide-y divide-border rounded-card border border-border bg-surface">
          {check.items.map(item => {
            const s = CHECK_LABELS[item.status]
            return (
              <li key={item.key} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text">
                    {item.label}
                    {!item.required && <span className="ml-2 text-xs font-normal text-muted">Optional</span>}
                  </p>
                  {item.detail && <p className="mt-0.5 text-xs text-muted">{item.detail}</p>}
                </div>
                <StatusPill tone={s.tone}>{s.label}</StatusPill>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
