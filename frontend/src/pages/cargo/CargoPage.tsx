import { useMemo, useState } from 'react'
import { AlertTriangle, ArrowRightLeft, Building2, Plus, ShieldAlert } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Button, Page, PageHeader, Stat, TabPanel, Tabs, useTabParam, type TabItem } from '@/components/ui'
import ExceptionsTab from '@/components/cargo/ExceptionsTab'
import TransfersTab from '@/components/cargo/TransfersTab'
import HubsTab from '@/components/cargo/HubsTab'
import ClaimsTab from '@/components/cargo/ClaimsTab'
import RaiseExceptionModal from '@/components/cargo/RaiseExceptionModal'
import { cargoKeys, claimsAPI, exceptionsAPI, hubsAPI, transfersAPI } from '@/services/cargo'
import { isActiveTransfer, isOpenException } from '@/components/cargo/logic'

const TAB_IDS = ['exceptions', 'transfers', 'hubs', 'claims'] as const
type TabId = (typeof TAB_IDS)[number]

/** The cargo control tower: exception cases, transfers between vehicles, hub stock and claims. */
export default function CargoPage() {
  const [tab, setTab] = useTabParam<TabId>(TAB_IDS, 'exceptions')
  const [raising, setRaising] = useState(false)

  // Lightweight queries for telemetry pulse
  const exceptionsQuery = useQuery({
    queryKey: cargoKeys.exceptions(),
    queryFn: () => exceptionsAPI.list(),
    staleTime: 15_000,
  })

  const transfersQuery = useQuery({
    queryKey: cargoKeys.transfers(),
    queryFn: () => transfersAPI.list(),
    staleTime: 30_000,
  })

  const hubsQuery = useQuery({
    queryKey: cargoKeys.hubs,
    queryFn: () => hubsAPI.list(),
    staleTime: 60_000,
  })

  const claimsQuery = useQuery({
    queryKey: cargoKeys.claims(),
    queryFn: () => claimsAPI.list(),
    staleTime: 30_000,
  })

  const activeExceptions = useMemo(
    () => (exceptionsQuery.data ?? []).filter(e => isOpenException(e.status)),
    [exceptionsQuery.data],
  )
  const criticalExceptions = useMemo(
    () => activeExceptions.filter(e => e.severity === 'critical' || e.severity === 'high'),
    [activeExceptions],
  )
  const activeTransfers = useMemo(
    () => (transfersQuery.data ?? []).filter(t => isActiveTransfer(t.status)),
    [transfersQuery.data],
  )
  const activeClaims = useMemo(
    () => (claimsQuery.data ?? []).filter(c => c.status !== 'settled' && c.status !== 'rejected' && c.status !== 'withdrawn'),
    [claimsQuery.data],
  )

  const tabs: TabItem<TabId>[] = [
    { id: 'exceptions', label: 'Problems', count: activeExceptions.length > 0 ? activeExceptions.length : undefined },
    { id: 'transfers', label: 'Transfers', count: activeTransfers.length > 0 ? activeTransfers.length : undefined },
    { id: 'hubs', label: 'Hubs', count: hubsQuery.data?.length ? hubsQuery.data.length : undefined },
    { id: 'claims', label: 'Claims', count: activeClaims.length > 0 ? activeClaims.length : undefined },
  ]

  return (
    <Page>
      <PageHeader
        title="Cargo Control Tower"
        description="Where goods are, who holds custody, and every exception case tracked to resolution."
        actions={<Button icon={<Plus size={16} />} onClick={() => setRaising(true)}>Raise a problem</Button>}
      >
        <Tabs tabs={tabs} value={tab} onChange={setTab} label="Problems sections" />
      </PageHeader>

      {/* Cargo Telemetry Pulse */}
      <section aria-label="Cargo operational pulse" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <button
          type="button"
          onClick={() => setTab('exceptions')}
          className="text-left transition-all hover:scale-[1.01] focus:outline-none"
        >
          <Stat
            label="Active Problems"
            value={exceptionsQuery.isLoading ? '—' : activeExceptions.length.toLocaleString('en-IN')}
            tone={criticalExceptions.length > 0 ? 'danger' : activeExceptions.length > 0 ? 'warning' : 'default'}
            hint={criticalExceptions.length > 0 ? `${criticalExceptions.length} urgent/high priority` : 'Open custody issues'}
            icon={<AlertTriangle size={18} />}
            className="h-full border border-border shadow-xs hover:border-brand/40 hover:shadow-raised transition-all"
          />
        </button>
        <button
          type="button"
          onClick={() => setTab('transfers')}
          className="text-left transition-all hover:scale-[1.01] focus:outline-none"
        >
          <Stat
            label="In-Flight Transfers"
            value={transfersQuery.isLoading ? '—' : activeTransfers.length.toLocaleString('en-IN')}
            tone={activeTransfers.length > 0 ? 'success' : 'default'}
            hint={activeTransfers.length > 0 ? 'Transshipments in progress' : 'No active vehicle handovers'}
            icon={<ArrowRightLeft size={18} />}
            className="h-full border border-border shadow-xs hover:border-brand/40 hover:shadow-raised transition-all"
          />
        </button>
        <button
          type="button"
          onClick={() => setTab('hubs')}
          className="text-left transition-all hover:scale-[1.01] focus:outline-none"
        >
          <Stat
            label="Storage Hubs"
            value={hubsQuery.isLoading ? '—' : (hubsQuery.data?.length ?? 0).toLocaleString('en-IN')}
            hint="Active cross-dock facilities"
            icon={<Building2 size={18} />}
            className="h-full border border-border shadow-xs hover:border-brand/40 hover:shadow-raised transition-all"
          />
        </button>
        <button
          type="button"
          onClick={() => setTab('claims')}
          className="text-left transition-all hover:scale-[1.01] focus:outline-none"
        >
          <Stat
            label="Active Claims"
            value={claimsQuery.isLoading ? '—' : activeClaims.length.toLocaleString('en-IN')}
            tone={activeClaims.length > 0 ? 'warning' : 'default'}
            hint={activeClaims.length > 0 ? 'Awaiting survey or settlement' : 'All claims settled'}
            icon={<ShieldAlert size={18} />}
            className="h-full border border-border shadow-xs hover:border-brand/40 hover:shadow-raised transition-all"
          />
        </button>
      </section>

      <TabPanel id={tab}>
        {tab === 'exceptions' && <ExceptionsTab />}
        {tab === 'transfers' && <TransfersTab />}
        {tab === 'hubs' && <HubsTab />}
        {tab === 'claims' && <ClaimsTab />}
      </TabPanel>
      {raising && <RaiseExceptionModal open onClose={() => setRaising(false)} />}
    </Page>
  )
}

