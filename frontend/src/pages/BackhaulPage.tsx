import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Page, PageHeader, TabPanel, Tabs, useTabParam, type TabItem } from '@/components/ui'
import OpenLoadsTab from '@/components/backhaul/OpenLoadsTab'
import PoolLoadsTab from '@/components/backhaul/PoolLoadsTab'
import MatchReturnLoadTab from '@/components/backhaul/MatchReturnLoadTab'
import CargoAlertsTab from '@/components/backhaul/CargoAlertsTab'
import ConfirmDeliveryTab from '@/components/backhaul/ConfirmDeliveryTab'
import PriceLoadTab from '@/components/backhaul/PriceLoadTab'
import { useCargoAlerts, useOpenLoads, type DuplicatedManifest } from '@/components/backhaul/data'

const TAB_IDS = ['loads', 'pool', 'match', 'price', 'alerts', 'delivery'] as const
type TabId = typeof TAB_IDS[number]

export default function BackhaulPage() {
  const location = useLocation()
  const navigate = useNavigate()
  // Route details → Duplicate sends the route here (via the old /cargo-network address too).
  const manifest = (location.state as { duplicateManifest?: DuplicatedManifest } | null)?.duplicateManifest ?? null
  const [tab, setTab] = useTabParam<TabId>(TAB_IDS, manifest ? 'match' : 'loads')

  const loads = useOpenLoads()
  const alerts = useCargoAlerts()

  const dismissManifest = useCallback(() => {
    navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: null })
  }, [navigate, location.pathname, location.search])

  const tabs: TabItem<TabId>[] = [
    { id: 'loads', label: 'Open loads', count: loads.data?.length },
    { id: 'pool', label: 'Pool loads' },
    { id: 'match', label: 'Match a return load' },
    { id: 'price', label: 'Price a load' },
    { id: 'alerts', label: 'Cargo alerts', count: alerts.data?.length },
    { id: 'delivery', label: 'Confirm delivery' },
  ]

  return (
    <Page>
      <PageHeader
        title="Backhaul pooling"
        description="Fill empty space on trucks: pool open loads onto one run, or add a load to a return trip."
      >
        <Tabs tabs={tabs} value={tab} onChange={setTab} label="Backhaul pooling sections" />
      </PageHeader>
      <TabPanel id={tab}>
        {tab === 'loads' && <OpenLoadsTab />}
        {tab === 'pool' && <PoolLoadsTab />}
        {tab === 'match' && <MatchReturnLoadTab manifest={manifest} onDismissManifest={dismissManifest} />}
        {tab === 'price' && <PriceLoadTab />}
        {tab === 'alerts' && <CargoAlertsTab />}
        {tab === 'delivery' && <ConfirmDeliveryTab />}
      </TabPanel>
    </Page>
  )
}
