import { useMemo, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Plus } from 'lucide-react'
import { vendorAPI } from '@/services/api'
import { useVendorContext } from '@/components/vendor/vendorContext'
import {
  actionItems, groupByStage, loadPath, nextAction, type ActionItem, type LoadStage, type VendorInvoice, type VendorLoad,
} from '@/components/vendor/loads'
import { ActionCell, LoadFacts, ProblemPill, Route, TrackLink, TruckLine } from '@/components/vendor/LoadBits'
import {
  Alert, Button, buttonClasses, Card, EmptyState, ErrorState, Page, PageHeader, SearchInput, Skeleton,
} from '@/components/ui'
import { formatDate } from '@/utils/display'
import PostedLoads from '@/components/load-post/PostedLoads'
import BulkUpload from '@/components/load-post/BulkUpload'

const CLOSED: LoadStage = 'closed'

function ActionStrip({ items }: { items: ActionItem[] }) {
  if (items.length === 0) return null
  return (
    <section aria-label="What needs you" className="grid gap-2 lg:grid-cols-2">
      {items.map(item => (
        <Alert
          key={item.id}
          tone={item.tone}
          title={item.title}
          action={item.to && item.cta ? <Link to={item.to} className={buttonClasses({ variant: 'secondary', size: 'sm' })}>{item.cta}</Link> : undefined}
        >
          {item.detail}
        </Alert>
      ))}
    </section>
  )
}

function LoadCard({ load }: { load: VendorLoad }) {
  const action = nextAction(load)
  return (
    <Card padded className="flex flex-col gap-3 !p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Link to={loadPath(load.id)} className="font-mono text-sm font-medium text-brand hover:underline">{load.code}</Link>
          {load.kind === 'space' && <span className="rounded-full bg-info-soft px-2 py-0.5 text-xs font-medium text-info">Return trip</span>}
          <ProblemPill count={load.problems.length} />
          <span className="text-xs text-muted">{formatDate(load.created_at)}</span>
        </div>
        <Route pickup={load.pickup} drop={load.drop} className="text-sm font-medium text-text" />
        <p className="text-sm text-muted"><LoadFacts load={load} /></p>
        {load.truck && <p className="text-sm text-text"><TruckLine truck={load.truck} /></p>}
        {load.rejection_reason && <p className="text-sm text-danger">Not accepted: {load.rejection_reason}</p>}
      </div>
      <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end sm:text-right">
        <ActionCell action={action} className="text-sm sm:text-right" />
        <TrackLink load={load} />
      </div>
    </Card>
  )
}

export default function VendorLoadsPage() {
  const [params] = useSearchParams()
  const { vendorProfile, profileLoading, isVendor, isSignedIn } = useVendorContext()
  const [search, setSearch] = useState('')
  const [showClosed, setShowClosed] = useState(false)

  const loads = useQuery<VendorLoad[]>({
    queryKey: ['vendor', 'loads'],
    queryFn: () => vendorAPI.loads() as Promise<VendorLoad[]>,
    enabled: isVendor,
    refetchInterval: 30_000,
  })
  // Same query as the Posted loads section, so the "No loads yet" message is not shown beside posted loads.
  const posted = useQuery({ queryKey: ['vendor', 'posted-loads'], queryFn: () => vendorAPI.myPostedLoads(), enabled: isVendor, retry: false })
  const postedCount = posted.data?.items.length ?? 0
  const invoices = useQuery<VendorInvoice[]>({
    queryKey: ['vendor', 'invoices'],
    queryFn: () => vendorAPI.invoices() as Promise<VendorInvoice[]>,
    enabled: isVendor,
  })

  const items = useMemo(() => actionItems({
    kyc: profileLoading ? null : vendorProfile ? vendorProfile.kycStatus : 'none',
    kycRejectionReason: vendorProfile?.kycRejectionReason,
    locationMissing: !!vendorProfile && !vendorProfile.hasLocation,
    loads: loads.data ?? [],
    invoices: invoices.data ?? [],
  }), [profileLoading, vendorProfile, loads.data, invoices.data])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (loads.data ?? []).filter(l => !q || [l.code, l.pickup, l.drop, l.truck?.plate_number].some(v => (v ?? '').toLowerCase().includes(q)))
  }, [loads.data, search])
  const groups = groupByStage(filtered)

  // Old links and notifications open a load with ?open=<id>
  const open = params.get('open')
  if (open) return <Navigate to={loadPath(open)} replace />

  if (!isSignedIn || !isVendor) {
    return (
      <Page>
        <PageHeader title="My loads" description="Every load you post, and where it is now." />
        <EmptyState
          title="Sign in to see your loads"
          description="Your loads, invoices and claims are shown to signed-in vendors."
          action={(
            <div className="flex flex-col items-center gap-3 sm:flex-row">
              <Link to={`/login?next=${encodeURIComponent('/vendor/loads')}`} className={buttonClasses({ variant: 'primary' })}>Sign in</Link>
              <Link to="/vendor/request" className={buttonClasses({ variant: 'secondary' })}>Post a load</Link>
            </div>
          )}
        />
      </Page>
    )
  }

  const total = loads.data?.length ?? 0

  return (
    <Page>
      <PageHeader
        title="My loads"
        description="Every load you post or win space for, by where it is now."
        actions={<Link to="/vendor/request" className={buttonClasses({ variant: 'primary' })}><Plus size={16} aria-hidden="true" /> Post a load</Link>}
      />

      <ActionStrip items={items} />

      <PostedLoads enabled={isVendor} />

      <BulkUpload />

      {total > 6 && <SearchInput value={search} onChange={setSearch} placeholder="Search by code, place or truck" className="max-w-sm" />}

      {loads.isLoading ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}</div>
      ) : loads.isError ? (
        <ErrorState title="We could not load your loads" description="Check your connection and try again." onRetry={() => loads.refetch()} />
      ) : total === 0 && postedCount > 0 ? null : total === 0 ? (
        <EmptyState
          title="No loads yet"
          description="Post a load and MargixIndia will accept it, set the price and assign a truck. You can also bid on spare truck space under Return trips."
          action={(
            <div className="flex flex-wrap justify-center gap-2">
              <Link to="/vendor/request" className={buttonClasses({ variant: 'primary' })}>Post a load</Link>
              <Link to="/vendor/return-trips" className={buttonClasses({ variant: 'secondary' })}>See return trips</Link>
            </div>
          )}
        />
      ) : groups.length === 0 ? (
        <EmptyState compact title="No loads match your search" description="Try a different code or place." />
      ) : (
        <div className="space-y-8">
          {groups.map(group => {
            const closed = group.stage === CLOSED
            const collapsed = closed && !showClosed && !search
            return (
              <section key={group.stage} aria-labelledby={`stage-${group.stage}`} className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h2 id={`stage-${group.stage}`} className="text-lg font-semibold text-text">
                    {group.label} <span className="ml-1 text-sm font-normal text-muted tabular">{group.loads.length}</span>
                  </h2>
                  {closed && !search && (
                    <Button variant="ghost" size="sm" onClick={() => setShowClosed(s => !s)} aria-expanded={!collapsed} icon={collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}>
                      {collapsed ? 'Show' : 'Hide'}
                    </Button>
                  )}
                </div>
                {!collapsed && <div className="space-y-3">{group.loads.map(l => <LoadCard key={l.id} load={l} />)}</div>}
              </section>
            )
          })}
        </div>
      )}
    </Page>
  )
}
