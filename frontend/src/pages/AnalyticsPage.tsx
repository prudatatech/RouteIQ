import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Page, PageHeader, TabPanel, Tabs, useTabParam, type TabItem } from '@/components/ui'
import OverviewTab from '@/components/analytics/OverviewTab'
import LiveTelemetryTab from '@/components/analytics/LiveTelemetryTab'
import DriversTab from '@/components/analytics/DriversTab'
import VendorsTab from '@/components/analytics/VendorsTab'
import FinanceTab from '@/components/analytics/FinanceTab'
import FleetHealthTab from '@/components/analytics/FleetHealthTab'

const TAB_IDS = ['overview', 'finance', 'vehicles', 'health', 'drivers', 'vendors'] as const
type TabId = typeof TAB_IDS[number]

const TABS: TabItem<TabId>[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'finance', label: 'Finance' },
  { id: 'vehicles', label: 'Vehicles' },
  { id: 'health', label: 'Fleet health' },
  { id: 'drivers', label: 'Drivers' },
  { id: 'vendors', label: 'Vendors' },
]

export default function AnalyticsPage() {
  const [params, setParams] = useSearchParams()
  const vehicleId = params.get('vehicle')
  // Fleet links here with ?vehicle=<id>; open that vehicle's tab.
  const [tab, setTab] = useTabParam<TabId>(TAB_IDS, vehicleId ? 'vehicles' : 'overview')

  const setVehicle = useCallback((id: string) => {
    setParams(prev => {
      const next = new URLSearchParams(prev)
      next.set('vehicle', id)
      next.set('tab', 'vehicles')
      return next
    }, { replace: true })
  }, [setParams])

  return (
    <Page>
      <PageHeader title="Analytics" description="How the fleet, drivers and vendors are performing.">
        <Tabs tabs={TABS} value={tab} onChange={setTab} label="Analytics sections" />
      </PageHeader>
      <TabPanel id={tab}>
        {tab === 'overview' && <OverviewTab />}
        {tab === 'finance' && <FinanceTab />}
        {tab === 'vehicles' && <LiveTelemetryTab vehicleId={vehicleId} onVehicleChange={setVehicle} />}
        {tab === 'health' && <FleetHealthTab />}
        {tab === 'drivers' && <DriversTab />}
        {tab === 'vendors' && <VendorsTab />}
      </TabPanel>
    </Page>
  )
}
