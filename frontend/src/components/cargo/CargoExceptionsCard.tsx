import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, PackageX } from 'lucide-react'
import { Button, Card, Skeleton } from '@/components/ui'
import { cargoKeys, exceptionsAPI } from '@/services/cargo'
import { useNow } from './useNow'
import { isOpenException, slaState } from './logic'

/** Dashboard card: how many cargo exception cases are open and how many are past their deadline. */
export default function CargoExceptionsCard() {
  const navigate = useNavigate()
  const now = useNow()
  const q = useQuery({
    queryKey: cargoKeys.exceptions({}),
    queryFn: () => exceptionsAPI.list({}),
    refetchInterval: 60_000,
  })
  const open = (q.data ?? []).filter(e => isOpenException(e.status))
  const overdue = open.filter(e => slaState(e.sla_due_at, e.status, now).state === 'overdue').length

  return (
    <Card padded className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand" aria-hidden="true"><PackageX size={18} /></span>
        <div>
          <p className="text-sm font-medium text-text">Cargo exceptions</p>
          {q.isLoading ? (
            <Skeleton className="mt-1 h-4 w-32" />
          ) : q.isError ? (
            <p className="text-xs text-danger" role="alert">
              We could not load cargo exceptions.{' '}
              <button type="button" onClick={() => q.refetch()} className="underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">Try again</button>
            </p>
          ) : (
            <p className="text-xs text-muted">
              {open.length.toLocaleString('en-IN')} open ·{' '}
              <span className={overdue > 0 ? 'font-medium text-danger' : undefined}>{overdue.toLocaleString('en-IN')} overdue</span>
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {overdue > 0 && (
          <Button variant="secondary" size="sm" onClick={() => navigate('/cargo?overdue=1')}>Overdue</Button>
        )}
        <Button variant="secondary" size="sm" icon={<ChevronRight size={16} />} onClick={() => navigate('/cargo')}>Open queue</Button>
      </div>
    </Card>
  )
}
