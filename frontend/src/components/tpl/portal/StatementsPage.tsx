import { useQuery } from '@tanstack/react-query'
import { FileText } from 'lucide-react'
import { Card, EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui'
import { tplPortalAPI } from '@/services/api'
import { StatementPdfButton, StatementStatusPill, StatementSummary } from '@/components/tpl/statements'
import { periodLabel, statementDates } from '@/components/tpl/statementFormat'
import { usePortal } from './portalContext'

/** Statements: what each company worked out for a month's delivered orders, the deductions, and the balance it pays. */
export default function StatementsPage() {
  const { partner } = usePortal()
  const statements = useQuery({ queryKey: ['tpl-portal-statements', partner.id], queryFn: () => tplPortalAPI.statements(partner.id) })

  return (
    <div className="space-y-6">
      <PageHeader title="Statements" description="A company sends one for each month once it has checked your delivered orders." />
      {statements.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : statements.error ? (
        <ErrorState description="We could not load your statements." onRetry={() => statements.refetch()} />
      ) : (statements.data ?? []).length === 0 ? (
        <Card padded>
          <EmptyState compact icon={<FileText size={22} />} title="No statements yet" description="When a company issues a statement for a month, it shows up here." />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {(statements.data ?? []).map(s => (
            <Card key={s.id} padded className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-base font-semibold text-text">{periodLabel(s.period)}</p>
                  <p className="text-xs text-muted">{[s.company_name, statementDates(s)].filter(Boolean).join(' · ')}</p>
                </div>
                <StatementStatusPill status={s.status} />
              </div>
              <StatementSummary statement={s} />
              {s.status !== 'draft' && (
                <StatementPdfButton fetchPdf={() => tplPortalAPI.statementPdf(partner.id, s.id)} />
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
